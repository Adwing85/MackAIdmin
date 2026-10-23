// Microsoft Entra ID login via OpenID Connect (authorization code flow with PKCE, state and nonce).
// Identity is pinned to one tenant through the issuer; people are matched by their immutable
// object id ("oid"), roles can be driven by Entra app roles.

import * as oidc from "openid-client";
import type { EntraConfig } from "../config.js";
import { get, nowIso, parseJson, run, transaction, type DB } from "../db/database.js";
import { ROLES, type Role } from "../domain/catalog.js";
import { audit } from "../services/audit.js";

export const OIDC_STATE_COOKIE = "mackaidmin_oidc";
const LOGIN_TTL_MS = 10 * 60_000;

export class EntraLoginError extends Error {}

let cached: { key: string; config: Promise<oidc.Configuration> } | null = null;

/** Discovers the tenant's OIDC metadata once; a failed discovery is retried on the next login. */
function configuration(entra: EntraConfig): Promise<oidc.Configuration> {
  const key = `${entra.authority}|${entra.clientId}`;
  if (cached?.key !== key) {
    const config = oidc
      .discovery(
        new URL(entra.authority),
        entra.clientId,
        entra.clientSecret,
        undefined,
        entra.allowInsecureRequests ? { execute: [oidc.allowInsecureRequests] } : undefined,
      )
      .catch((err) => {
        cached = null;
        throw err;
      });
    cached = { key, config };
  }
  return cached.config;
}

/** Only same-origin relative paths are allowed as post-login targets (no open redirects). */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  if (value.startsWith("/api/")) return "/";
  return value.slice(0, 500);
}

export async function beginLogin(db: DB, entra: EntraConfig, returnTo: string): Promise<{ url: string; state: string }> {
  const config = await configuration(entra);
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);

  run(db, "DELETE FROM oidc_logins WHERE created_at < :cutoff", { cutoff: new Date(Date.now() - LOGIN_TTL_MS).toISOString() });
  run(db, "INSERT INTO oidc_logins (state, nonce, code_verifier, return_to) VALUES (:s, :n, :v, :r)", {
    s: state,
    n: nonce,
    v: codeVerifier,
    r: safeReturnTo(returnTo),
  });

  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: entra.redirectUri,
    scope: "openid profile email",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
    nonce,
    // After a logout the account picker appears instead of a silent re-login.
    prompt: "select_account",
  });
  return { url: url.href, state };
}

export interface EntraIdentity {
  externalId: string;
  email: string | null;
  name: string;
  roles: Role[] | null;
}

/** Maps Entra app role values (e.g. "admin", "security") onto MackAIdmin roles. */
export function mapAppRoles(claim: unknown): Role[] | null {
  if (!Array.isArray(claim)) return null;
  const roles = claim
    .filter((r): r is string => typeof r === "string")
    .map((r) => r.trim().toLowerCase())
    .filter((r): r is Role => r in ROLES);
  return roles.length ? [...new Set(roles)] : null;
}

export async function completeLogin(
  db: DB,
  entra: EntraConfig,
  callbackQuery: string,
  cookieState: string | null,
): Promise<{ identity: EntraIdentity; returnTo: string }> {
  const params = new URLSearchParams(callbackQuery);
  const state = params.get("state");
  if (params.get("error")) {
    throw new EntraLoginError(`Anmeldung bei Microsoft abgebrochen: ${params.get("error_description") ?? params.get("error")}`);
  }
  // The state must come back to the same browser that started the login (login-CSRF protection).
  if (!state || !cookieState || state !== cookieState) throw new EntraLoginError("Ungültige oder abgelaufene Anmeldung.");
  const pending = transaction(db, () => {
    const row = get<{ nonce: string; code_verifier: string; return_to: string; created_at: string }>(
      db,
      "SELECT * FROM oidc_logins WHERE state = :s",
      { s: state },
    );
    run(db, "DELETE FROM oidc_logins WHERE state = :s", { s: state });
    return row;
  });
  if (!pending || Date.parse(pending.created_at) < Date.now() - LOGIN_TTL_MS) {
    throw new EntraLoginError("Ungültige oder abgelaufene Anmeldung.");
  }

  const config = await configuration(entra);
  const currentUrl = new URL(entra.redirectUri);
  currentUrl.search = callbackQuery;
  const tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
    pkceCodeVerifier: pending.code_verifier,
    expectedState: state,
    expectedNonce: pending.nonce,
    idTokenExpected: true,
  });
  const claims = tokens.claims();
  const oid = claims?.oid;
  const tid = claims?.tid;
  if (typeof oid !== "string" || typeof tid !== "string")
    throw new EntraLoginError("Das ID-Token enthält keine Entra-Objekt-ID.");
  if (tid.toLowerCase() !== entra.tenantId.toLowerCase()) throw new EntraLoginError("Konto gehört zu einem fremden Mandanten.");

  const emailClaim = [claims?.email, claims?.preferred_username].find(
    (v): v is string => typeof v === "string" && /^[^@\s]+@[^@\s]+$/.test(v),
  );
  return {
    identity: {
      externalId: `${tid.toLowerCase()}:${oid.toLowerCase()}`,
      email: emailClaim?.toLowerCase() ?? null,
      name: typeof claims?.name === "string" && claims.name.trim() ? claims.name.trim() : (emailClaim ?? "Unbekannt"),
      roles: mapAppRoles(claims?.roles),
    },
    returnTo: pending.return_to,
  };
}

