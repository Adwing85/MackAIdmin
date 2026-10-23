import { Router } from "express";
import { z } from "zod";
import { all, get, nowIso, run, type DB } from "../db/database.js";
import { canWrite, hasRole, requireRole, requireUser } from "../auth/auth.js";
import { assessRisk } from "../domain/risk.js";
import { requiredApprovals } from "../domain/approvals.js";
import { RULES } from "../domain/findings.js";
import { badRequest, conflict, forbidden, idParam, notFound, parse } from "../lib/http.js";
import {
  createAsset,
  evaluateAsset,
  evaluateInventory,
  loadAsset,
  loadAssets,
  permissionJustifications,
  updateAsset,
  type AssetInput,
} from "../services/assets.js";
import { audit, diff, listAudit } from "../services/audit.js";
import { assetDailyUsage } from "../services/costs.js";
import { listDiscoveries } from "../services/discovery.js";
import { findingsOverview, redundancyCandidates, similarAssets, toSimilarityInput } from "../services/insights.js";
import { getGovernance } from "../services/settings.js";
import {
  availableTransitions,
  canAcceptRisk,
  decideApproval,
  ensureApprovalRows,
  handleAssetChange,
  isAssetEditor,
  transitionAsset,
} from "../services/workflow.js";
import { assetInputSchema, assetPreviewSchema, assetStatusSchema } from "./schemas.js";

function summarize(e: ReturnType<typeof evaluateInventory>[number]) {
  return {
    id: e.asset.id,
    key: e.asset.key,
    name: e.asset.name,
    type: e.asset.type,
    status: e.asset.status,
    description: e.asset.description,
    capabilities: e.asset.capabilities,
    tags: e.asset.tags,
    exposure: e.asset.exposure,
    models: e.asset.models,
    owner: e.owner,
    team: e.team,
    riskScore: e.risk.score,
    riskLevel: e.risk.level,
    approvalState: e.approvalState,
    openFindings: e.openFindings,
    worstOpenSeverity: e.worstOpenSeverity,
    mtdCostUsd: e.mtdCostUsd,
    monthlyBudgetUsd: e.asset.monthlyBudgetUsd,
    updatedAt: e.asset.updatedAt,
  };
}

function validateReferences(db: DB, input: AssetInput): void {
  if (input.ownerId && !get(db, "SELECT 1 FROM people WHERE id = :id", { id: input.ownerId })) {
    throw badRequest("Owner existiert nicht.");
  }
  if (input.teamId && !get(db, "SELECT 1 FROM teams WHERE id = :id", { id: input.teamId })) {
    throw badRequest("Team existiert nicht.");
  }
  for (const dep of input.dependencies) {
    if (!get(db, "SELECT 1 FROM assets WHERE id = :id", { id: dep })) throw badRequest(`Abhängigkeit ${dep} existiert nicht.`);
  }
}

