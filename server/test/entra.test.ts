// End-to-end tests of the Entra ID login against a minimal local OpenID Connect provider that
// behaves like the Entra v2.0 endpoint (discovery, JWKS, token endpoint with PKCE, RS256 ID tokens).

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash, createSign, generateKeyPairSync, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app.js";
import { loadConfig, loadEntraConfig, type Config, type EntraConfig } from "../src/config.js";
import { hashPassword } from "../src/auth/auth.js";
import { openDatabase, run, type DB } from "../src/db/database.js";
import { mapAppRoles, safeReturnTo } from "../src/auth/entra.js";

const TENANT = "11111111-2222-3333-4444-555555555555";
const CLIENT_ID = "mackaidmin-test";
const CLIENT_SECRET = "test-secret";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key", alg: "RS256", use: "sig" };
const b64url = (data: Buffer | string) => Buffer.from(data).toString("base64url");

function signIdToken(payload: Record<string, unknown>): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "test-key" }));
  const body = b64url(JSON.stringify(payload));
  const signature = createSign("RSA-SHA256").update(`${header}.${body}`).sign(privateKey);
  return `${header}.${body}.${b64url(signature)}`;
}

interface IssuedCode {
  challenge: string;
  idToken: Record<string, unknown>;
}

let idp: Server;
let idpBase = "";
const codes = new Map<string, IssuedCode>();

function issuer() {
  return `${idpBase}/${TENANT}/v2.0`;
}

function startIdp(): Promise<void> {
  idp = createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && req.url === `/${TENANT}/v2.0/.well-known/openid-configuration`) {
      return send(200, {
        issuer: issuer(),
        authorization_endpoint: `${idpBase}/${TENANT}/oauth2/v2.0/authorize`,
        token_endpoint: `${idpBase}/${TENANT}/oauth2/v2.0/token`,
        jwks_uri: `${idpBase}/${TENANT}/discovery/v2.0/keys`,
        response_types_supported: ["code"],
        subject_types_supported: ["pairwise"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (req.method === "GET" && req.url === `/${TENANT}/discovery/v2.0/keys`) return send(200, { keys: [jwk] });
    if (req.method === "POST" && req.url === `/${TENANT}/oauth2/v2.0/token`) {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const form = new URLSearchParams(raw);
        const issued = codes.get(form.get("code") ?? "");
        codes.delete(form.get("code") ?? "");
        const verifierOk =
          issued &&
          createHash("sha256")
            .update(form.get("code_verifier") ?? "")
            .digest("base64url") === issued.challenge;
        if (
          !issued ||
          !verifierOk ||
          form.get("client_id") !== CLIENT_ID ||
          form.get("client_secret") !== CLIENT_SECRET ||
          form.get("grant_type") !== "authorization_code"
        ) {
          return send(400, { error: "invalid_grant" });
        }
        send(200, { access_token: "at", token_type: "Bearer", expires_in: 3600, id_token: signIdToken(issued.idToken) });
      });
      return;
    }
    send(404, { error: "not_found" });
  });
  return new Promise((resolve) => idp.listen(0, "127.0.0.1", () => resolve()));
}

let db: DB;
let app: Server;
let appBase = "";
let entra: EntraConfig;

before(async () => {
  await startIdp();
  idpBase = `http://127.0.0.1:${(idp.address() as AddressInfo).port}`;
  db = openDatabase(":memory:");
  const add = (email: string, roles: string[], active = true) =>
    run(db, "INSERT INTO people (email, name, roles, password_hash, active) VALUES (:e, :n, :r, :p, :a)", {
      e: email,
      n: email.split("@")[0],
      r: JSON.stringify(roles),
      p: hashPassword("passwort-1234"),
      a: active,
    });
  add("dev@firma.example", ["developer"]);
  add("ex@firma.example", ["developer"], false);
  entra = {
    tenantId: TENANT,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    authority: issuer(),
    redirectUri: "",
    defaultRoles: ["viewer"],
    autoProvision: true,
    allowInsecureRequests: true,
  };
  const config: Config = { ...loadConfig({}), cookieSecure: false, staticDir: null, entra };
  app = createApp(db, config).listen(0);
  await new Promise((r) => app.once("listening", r));
  appBase = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  entra.redirectUri = `${appBase}/api/auth/entra/callback`;
});

after(() => {
  app.close();
  idp.close();
});

const cookiePart = (setCookies: string[], name: string) => setCookies.find((c) => c.startsWith(`${name}=`))?.split(";")[0];