interface PersonRow {
  id: number;
  email: string;
  name: string;
  roles: string;
  active: number;
  external_id: string | null;
}

/**
 * Finds the person for an Entra identity: by object id, else links an existing account with the same
 * e-mail address (first SSO login), else creates one if auto-provisioning is on. App roles from the
 * token, when present, replace the person's roles so Entra stays the source of truth.
 */
export function resolvePerson(db: DB, entra: EntraConfig, identity: EntraIdentity): { id: number; name: string; email: string } {
  return transaction(db, () => {
    let person = get<PersonRow>(db, "SELECT * FROM people WHERE external_id = :x", { x: identity.externalId });
    if (!person && identity.email) {
      person = get<PersonRow>(db, "SELECT * FROM people WHERE email = :e AND external_id IS NULL", { e: identity.email });
      if (person) {
        run(db, "UPDATE people SET external_id = :x WHERE id = :id", { x: identity.externalId, id: person.id });
        audit(db, undefined, {
          action: "person.entra_linked",
          entityType: "person",
          entityId: person.id,
          summary: `${person.name} mit Entra-ID-Konto verknüpft`,
        });
      }
    }

    if (!person) {
      if (!entra.autoProvision)
        throw new EntraLoginError("Für dieses Konto ist kein Zugang eingerichtet. Bitte an die Administration wenden.");
      if (!identity.email) throw new EntraLoginError("Das Microsoft-Konto liefert keine E-Mail-Adresse.");
      if (get(db, "SELECT 1 FROM people WHERE email = :e", { e: identity.email })) {
        throw new EntraLoginError("Die E-Mail-Adresse ist bereits mit einem anderen Entra-Konto verknüpft.");
      }
      const roles = identity.roles ?? entra.defaultRoles;
      const id = Number(
        run(db, "INSERT INTO people (email, name, roles, external_id, last_login_at) VALUES (:e, :n, :r, :x, :now)", {
          e: identity.email,
          n: identity.name,
          r: JSON.stringify(roles),
          x: identity.externalId,
          now: nowIso(),
        }).lastInsertRowid,
      );
      audit(db, undefined, {
        action: "person.created",
        entityType: "person",
        entityId: id,
        summary: `${identity.name} bei der ersten Entra-ID-Anmeldung angelegt (${roles.join(", ")})`,
      });
      return { id, name: identity.name, email: identity.email };
    }

    if (!person.active) throw new EntraLoginError("Dieses Konto ist deaktiviert.");

    const currentRoles = parseJson<Role[]>(person.roles, []);
    if (identity.roles && [...identity.roles].sort().join() !== [...currentRoles].sort().join()) {
      run(db, "UPDATE people SET roles = :r WHERE id = :id", { r: JSON.stringify(identity.roles), id: person.id });
      audit(db, undefined, {
        action: "person.roles_synced",
        entityType: "person",
        entityId: person.id,
        summary: `Rollen von ${person.name} aus Entra-App-Rollen übernommen: ${identity.roles.join(", ")}`,
        changes: { roles: { from: currentRoles, to: identity.roles } },
      });
    }
    // Keep display name and e-mail in step with the directory (unless the address belongs to someone else).
    const emailFree =
      identity.email && !get(db, "SELECT 1 FROM people WHERE email = :e AND id <> :id", { e: identity.email, id: person.id });
    run(db, "UPDATE people SET name = :n, email = :e, last_login_at = :now WHERE id = :id", {
      n: identity.name,
      e: emailFree ? identity.email : person.email,
      now: nowIso(),
      id: person.id,
    });
    return { id: person.id, name: identity.name, email: emailFree ? identity.email! : person.email };
  });
}

/** For tests: forget the cached discovery document. */
export function resetEntraCache(): void {
  cached = null;
}