export function assetsRouter(db: DB): Router {
  const r = Router();

  r.get("/assets", (req, res) => {
    requireUser(req);
    const q = parse(
      z.object({
        type: z.string().optional(),
        status: z.string().optional(),
        teamId: z.coerce.number().optional(),
        risk: z.string().optional(),
        q: z.string().optional(),
        mine: z.string().optional(),
        includeRetired: z.string().optional(),
      }),
      req.query,
    );
    const user = req.user!;
    let items = evaluateInventory(db);
    if (!q.includeRetired && !q.status) items = items.filter((e) => e.asset.status !== "retired");
    if (q.type) items = items.filter((e) => e.asset.type === q.type);
    if (q.status) items = items.filter((e) => e.asset.status === q.status);
    if (q.teamId) items = items.filter((e) => e.asset.teamId === q.teamId);
    if (q.risk) items = items.filter((e) => e.risk.level === q.risk);
    if (q.mine) items = items.filter((e) => e.asset.ownerId === user.id || e.asset.createdBy === user.id);
    if (q.q) {
      const needle = q.q.toLowerCase();
      items = items.filter((e) =>
        [e.asset.name, e.asset.key, e.asset.description, e.asset.purpose, ...e.asset.capabilities, ...e.asset.tags]
          .join(" ")
          .toLowerCase()
          .includes(needle),
      );
    }
    res.json(items.map(summarize));
  });

  r.post("/assets/preview", (req, res) => {
    requireUser(req);
    const input = parse(assetPreviewSchema, req.body);
    const risk = assessRisk({ ...input, permissions: input.permissions.map((p) => p.key) });
    const settings = getGovernance(db);
    const approvals = requiredApprovals({ ...input, permissions: input.permissions.map((p) => p.key) }, risk, settings);
    const similar =
      input.name.trim().length >= 3 || input.description.trim().length >= 10
        ? similarAssets(db, toSimilarityInput({ ...input, id: input.id ?? 0 })).filter((s) => s.id !== input.id)
        : [];
    res.json({ risk, requiredApprovals: approvals, similar });
  });

  r.post("/assets", (req, res) => {
    const user = requireUser(req);
    if (!canWrite(user)) throw forbidden();
    const input = parse(assetInputSchema, req.body) as AssetInput;
    input.ownerId ??= user.id;
    input.teamId ??= user.teamId;
    validateReferences(db, input);
    const asset = createAsset(db, input, user.id);
    audit(db, user, {
      action: "asset.created",
      entityType: "asset",
      entityId: asset.id,
      summary: `Asset „${asset.name}“ (${asset.type}) registriert`,
    });
    res.status(201).json({ id: asset.id, key: asset.key });
  });

  r.get("/assets/:id", (req, res) => {
    const user = requireUser(req);
    const id = idParam(req);
    const evaluated = evaluateAsset(db, id);
    if (!evaluated) throw notFound("Asset");
    const asset = evaluated.asset;
    const others = loadAssets(db);
    const brief = (a: (typeof others)[number]) => ({ id: a.id, key: a.key, name: a.name, type: a.type, status: a.status });
    const canEdit = isAssetEditor(user, asset);
    res.json({
      ...evaluated,
      permissionJustifications: permissionJustifications(db, id),
      dependencies: others.filter((o) => asset.dependencies.includes(o.id)).map(brief),
      dependents: others.filter((o) => o.dependencies.includes(id)).map(brief),
      transitions: canEdit ? availableTransitions(asset.status).filter((t) => !t.adminOnly || hasRole(user, "admin")) : [],
      canEdit,
      canReview: canEdit || hasRole(user, "architecture", "security"),
      usage: assetDailyUsage(db, id),
      similar: similarAssets(db, toSimilarityInput(asset)).filter((s) => s.id !== id),
      discoveries: listDiscoveries(db).filter((d) => d.assetId === id),
      history: listAudit(db, { entityType: "asset", entityId: String(id), limit: 50, offset: 0 }).items,
    });
  });

  r.put("/assets/:id", (req, res) => {
    const user = requireUser(req);
    const id = idParam(req);
    const before = loadAsset(db, id);
    if (!before) throw notFound("Asset");
    if (!isAssetEditor(user, before))
      throw forbidden("Nur Owner, Ersteller:in, Teamleitung oder Admins dürfen das Asset bearbeiten.");
    if (before.status === "retired") throw conflict("Stillgelegte Assets können nicht bearbeitet werden.");
    const input = parse(assetInputSchema, req.body) as AssetInput;
    validateReferences(db, input);
    if (input.dependencies.includes(id)) throw badRequest("Ein Asset kann nicht von sich selbst abhängen.");
    const after = updateAsset(db, id, input);
    const changes = diff(before as never, after as never);
    if (Object.keys(changes).length) {
      audit(db, user, {
        action: "asset.updated",
        entityType: "asset",
        entityId: id,
        summary: `Asset „${after.name}“ geändert: ${Object.keys(changes).join(", ")}`,
        changes,
      });
    }
    const riskChanges = handleAssetChange(db, before, after, user);
    res.json({ id, newApprovalRound: riskChanges.length > 0 && before.status !== "draft" && before.status !== "rejected" });
  });

  r.delete("/assets/:id", (req, res) => {
    const user = requireRole(req, "admin");
    const id = idParam(req);
    const asset = loadAsset(db, id);
    if (!asset) throw notFound("Asset");
    run(db, "DELETE FROM assets WHERE id = :id", { id });
    audit(db, user, { action: "asset.deleted", entityType: "asset", entityId: id, summary: `Asset „${asset.name}“ gelöscht` });
    res.status(204).end();
  });

  r.post("/assets/:id/transition", (req, res) => {
    const user = requireUser(req);
    const { to } = parse(z.object({ to: assetStatusSchema }), req.body);
    const asset = transitionAsset(db, idParam(req), to, user);
    res.json({ id: asset.id, status: asset.status });
  });

  r.post("/assets/:id/review", (req, res) => {
    const user = requireUser(req);
    const id = idParam(req);
    const asset = loadAsset(db, id);
    if (!asset) throw notFound("Asset");
    if (!isAssetEditor(user, asset) && !hasRole(user, "architecture", "security")) throw forbidden();
    const { note } = parse(z.object({ note: z.string().trim().max(1000).default("") }), req.body ?? {});
    run(db, "UPDATE assets SET last_review_at = :now WHERE id = :id", { now: nowIso(), id });
    audit(db, user, {
      action: "asset.reviewed",
      entityType: "asset",
      entityId: id,
      summary: `Review für „${asset.name}“ durchgeführt${note ? `: ${note}` : ""}`,
    });
    res.json({ ok: true });
  });

  r.post("/assets/:id/acceptances", (req, res) => {
    const user = requireUser(req);
    const id = idParam(req);
    const body = parse(
      z.object({
        ruleId: z.string(),
        justification: z.string().trim().min(10, "Bitte eine aussagekräftige Begründung angeben (mind. 10 Zeichen)."),
        days: z.number().int().min(1).max(365).default(90),
      }),
      req.body,
    );
    const evaluated = evaluateAsset(db, id);
    if (!evaluated) throw notFound("Asset");
    const finding = evaluated.findings.find((f) => f.ruleId === body.ruleId);
    if (!finding) throw badRequest("Dieser Befund liegt für das Asset nicht (mehr) vor.");
    if (finding.acceptance) throw conflict("Für diesen Befund existiert bereits eine gültige Risikoakzeptanz.");
    if (!canAcceptRisk(user, finding.category)) {
      throw forbidden(`Risiken der Kategorie „${finding.category}“ dürfen nur die zuständigen Rollen akzeptieren.`);
    }
    if (evaluated.asset.ownerId === user.id || evaluated.asset.createdBy === user.id) {
      throw forbidden("Vier-Augen-Prinzip: Risiken eigener Assets können nicht selbst akzeptiert werden.");
    }
    const expires = new Date(Date.now() + body.days * 86_400_000).toISOString();
    run(
      db,
      "INSERT INTO risk_acceptances (asset_id, rule_id, justification, accepted_by, expires_at) VALUES (:a, :r, :j, :u, :e)",
      { a: id, r: body.ruleId, j: body.justification, u: user.id, e: expires },
    );
    audit(db, user, {
      action: "risk.accepted",
      entityType: "asset",
      entityId: id,
      summary: `Risiko ${body.ruleId} („${finding.title}“) für „${evaluated.asset.name}“ akzeptiert bis ${expires.slice(0, 10)}: ${body.justification}`,
    });
    res.status(201).json({ ok: true });
  });

  r.delete("/acceptances/:id", (req, res) => {
    const user = requireUser(req);
    const id = idParam(req);
    const acc = get<{ id: number; asset_id: number; rule_id: string; accepted_by: number | null }>(
      db,
      "SELECT * FROM risk_acceptances WHERE id = :id AND revoked_at IS NULL",
      { id },
    );
    if (!acc) throw notFound("Risikoakzeptanz");
    const rule = RULES.find((r) => r.id === acc.rule_id);
    if (acc.accepted_by !== user.id && !canAcceptRisk(user, rule?.category ?? "")) throw forbidden();
    run(db, "UPDATE risk_acceptances SET revoked_at = :now WHERE id = :id", { now: nowIso(), id });
    audit(db, user, {
      action: "risk.revoked",
      entityType: "asset",
      entityId: acc.asset_id,
      summary: `Risikoakzeptanz für ${acc.rule_id} widerrufen`,
    });
    res.status(204).end();
  });

  // --- approvals -------------------------------------------------------------------

  r.get("/approvals", (req, res) => {
    const user = requireUser(req);
    const { scope } = parse(z.object({ scope: z.enum(["mine", "open", "history"]).default("mine") }), req.query);
    const inventory = new Map(evaluateInventory(db).map((e) => [e.asset.id, e]));
    const rows = all<{ id: number }>(
      db,
      scope === "history"
        ? "SELECT id FROM approvals WHERE decision <> 'pending' ORDER BY decided_at DESC LIMIT 200"
        : `SELECT ap.id FROM approvals ap JOIN assets a ON a.id = ap.asset_id
           WHERE ap.decision = 'pending' AND ap.round = a.approval_round AND a.status NOT IN ('retired', 'rejected')
           ORDER BY ap.created_at`,
    );
    const ids = new Set(rows.map((r) => r.id));
    const items = [...inventory.values()]
      .flatMap((e) =>
        e.approvals
          .filter((a) => ids.has(a.id))
          .map((a) => ({
            ...a,
            asset: {
              id: e.asset.id,
              name: e.asset.name,
              type: e.asset.type,
              status: e.asset.status,
              riskLevel: e.risk.level,
              riskScore: e.risk.score,
              openFindings: e.openFindings,
              owner: e.owner?.name ?? null,
              team: e.team?.name ?? null,
            },
            canDecide:
              a.decision === "pending" &&
              hasRole(user, a.role as never) &&
              e.asset.ownerId !== user.id &&
              e.asset.createdBy !== user.id,
          })),
      )
      .filter((a) => scope !== "mine" || a.canDecide)
      .sort((x, y) =>
        scope === "history" ? (y.decidedAt ?? "").localeCompare(x.decidedAt ?? "") : x.createdAt.localeCompare(y.createdAt),
      );
    res.json(items);
  });

  r.post("/approvals/:id/decide", (req, res) => {
    const user = requireUser(req);
    const body = parse(
      z.object({ decision: z.enum(["approved", "rejected"]), comment: z.string().trim().max(2000).default("") }),
      req.body,
    );
    res.json(decideApproval(db, idParam(req), body.decision, body.comment, user));
  });

  r.post("/assets/:id/approvals/refresh", (req, res) => {
    requireRole(req, "admin");
    ensureApprovalRows(db, idParam(req));
    res.json({ ok: true });
  });

  // --- findings & redundancy ----------------------------------------------------------

  r.get("/findings", (req, res) => {
    requireUser(req);
    res.json(findingsOverview(evaluateInventory(db)));
  });

  r.get("/redundancy", (req, res) => {
    requireUser(req);
    res.json(redundancyCandidates(db));
  });

  r.post("/redundancy/decision", (req, res) => {
    const user = requireRole(req, "architecture", "team_lead");
    const body = parse(
      z.object({
        assetA: z.number().int().positive(),
        assetB: z.number().int().positive(),
        decision: z.enum(["intended", "consolidate", "false_positive"]).nullable(),
        note: z.string().trim().max(1000).default(""),
      }),
      req.body,
    );
    const [lo, hi] = body.assetA < body.assetB ? [body.assetA, body.assetB] : [body.assetB, body.assetA];
    if (lo === hi) throw badRequest("Zwei unterschiedliche Assets angeben.");
    if (body.decision === null) {
      run(db, "DELETE FROM redundancy_reviews WHERE asset_a = :a AND asset_b = :b", { a: lo, b: hi });
    } else {
      run(
        db,
        `INSERT INTO redundancy_reviews (asset_a, asset_b, decision, note, decided_by, decided_at) VALUES (:a, :b, :d, :n, :u, :now)
         ON CONFLICT(asset_a, asset_b) DO UPDATE SET decision = excluded.decision, note = excluded.note,
           decided_by = excluded.decided_by, decided_at = excluded.decided_at`,
        { a: lo, b: hi, d: body.decision, n: body.note, u: user.id, now: nowIso() },
      );
    }
    const names = loadAssets(db, "WHERE id IN (:a, :b)", { a: lo, b: hi }).map((a) => a.name);
    const labels = { intended: "bewusst parallel", consolidate: "konsolidieren", false_positive: "keine Redundanz" };
    audit(db, user, {
      action: "redundancy.decision",
      entityType: "asset",
      entityId: lo,
      summary: `Redundanz ${names.join(" ↔ ")}: ${body.decision ? labels[body.decision] : "Entscheidung zurückgesetzt"}${
        body.note ? ` – ${body.note}` : ""
      }`,
    });
    res.json({ ok: true });
  });

  return r;
}
