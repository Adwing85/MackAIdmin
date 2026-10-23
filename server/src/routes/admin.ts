// Licenses, discovery, policies, organisation (people, teams, tokens), audit and metadata.

import { Router } from "express";
import { z } from "zod";
import { all, get, nowIso, parseJson, run, type DB } from "../db/database.js";
import {
  createApiToken,
  hashPassword,
  requireRole,
  requireUser,
  requireUserOrScope,
  TOKEN_SCOPES,
  type TokenScope,
} from "../auth/auth.js";
import * as catalog from "../domain/catalog.js";
import { RULES } from "../domain/findings.js";
import { buildManagedSettings, MANAGED_SETTINGS_PATHS, type ClaudeCodePolicy } from "../domain/policy.js";
import { badRequest, conflict, idParam, notFound, parse } from "../lib/http.js";
import { loadAssets } from "../services/assets.js";
import { audit, diff, listAudit } from "../services/audit.js";
import { ingestDiscoveries, listDiscoveries } from "../services/discovery.js";
import { dashboard } from "../services/insights.js";
import { licenseOverview } from "../services/licenses.js";
import { getClaudeCodePolicy, getGovernance, setClaudeCodePolicy, setGovernance } from "../services/settings.js";
import { refreshOpenApprovalRounds } from "../services/workflow.js";
import { roleSchema } from "./schemas.js";

const discoveryKinds = Object.keys(catalog.DISCOVERY_KINDS) as [catalog.DiscoveryKind, ...catalog.DiscoveryKind[]];

export function generatePolicy(db: DB) {
  const servers = loadAssets(db, "WHERE type = 'mcp_server'").map((a) => ({
    key: a.key,
    name: a.name,
    status: a.status,
    transport: a.mcpTransport,
    endpoint: a.mcpEndpoint,
  }));
  return buildManagedSettings(getClaudeCodePolicy(db), servers);
}

