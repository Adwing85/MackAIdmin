import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { Config } from "../config.js";
import { get, nowIso, parseJson, run, type DB } from "../db/database.js";
import { HttpError } from "../lib/http.js";
import type { Role } from "../domain/catalog.js";

export const SESSION_COOKIE = "mackaidmin_session";

export type TokenScope = "usage:write" | "discovery:write" | "policy:read";
export const TOKEN_SCOPES: Record<TokenScope, string> = {
  "usage:write": "Token-Verbrauch melden (Apps, Agents, CI)",
  "discovery:write": "Discovery-Scans melden (Shadow-AI-Scanner)",
  "policy:read": "Claude-Code-Policy abrufen (MDM / Config-Management)",
};

export interface CurrentUser {
  kind: "user";
  id: number;
  email: string;
  name: string;
  roles: Role[];
  teamId: number | null;
}

export interface CurrentToken {
  kind: "token";
  id: number;
  name: string;
  scopes: TokenScope[];
}

declare module "express-serve-static-core" {
  interface Request {
    user?: CurrentUser;
    apiToken?: CurrentToken;
  }
}

// --- passwords -------------------------------------------------------------

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const [algo, saltB64, hashB64] = stored.split("$");
  if (algo !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = scryptSync(password, Buffer.from(saltB64, "base64"), expected.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(expected, actual);
}

// --- sessions & tokens ---------------------------------------------------------

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export function createSession(db: DB, personId: number, ttlHours: number): string {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + ttlHours * 3_600_000).toISOString();
  run(db, "INSERT INTO sessions (token_hash, person_id, expires_at) VALUES (:h, :p, :e)", {
    h: sha256(token),
    p: personId,
    e: expires,
  });
  run(db, "DELETE FROM sessions WHERE expires_at < :now", { now: nowIso() });
  return token;
}

export function destroySession(db: DB, token: string): void {
  run(db, "DELETE FROM sessions WHERE token_hash = :h", { h: sha256(token) });
}

export function createApiToken(db: DB, name: string, scopes: TokenScope[], createdBy: number) {
  const secret = `mka_${randomBytes(24).toString("base64url")}`;
  const result = run(db, "INSERT INTO api_tokens (name, prefix, token_hash, scopes, created_by) VALUES (:n, :p, :h, :s, :c)", {
    n: name,
    p: secret.slice(0, 8),
    h: sha256(secret),
    s: JSON.stringify(scopes),
    c: createdBy,
  });
  return { id: Number(result.lastInsertRowid), token: secret };
}

interface PersonRow {
  id: number;
  email: string;
  name: string;
  roles: string;
  team_id: number | null;
  active: number;
}

function toUser(row: PersonRow): CurrentUser {
  return {
    kind: "user",
    id: row.id,
    email: row.email,
    name: row.name,
    roles: parseJson<Role[]>(row.roles, []),
    teamId: row.team_id,
  };
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function sessionCookie(token: string, config: Config, maxAgeSeconds: number): string {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (config.cookieSecure) parts.push("Secure");
  return parts.join("; ");
}

export function sessionTokenFromRequest(req: Request): string | null {
  return readCookie(req, SESSION_COOKIE);
}

/** Resolves the caller from (1) bearer API token, (2) trusted SSO proxy header, (3) session cookie. */
export function authenticate(db: DB, config: Config) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const authz = req.headers.authorization;
    if (authz?.startsWith("Bearer ")) {
      const row = get<{ id: number; name: string; scopes: string }>(
        db,
        "SELECT id, name, scopes FROM api_tokens WHERE token_hash = :h AND revoked_at IS NULL",
        { h: sha256(authz.slice(7).trim()) },
      );
      if (!row) return next(new HttpError(401, "Ungültiges API-Token."));
      run(db, "UPDATE api_tokens SET last_used_at = :now WHERE id = :id", { now: nowIso(), id: row.id });
      req.apiToken = { kind: "token", id: row.id, name: row.name, scopes: parseJson(row.scopes, []) };
      return next();
    }

    if (config.authProxyHeader) {
      const email = req.headers[config.authProxyHeader];
      if (typeof email === "string" && email) {
        const row = get<PersonRow>(db, "SELECT * FROM people WHERE email = :e AND active = 1", { e: email.trim() });
        if (row) req.user = toUser(row);
        return next();
      }
    }

    const token = sessionTokenFromRequest(req);
    if (token) {
      const row = get<PersonRow>(
        db,
        `SELECT p.* FROM sessions s JOIN people p ON p.id = s.person_id
         WHERE s.token_hash = :h AND s.expires_at > :now AND p.active = 1`,
        { h: sha256(token), now: nowIso() },
      );
      if (row) req.user = toUser(row);
    }
    next();
  };
}

// --- authorization ------------------------------------------------------------

export function hasRole(user: CurrentUser | undefined, ...roles: Role[]): boolean {
  if (!user) return false;
  return user.roles.includes("admin") || roles.some((r) => user.roles.includes(r));
}

export function requireUser(req: Request): CurrentUser {
  if (!req.user) throw new HttpError(401, "Bitte anmelden.");
  return req.user;
}

export function requireRole(req: Request, ...roles: Role[]): CurrentUser {
  const user = requireUser(req);
  if (!hasRole(user, ...roles)) throw new HttpError(403, "Keine Berechtigung für diese Aktion.");
  return user;
}

/** Allows either a logged-in user with one of the roles, or an API token with the scope. */
export function requireUserOrScope(req: Request, scope: TokenScope, ...roles: Role[]): CurrentUser | CurrentToken {
  if (req.apiToken) {
    if (!req.apiToken.scopes.includes(scope)) throw new HttpError(403, `API-Token fehlt der Scope „${scope}“.`);
    return req.apiToken;
  }
  return roles.length ? requireRole(req, ...roles) : requireUser(req);
}

export function canWrite(user: CurrentUser): boolean {
  return !(user.roles.length === 1 && user.roles[0] === "viewer");
}

export function actorLabel(actor: CurrentUser | CurrentToken | undefined): string {
  if (!actor) return "System";
  return actor.kind === "user" ? `${actor.name} <${actor.email}>` : `API-Token „${actor.name}“`;
}

// --- login throttling -----------------------------------------------------------

const attempts = new Map<string, { count: number; until: number }>();

export function checkLoginThrottle(key: string): void {
  const entry = attempts.get(key);
  if (entry && entry.count >= 5 && entry.until > Date.now()) {
    throw new HttpError(429, "Zu viele Anmeldeversuche. Bitte in einigen Minuten erneut versuchen.");
  }
}

export function recordLoginFailure(key: string): void {
  const entry = attempts.get(key);
  const count = entry && entry.until > Date.now() ? entry.count + 1 : 1;
  attempts.set(key, { count, until: Date.now() + 10 * 60_000 });
}

export function clearLoginFailures(key: string): void {
  attempts.delete(key);
}