/** Runs the browser side of the login: start → (IdP issues a code) → callback. */
async function loginViaEntra(
  claims: Record<string, unknown>,
  opts: { returnTo?: string; dropStateCookie?: boolean; tamperNonce?: boolean } = {},
) {
  const start = await fetch(`${appBase}/api/auth/entra/login?returnTo=${encodeURIComponent(opts.returnTo ?? "/")}`, {
    redirect: "manual",
  });
  assert.equal(start.status, 302);
  const authorize = new URL(start.headers.get("location")!);
  assert.equal(authorize.origin + authorize.pathname, `${idpBase}/${TENANT}/oauth2/v2.0/authorize`);
  assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorize.searchParams.get("redirect_uri"), entra.redirectUri);
  const stateCookie = cookiePart(start.headers.getSetCookie(), "mackaidmin_oidc")!;

  const code = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  codes.set(code, {
    challenge: authorize.searchParams.get("code_challenge")!,
    idToken: {
      iss: issuer(),
      aud: CLIENT_ID,
      sub: `sub-${claims.oid}`,
      tid: TENANT,
      iat: now,
      nbf: now,
      exp: now + 600,
      nonce: opts.tamperNonce ? "wrong-nonce" : authorize.searchParams.get("nonce"),
      ...claims,
    },
  });
  const callback = await fetch(
    `${appBase}/api/auth/entra/callback?code=${code}&state=${authorize.searchParams.get("state")}&session_state=abc`,
    { redirect: "manual", headers: opts.dropStateCookie ? {} : { cookie: stateCookie } },
  );
  assert.equal(callback.status, 302);
  const location = callback.headers.get("location")!;
  const session = cookiePart(callback.headers.getSetCookie(), "mackaidmin_session");
  return { location, session: session && session !== "mackaidmin_session=" ? session : null };
}

async function me(session: string) {
  const res = await fetch(`${appBase}/api/auth/me`, { headers: { cookie: session } });
  return { status: res.status, body: await res.json() };
}

describe("Entra ID login", () => {
  it("advertises Entra ID on the login page", async () => {
    const res = await fetch(`${appBase}/api/auth/config`);
    assert.deepEqual(await res.json(), { localLogin: true, entra: { label: "Mit Microsoft anmelden" } });
  });

  it("creates a new person on first login, applies app roles and returns to the requested page", async () => {
    const { location, session } = await loginViaEntra(
      { oid: randomUUID(), name: "Sina Sicherheit", preferred_username: "Sina@Firma.example", roles: ["security", "Unbekannt"] },
      { returnTo: "/inventar/5?tab=risk" },
    );
    assert.equal(location, "/inventar/5?tab=risk");
    assert.ok(session);
    const { body } = await me(session);
    assert.equal(body.email, "sina@firma.example");
    assert.equal(body.name, "Sina Sicherheit");
    assert.deepEqual(body.roles, ["security"]);
    assert.equal(body.entraLinked, true);
    assert.equal(body.hasPassword, false);
  });

  it("gives default roles when the token carries no app roles", async () => {
    const { session } = await loginViaEntra({ oid: randomUUID(), name: "Neu", email: "neu@firma.example" });
    assert.deepEqual((await me(session!)).body.roles, ["viewer"]);
  });

  it("links an existing account by e-mail and keeps roles in step with Entra", async () => {
    const oid = randomUUID();
    const first = await loginViaEntra({ oid, name: "Dev", email: "dev@firma.example", roles: ["developer", "team_lead"] });
    const body = (await me(first.session!)).body;
    assert.equal(body.email, "dev@firma.example");
    assert.deepEqual([...body.roles].sort(), ["developer", "team_lead"]);
    assert.equal(body.hasPassword, true, "the local password stays as break-glass access");

    // Same object id, role removed in Entra → removed here on the next login.
    const second = await loginViaEntra({ oid, name: "Dev", email: "dev@firma.example", roles: ["developer"] });
    assert.deepEqual((await me(second.session!)).body.roles, ["developer"]);
    assert.equal((await me(second.session!)).body.id, body.id);
  });

  it("refuses deactivated accounts", async () => {
    const { location, session } = await loginViaEntra({ oid: randomUUID(), name: "Ex", email: "ex@firma.example" });
    assert.equal(session, null);
    assert.match(decodeURIComponent(location), /deaktiviert/);
  });

  it("refuses a callback that did not start in this browser (login CSRF)", async () => {
    const { location, session } = await loginViaEntra(
      { oid: randomUUID(), email: "csrf@firma.example" },
      { dropStateCookie: true },
    );
    assert.equal(session, null);
    assert.match(decodeURIComponent(location), /^\/\?loginError=Ungültige oder abgelaufene Anmeldung/);
  });

  it("refuses ID tokens with a wrong nonce", async () => {
    const { location, session } = await loginViaEntra(
      { oid: randomUUID(), email: "replay@firma.example" },
      { tamperNonce: true },
    );
    assert.equal(session, null);
    assert.match(location, /^\/\?loginError=/);
  });

  it("refuses tokens from another tenant", async () => {
    const { session, location } = await loginViaEntra({
      oid: randomUUID(),
      email: "gast@extern.example",
      tid: "99999999-2222-3333-4444-555555555555",
    });
    assert.equal(session, null);
    assert.match(decodeURIComponent(location), /fremden Mandanten/);
  });

  it("never redirects off-site after login", async () => {
    const { location } = await loginViaEntra(
      { oid: randomUUID(), email: "redirect@firma.example" },
      { returnTo: "//evil.example/x" },
    );
    assert.equal(location, "/");
    assert.equal(safeReturnTo("https://evil.example"), "/");
    assert.equal(safeReturnTo("/\\evil.example"), "/");
    assert.equal(safeReturnTo("/api/auth/logout"), "/");
    assert.equal(safeReturnTo("/kosten"), "/kosten");
  });

  it("sends people back to the login page when Microsoft is unreachable", async () => {
    const authority = entra.authority;
    entra.authority = "http://127.0.0.1:9/unreachable/v2.0";
    try {
      const res = await fetch(`${appBase}/api/auth/entra/login`, { redirect: "manual" });
      assert.equal(res.status, 302);
      assert.match(decodeURIComponent(res.headers.get("location")!), /nicht erreichbar/);
    } finally {
      entra.authority = authority;
    }
  });

  it("refuses unknown people when auto-provisioning is off", async () => {
    entra.autoProvision = false;
    try {
      const { session, location } = await loginViaEntra({ oid: randomUUID(), email: "unbekannt@firma.example" });
      assert.equal(session, null);
      assert.match(decodeURIComponent(location), /kein Zugang/);
    } finally {
      entra.autoProvision = true;
    }
  });
});