export function adminRouter(db: DB): Router {
  const r = Router();

  r.get("/meta", (_req, res) => {
    res.json({
      assetTypes: catalog.ASSET_TYPES,
      assetStatuses: catalog.ASSET_STATUSES,
      dataClassifications: catalog.DATA_CLASSIFICATIONS,
      exposures: catalog.EXPOSURES,
      autonomyLevels: catalog.AUTONOMY_LEVELS,
      secretsManagement: catalog.SECRETS_MANAGEMENT,
      mcpTransports: catalog.MCP_TRANSPORTS,
      permissions: catalog.PERMISSIONS,
      roles: catalog.ROLES,
      approverRoles: catalog.APPROVER_ROLES,
      severities: catalog.SEVERITIES,
      riskLevels: catalog.RISK_LEVELS,
      discoveryKinds: catalog.DISCOVERY_KINDS,
      tokenScopes: TOKEN_SCOPES,
      rules: RULES.map(({ id, severity, category, title, recommendation }) => ({
        id,
        severity,
        category,
        title,
        recommendation,
      })),
    });
  });

  r.get("/dashboard", (req, res) => {
    res.json(dashboard(db, requireUser(req)));
  });

  // --- licenses ----------------------------------------------------------------------

  r.get("/licenses", (req, res) => {
    requireUser(req);
    res.json(licenseOverview(db));
  });

  const licenseTypeSchema = z.object({
    name: z.string().trim().min(2).max(100),
    vendor: z.string().trim().max(100).default("Anthropic"),
    monthlyPriceUsd: z.number().nonnegative(),
    seatsPurchased: z.number().int().nonnegative().default(0),
    includesClaudeCode: z.boolean().default(true),
    notes: z.string().trim().max(1000).default(""),
  });

  r.post("/licenses/types", (req, res) => {
    const user = requireRole(req, "finance");
    const body = parse(licenseTypeSchema, req.body);
    if (get(db, "SELECT 1 FROM license_types WHERE name = :n", { n: body.name })) throw conflict("Lizenztyp existiert bereits.");
    const result = run(
      db,
      "INSERT INTO license_types (name, vendor, monthly_price_usd, seats_purchased, includes_claude_code, notes) VALUES (:n, :v, :p, :s, :c, :notes)",
      {
        n: body.name,
        v: body.vendor,
        p: body.monthlyPriceUsd,
        s: body.seatsPurchased,
        c: body.includesClaudeCode,
        notes: body.notes,
      },
    );
    audit(db, user, {
      action: "license_type.created",
      entityType: "license",
      entityId: Number(result.lastInsertRowid),
      summary: `Lizenztyp „${body.name}“ angelegt`,
    });
    res.status(201).json({ id: Number(result.lastInsertRowid) });
  });

  r.put("/licenses/types/:id", (req, res) => {
    const user = requireRole(req, "finance");
    const id = idParam(req);
    const body = parse(licenseTypeSchema, req.body);
    const result = run(
      db,
      `UPDATE license_types SET name = :n, vendor = :v, monthly_price_usd = :p, seats_purchased = :s, includes_claude_code = :c, notes = :notes
       WHERE id = :id`,
      {
        n: body.name,
        v: body.vendor,
        p: body.monthlyPriceUsd,
        s: body.seatsPurchased,
        c: body.includesClaudeCode,
        notes: body.notes,
        id,
      },
    );
    if (!result.changes) throw notFound("Lizenztyp");
    audit(db, user, {
      action: "license_type.updated",
      entityType: "license",
      entityId: id,
      summary: `Lizenztyp „${body.name}“ geändert`,
      changes: body,
    });
    res.json({ ok: true });
  });

  r.delete("/licenses/types/:id", (req, res) => {
    const user = requireRole(req, "finance");
    const id = idParam(req);
    if (get(db, "SELECT 1 FROM license_assignments WHERE license_type_id = :id AND revoked_at IS NULL", { id })) {
      throw conflict("Lizenztyp hat noch aktive Zuweisungen.");
    }
    run(db, "DELETE FROM license_types WHERE id = :id", { id });
    audit(db, user, { action: "license_type.deleted", entityType: "license", entityId: id, summary: "Lizenztyp gelöscht" });
    res.status(204).end();
  });

  r.post("/licenses/assignments", (req, res) => {
    const user = requireRole(req, "finance", "team_lead");
    const body = parse(z.object({ licenseTypeId: z.number().int().positive(), personId: z.number().int().positive() }), req.body);
    const type = get<{ name: string }>(db, "SELECT name FROM license_types WHERE id = :id", { id: body.licenseTypeId });
    const person = get<{ name: string }>(db, "SELECT name FROM people WHERE id = :id AND active = 1", { id: body.personId });
    if (!type || !person) throw badRequest("Lizenztyp oder Person existiert nicht.");
    if (
      get(db, "SELECT 1 FROM license_assignments WHERE person_id = :p AND license_type_id = :t AND revoked_at IS NULL", {
        p: body.personId,
        t: body.licenseTypeId,
      })
    ) {
      throw conflict("Die Person hat diese Lizenz bereits.");
    }
    run(db, "INSERT INTO license_assignments (license_type_id, person_id) VALUES (:t, :p)", {
      t: body.licenseTypeId,
      p: body.personId,
    });
    audit(db, user, {
      action: "license.assigned",
      entityType: "person",
      entityId: body.personId,
      summary: `Lizenz „${type.name}“ an ${person.name} vergeben`,
    });
    res.status(201).json({ ok: true });
  });

  r.delete("/licenses/assignments/:id", (req, res) => {
    const user = requireRole(req, "finance", "team_lead");
    const id = idParam(req);
    const row = get<{ person_id: number; name: string; license: string }>(
      db,
      `SELECT la.person_id, p.name, lt.name AS license FROM license_assignments la
       JOIN people p ON p.id = la.person_id JOIN license_types lt ON lt.id = la.license_type_id
       WHERE la.id = :id AND la.revoked_at IS NULL`,
      { id },
    );
    if (!row) throw notFound("Lizenzzuweisung");
    run(db, "UPDATE license_assignments SET revoked_at = :now WHERE id = :id", { now: nowIso(), id });
    audit(db, user, {
      action: "license.revoked",
      entityType: "person",
      entityId: row.person_id,
      summary: `Lizenz „${row.license}“ von ${row.name} entzogen`,
    });
    res.status(204).end();
  });

  // --- discovery ---------------------------------------------------------------------

  r.get("/discovery", (req, res) => {
    requireUser(req);
    const { status } = parse(z.object({ status: z.enum(["new", "linked", "ignored"]).optional() }), req.query);
    res.json(listDiscoveries(db, status));
  });

  r.post("/discovery/reports", (req, res) => {
    const actor = requireUserOrScope(req, "discovery:write", "admin", "architecture", "security");
    const body = parse(
      z.object({
        source: z.string().trim().max(100).default("scanner"),
        findings: z
          .array(
            z.object({
              repoUrl: z.string().trim().min(1).max(500),
              path: z.string().trim().max(500).default(""),
              kind: z.enum(discoveryKinds),
              details: z.record(z.unknown()).default({}),
            }),
          )
          .max(10_000),
      }),
      req.body,
    );
    const result = ingestDiscoveries(db, body.findings, body.source);
    audit(db, actor, {
      action: "discovery.reported",
      entityType: "discovery",
      summary: `Discovery-Bericht (${body.source}): ${body.findings.length} Funde, ${result.created} neu, ${result.linked} zugeordnet`,
    });
    res.status(201).json(result);
  });

  r.post("/discovery/:id/:action", (req, res) => {
    const user = requireRole(req, "architecture", "security");
    const id = idParam(req);
    const action = req.params.action;
    const row = get<{ id: number; repo_url: string; kind: string }>(db, "SELECT * FROM discoveries WHERE id = :id", { id });
    if (!row) throw notFound("Fund");
    if (action === "link") {
      const { assetId } = parse(z.object({ assetId: z.number().int().positive() }), req.body);
      if (!get(db, "SELECT 1 FROM assets WHERE id = :id", { id: assetId })) throw badRequest("Asset existiert nicht.");
      run(db, "UPDATE discoveries SET status = 'linked', asset_id = :a WHERE id = :id", { a: assetId, id });
    } else if (action === "ignore") {
      run(db, "UPDATE discoveries SET status = 'ignored' WHERE id = :id", { id });
    } else if (action === "reopen") {
      run(db, "UPDATE discoveries SET status = 'new', asset_id = NULL WHERE id = :id", { id });
    } else {
      throw notFound("Aktion");
    }
    audit(db, user, {
      action: `discovery.${action}`,
      entityType: "discovery",
      entityId: id,
      summary: `Fund ${row.kind} in ${row.repo_url}: ${action}`,
    });
    res.json({ ok: true });
  });

  // --- policies ------------------------------------------------------------------------

  r.get("/policies", (req, res) => {
    requireUser(req);
    const generated = generatePolicy(db);
    res.json({
      governance: getGovernance(db),
      claudeCode: getClaudeCodePolicy(db),
      generated,
      paths: MANAGED_SETTINGS_PATHS,
    });
  });

  r.put("/policies/governance", (req, res) => {
    const user = requireRole(req, "admin");
    const body = parse(
      z.object({
        reviewIntervalDays: z.number().int().min(7).max(1095),
        globalMonthlyBudgetUsd: z.number().nonnegative(),
        budgetAlertPercent: z.number().int().min(1).max(100),
        financeApprovalThresholdUsd: z.number().nonnegative(),
        inactiveSeatDays: z.number().int().min(1).max(365),
        redundancyThreshold: z.number().min(0.1).max(0.95),
        allowedModels: z.array(z.string().trim().min(1).max(100)).max(50),
      }),
      req.body,
    );
    const before = getGovernance(db);
    setGovernance(db, body);
    refreshOpenApprovalRounds(db);
    audit(db, user, {
      action: "policy.governance",
      entityType: "settings",
      entityId: "governance",
      summary: "Governance-Richtlinien geändert",
      changes: diff(before as never, body as never),
    });
    res.json(getGovernance(db));
  });

  r.put("/policies/claude-code", (req, res) => {
    const user = requireRole(req, "security");
    const rule = z.string().trim().min(1).max(300);
    const body = parse(
      z.object({
        allowRules: z.array(rule).max(200),
        askRules: z.array(rule).max(200),
        denyRules: z.array(rule).max(200),
        disableBypassPermissions: z.boolean(),
        allowManagedPermissionRulesOnly: z.boolean(),
        allowManagedHooksOnly: z.boolean(),
        allowManagedMcpServersOnly: z.boolean(),
        availableModels: z.array(z.string().trim().min(1).max(100)).max(50),
        sandboxEnabled: z.boolean(),
        sandboxAllowedDomains: z.array(z.string().trim().min(1).max(253)).max(500),
        sandboxAllowManagedDomainsOnly: z.boolean(),
        cleanupPeriodDays: z.number().int().min(1).max(3650).nullable(),
        requiredMinimumVersion: z.string().trim().max(30).nullable(),
        forceLoginMethod: z.enum(["claudeai", "console"]).nullable(),
        forceLoginOrgUUID: z
          .string()
          .trim()
          .uuid()
          .nullable()
          .or(z.literal("").transform(() => null)),
        companyAnnouncements: z.array(z.string().trim().min(1).max(500)).max(10),
        telemetryEnabled: z.boolean(),
        otlpEndpoint: z
          .string()
          .trim()
          .url()
          .nullable()
          .or(z.literal("").transform(() => null)),
      }),
      req.body,
    ) as ClaudeCodePolicy;
    const before = getClaudeCodePolicy(db);
    setClaudeCodePolicy(db, body);
    audit(db, user, {
      action: "policy.claude_code",
      entityType: "settings",
      entityId: "claude_code_policy",
      summary: "Claude-Code-Policy geändert",
      changes: diff(before as never, body as never),
    });
    res.json(generatePolicy(db));
  });

  /** Download endpoint – also usable by MDM/Ansible/Intune with an API token (scope policy:read). */
  r.get("/policies/claude-code/managed-settings.json", (req, res) => {
    requireUserOrScope(req, "policy:read");
    res.setHeader("Content-Disposition", 'attachment; filename="managed-settings.json"');
    res.type("application/json").send(`${JSON.stringify(generatePolicy(db).settings, null, 2)}\n`);
  });

  // --- people & teams ------------------------------------------------------------------

  r.get("/org/people", (req, res) => {
    requireUser(req);
    res.json(
      all<Record<string, unknown>>(
        db,
        `SELECT p.id, p.email, p.name, p.roles, p.team_id AS teamId, t.name AS teamName, p.active, p.last_login_at AS lastLoginAt,
           (p.password_hash IS NOT NULL) AS hasPassword, (p.external_id IS NOT NULL) AS entraLinked
         FROM people p LEFT JOIN teams t ON t.id = p.team_id ORDER BY p.name COLLATE NOCASE`,
      ).map((p) => ({
        ...p,
        roles: parseJson(p.roles, []),
        active: !!p.active,
        hasPassword: !!p.hasPassword,
        entraLinked: !!p.entraLinked,
      })),
    );
  });

  const personSchema = z.object({
    email: z.string().trim().toLowerCase().email(),
    name: z.string().trim().min(2).max(120),
    roles: z.array(roleSchema).min(1),
    teamId: z.number().int().positive().nullable().default(null),
    active: z.boolean().default(true),
    password: z.string().min(10, "Passwort muss mindestens 10 Zeichen haben.").max(200).optional(),
  });

  r.post("/org/people", (req, res) => {
    const user = requireRole(req, "admin");
    const body = parse(personSchema, req.body);
    if (get(db, "SELECT 1 FROM people WHERE email = :e", { e: body.email }))
      throw conflict("E-Mail-Adresse ist bereits vergeben.");
    const result = run(
      db,
      "INSERT INTO people (email, name, roles, team_id, active, password_hash) VALUES (:e, :n, :r, :t, :a, :p)",
      {
        e: body.email,
        n: body.name,
        r: JSON.stringify(body.roles),
        t: body.teamId,
        a: body.active,
        p: body.password ? hashPassword(body.password) : null,
      },
    );
    audit(db, user, {
      action: "person.created",
      entityType: "person",
      entityId: Number(result.lastInsertRowid),
      summary: `Person ${body.name} angelegt (${body.roles.join(", ")})`,
    });
    res.status(201).json({ id: Number(result.lastInsertRowid) });
  });

  r.put("/org/people/:id", (req, res) => {
    const user = requireRole(req, "admin");
    const id = idParam(req);
    const body = parse(personSchema, req.body);
    const before = get<{ name: string; roles: string; active: number }>(db, "SELECT * FROM people WHERE id = :id", { id });
    if (!before) throw notFound("Person");
    if (id === user.id && (!body.roles.includes("admin") || !body.active)) {
      throw conflict("Eigene Admin-Rechte können nicht entzogen werden.");
    }
    run(db, "UPDATE people SET email = :e, name = :n, roles = :r, team_id = :t, active = :a WHERE id = :id", {
      e: body.email,
      n: body.name,
      r: JSON.stringify(body.roles),
      t: body.teamId,
      a: body.active,
      id,
    });
    if (body.password) run(db, "UPDATE people SET password_hash = :p WHERE id = :id", { p: hashPassword(body.password), id });
    if (!body.active) run(db, "DELETE FROM sessions WHERE person_id = :id", { id });
    audit(db, user, {
      action: "person.updated",
      entityType: "person",
      entityId: id,
      summary: `Person ${body.name} geändert${body.password ? " (Passwort gesetzt)" : ""}`,
      changes: diff({ roles: parseJson(before.roles, []), active: !!before.active }, { roles: body.roles, active: body.active }),
    });
    res.json({ ok: true });
  });

  r.get("/org/teams", (req, res) => {
    requireUser(req);
    res.json(
      all(
        db,
        `SELECT t.id, t.name, t.cost_center AS costCenter, t.monthly_budget_usd AS monthlyBudgetUsd,
           (SELECT COUNT(*) FROM people p WHERE p.team_id = t.id AND p.active = 1) AS members,
           (SELECT COUNT(*) FROM assets a WHERE a.team_id = t.id AND a.status NOT IN ('retired', 'rejected')) AS assets
         FROM teams t ORDER BY t.name COLLATE NOCASE`,
      ),
    );
  });

  const teamSchema = z.object({
    name: z.string().trim().min(2).max(100),
    costCenter: z.string().trim().max(50).nullable().default(null),
    monthlyBudgetUsd: z.number().nonnegative().nullable().default(null),
  });

  r.post("/org/teams", (req, res) => {
    const user = requireRole(req, "admin");
    const body = parse(teamSchema, req.body);
    if (get(db, "SELECT 1 FROM teams WHERE name = :n", { n: body.name })) throw conflict("Team existiert bereits.");
    const result = run(db, "INSERT INTO teams (name, cost_center, monthly_budget_usd) VALUES (:n, :c, :b)", {
      n: body.name,
      c: body.costCenter,
      b: body.monthlyBudgetUsd,
    });
    audit(db, user, {
      action: "team.created",
      entityType: "team",
      entityId: Number(result.lastInsertRowid),
      summary: `Team ${body.name} angelegt`,
    });
    res.status(201).json({ id: Number(result.lastInsertRowid) });
  });

  r.put("/org/teams/:id", (req, res) => {
    const user = requireRole(req, "admin");
    const id = idParam(req);
    const body = parse(teamSchema, req.body);
    const result = run(db, "UPDATE teams SET name = :n, cost_center = :c, monthly_budget_usd = :b WHERE id = :id", {
      n: body.name,
      c: body.costCenter,
      b: body.monthlyBudgetUsd,
      id,
    });
    if (!result.changes) throw notFound("Team");
    audit(db, user, {
      action: "team.updated",
      entityType: "team",
      entityId: id,
      summary: `Team ${body.name} geändert`,
      changes: body,
    });
    res.json({ ok: true });
  });

  // --- API tokens ----------------------------------------------------------------------

  r.get("/tokens", (req, res) => {
    requireRole(req, "admin");
    res.json(
      all<Record<string, unknown>>(
        db,
        `SELECT t.id, t.name, t.prefix, t.scopes, t.created_at AS createdAt, t.last_used_at AS lastUsedAt, t.revoked_at AS revokedAt,
           p.name AS createdBy
         FROM api_tokens t LEFT JOIN people p ON p.id = t.created_by ORDER BY t.id DESC`,
      ).map((t) => ({ ...t, scopes: parseJson(t.scopes, []) })),
    );
  });

  r.post("/tokens", (req, res) => {
    const user = requireRole(req, "admin");
    const scopeKeys = Object.keys(TOKEN_SCOPES) as [TokenScope, ...TokenScope[]];
    const body = parse(
      z.object({ name: z.string().trim().min(2).max(100), scopes: z.array(z.enum(scopeKeys)).min(1) }),
      req.body,
    );
    const created = createApiToken(db, body.name, body.scopes, user.id);
    audit(db, user, {
      action: "token.created",
      entityType: "token",
      entityId: created.id,
      summary: `API-Token „${body.name}“ erstellt (${body.scopes.join(", ")})`,
    });
    res.status(201).json(created);
  });

  r.delete("/tokens/:id", (req, res) => {
    const user = requireRole(req, "admin");
    const id = idParam(req);
    const result = run(db, "UPDATE api_tokens SET revoked_at = :now WHERE id = :id AND revoked_at IS NULL", {
      now: nowIso(),
      id,
    });
    if (!result.changes) throw notFound("API-Token");
    audit(db, user, { action: "token.revoked", entityType: "token", entityId: id, summary: "API-Token widerrufen" });
    res.status(204).end();
  });

  // --- audit -------------------------------------------------------------------------

  r.get("/audit", (req, res) => {
    requireRole(req, "security", "architecture");
    const q = parse(
      z.object({
        entityType: z.string().optional(),
        entityId: z.string().optional(),
        q: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
        offset: z.coerce.number().int().min(0).default(0),
      }),
      req.query,
    );
    res.json(listAudit(db, q));
  });

  return r;
}
