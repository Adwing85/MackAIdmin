import { Router } from "express";
import { z } from "zod";
import { get, nowIso, run, type DB } from "../db/database.js";
import type { Config } from "../config.js";
import {
  checkLoginThrottle,
  clearLoginFailures,
  createSession,
  destroySession,
  hashPassword,
  recordLoginFailure,
  requireUser,
  sessionCookie,
  sessionTokenFromRequest,
  verifyPassword,
} from "../auth/auth.js";
import { HttpError, parse } from "../lib/http.js";
import { audit } from "../services/audit.js";

// Verifying against a dummy hash keeps response times equal for unknown e-mail addresses.
const DUMMY_HASH = hashPassword("dummy-password-for-timing");

export function authRouter(db: DB, config: Config): Router {
  const r = Router();

  r.post("/auth/login", (req, res) => {
    const body = parse(
      z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) }),
      req.body,
    );
    const throttleKey = `${req.ip}:${body.email}`;
    checkLoginThrottle(throttleKey);
    const person = get<{ id: number; name: string; email: string; password_hash: string | null; active: number }>(
      db,
      "SELECT id, name, email, password_hash, active FROM people WHERE email = :e",
      { e: body.email },
    );
    const ok = verifyPassword(body.password, person?.password_hash ?? DUMMY_HASH) && !!person?.active;
    if (!person || !ok) {
      recordLoginFailure(throttleKey);
      throw new HttpError(401, "E-Mail oder Passwort ist falsch.");
    }
    clearLoginFailures(throttleKey);
    const token = createSession(db, person.id, config.sessionTtlHours);
    run(db, "UPDATE people SET last_login_at = :now WHERE id = :id", { now: nowIso(), id: person.id });
    audit(
      db,
      { kind: "user", id: person.id, email: person.email, name: person.name, roles: [], teamId: null },
      {
        action: "auth.login",
        entityType: "person",
        entityId: person.id,
        summary: `${person.name} hat sich angemeldet`,
      },
    );
    res.setHeader("Set-Cookie", sessionCookie(token, config, config.sessionTtlHours * 3600));
    res.json({ ok: true });
  });

  r.post("/auth/logout", (req, res) => {
    const token = sessionTokenFromRequest(req);
    if (token) destroySession(db, token);
    res.setHeader("Set-Cookie", sessionCookie("", config, 0));
    res.json({ ok: true });
  });

  r.get("/auth/me", (req, res) => {
    const user = requireUser(req);
    res.json({ ...user, ssoProxy: !!config.authProxyHeader });
  });

  r.post("/auth/password", (req, res) => {
    const user = requireUser(req);
    const body = parse(
      z.object({ currentPassword: z.string().max(200), newPassword: z.string().min(10, "Mindestens 10 Zeichen.").max(200) }),
      req.body,
    );
    const row = get<{ password_hash: string | null }>(db, "SELECT password_hash FROM people WHERE id = :id", { id: user.id });
    if (!verifyPassword(body.currentPassword, row?.password_hash ?? null))
      throw new HttpError(400, "Aktuelles Passwort ist falsch.");
    run(db, "UPDATE people SET password_hash = :h WHERE id = :id", { h: hashPassword(body.newPassword), id: user.id });
    run(db, "DELETE FROM sessions WHERE person_id = :id AND token_hash <> ''", { id: user.id });
    const token = createSession(db, user.id, config.sessionTtlHours);
    audit(db, user, { action: "auth.password_changed", entityType: "person", entityId: user.id, summary: "Passwort geändert" });
    res.setHeader("Set-Cookie", sessionCookie(token, config, config.sessionTtlHours * 3600));
    res.json({ ok: true });
  });

  return r;
}