describe("Entra ID configuration", () => {
  it("maps app role values onto MackAIdmin roles", () => {
    assert.deepEqual(mapAppRoles(["Admin", "finance", "MackAIdmin.Other"]), ["admin", "finance"]);
    assert.equal(mapAppRoles(["nothing-known"]), null);
    assert.equal(mapAppRoles(undefined), null);
  });

  it("validates the environment", () => {
    assert.equal(loadEntraConfig({}), null);
    assert.throws(() => loadEntraConfig({ ENTRA_TENANT_ID: TENANT }), /gemeinsam/);
    assert.throws(
      () =>
        loadEntraConfig({ ENTRA_TENANT_ID: "common", ENTRA_CLIENT_ID: "x", ENTRA_CLIENT_SECRET: "y", PUBLIC_URL: "https://a" }),
      /GUID/,
    );
    assert.throws(
      () => loadEntraConfig({ ENTRA_TENANT_ID: TENANT, ENTRA_CLIENT_ID: "x", ENTRA_CLIENT_SECRET: "y" }),
      /PUBLIC_URL/,
    );
    const cfg = loadEntraConfig({
      ENTRA_TENANT_ID: TENANT,
      ENTRA_CLIENT_ID: "x",
      ENTRA_CLIENT_SECRET: "y",
      PUBLIC_URL: "https://mackaidmin.firma.example/",
      ENTRA_DEFAULT_ROLES: "developer",
    })!;
    assert.equal(cfg.redirectUri, "https://mackaidmin.firma.example/api/auth/entra/callback");
    assert.equal(cfg.authority, `https://login.microsoftonline.com/${TENANT}/v2.0`);
    assert.deepEqual(cfg.defaultRoles, ["developer"]);
  });

  it("can switch off password login", async () => {
    const config: Config = { ...loadConfig({}), cookieSecure: false, staticDir: null, entra, localLoginEnabled: false };
    const server = createApp(db, config).listen(0);
    await new Promise((r) => server.once("listening", r));
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const login = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "dev@firma.example", password: "passwort-1234" }),
      });
      assert.equal(login.status, 403);
      assert.equal((await (await fetch(`${base}/api/auth/config`)).json()).localLogin, false);
    } finally {
      server.close();
    }
  });
});
