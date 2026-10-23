import { all, get, type DB } from "../db/database.js";
import { findRedundancyPairs, findSimilar, type SimilarityInput } from "../domain/redundancy.js";
import { SEVERITY_ORDER } from "../domain/findings.js";
import { hasRole, type CurrentUser } from "../auth/auth.js";
import { evaluateInventory, loadAssets, type EvaluatedAsset } from "./assets.js";
import { costSummary } from "./costs.js";
import { licenseOverview } from "./licenses.js";
import { getGovernance } from "./settings.js";
import { listAudit } from "./audit.js";

const ACTIVE_FOR_REDUNDANCY = ["draft", "in_review", "approved", "active", "deprecated"];

export function toSimilarityInput(a: {
  id: number;
  name: string;
  type: string;
  description: string;
  purpose: string;
  capabilities: string[];
  tags: string[];
}): SimilarityInput {
  return {
    id: a.id,
    name: a.name,
    type: a.type,
    description: a.description,
    purpose: a.purpose,
    capabilities: a.capabilities,
    tags: a.tags,
  };
}

export function similarAssets(db: DB, draft: SimilarityInput, limit = 5) {
  const assets = loadAssets(db).filter((a) => ACTIVE_FOR_REDUNDANCY.includes(a.status));
  const byId = new Map(assets.map((a) => [a.id, a]));
  return findSimilar(draft, assets.map(toSimilarityInput), { limit }).map((m) => {
    const a = byId.get(m.id)!;
    return { ...m, key: a.key, name: a.name, type: a.type, status: a.status, ownerId: a.ownerId, teamId: a.teamId };
  });
}

export function redundancyCandidates(db: DB) {
  const settings = getGovernance(db);
  const assets = loadAssets(db).filter((a) => ACTIVE_FOR_REDUNDANCY.includes(a.status));
  const byId = new Map(assets.map((a) => [a.id, a]));
  const teams = new Map(all<{ id: number; name: string }>(db, "SELECT id, name FROM teams").map((t) => [t.id, t.name]));
  const decisions = new Map(
    all<{ asset_a: number; asset_b: number; decision: string; note: string; decided_at: string; name: string | null }>(
      db,
      "SELECT r.*, p.name FROM redundancy_reviews r LEFT JOIN people p ON p.id = r.decided_by",
    ).map((d) => [`${d.asset_a}:${d.asset_b}`, d]),
  );
  const summary = (id: number) => {
    const a = byId.get(id)!;
    return {
      id: a.id,
      key: a.key,
      name: a.name,
      type: a.type,
      status: a.status,
      team: a.teamId ? (teams.get(a.teamId) ?? null) : null,
    };
  };
  return findRedundancyPairs(assets.map(toSimilarityInput), settings.redundancyThreshold).map((p) => {
    const [lo, hi] = p.id < p.otherId ? [p.id, p.otherId] : [p.otherId, p.id];
    const d = decisions.get(`${lo}:${hi}`);
    return {
      score: p.score,
      sharedCapabilities: p.sharedCapabilities,
      sharedTerms: p.sharedTerms,
      a: summary(lo),
      b: summary(hi),
      crossTeam: byId.get(lo)!.teamId !== byId.get(hi)!.teamId,
      decision: d ? { decision: d.decision, note: d.note, decidedAt: d.decided_at, decidedBy: d.name } : null,
    };
  });
}

export function findingsOverview(inventory: EvaluatedAsset[]) {
  return inventory
    .flatMap((e) =>
      e.findings.map((f) => ({
        ...f,
        asset: { id: e.asset.id, key: e.asset.key, name: e.asset.name, type: e.asset.type, status: e.asset.status },
        team: e.team?.name ?? null,
        owner: e.owner?.name ?? null,
      })),
    )
    .sort(
      (a, b) =>
        Number(!!a.acceptance) - Number(!!b.acceptance) ||
        SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
        a.asset.name.localeCompare(b.asset.name),
    );
}

export function dashboard(db: DB, user: CurrentUser, now = new Date()) {
  const inventory = evaluateInventory(db, now);
  const count = <K extends string>(keys: K[]) => Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;

  const byStatus: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const byRisk = count(["low", "medium", "high", "critical"]);
  const openBySeverity = count(["critical", "high", "medium", "low"]);
  let accepted = 0;
  for (const e of inventory) {
    byStatus[e.asset.status] = (byStatus[e.asset.status] ?? 0) + 1;
    if (!["retired", "rejected"].includes(e.asset.status)) {
      byType[e.asset.type] = (byType[e.asset.type] ?? 0) + 1;
      byRisk[e.risk.level]++;
    }
    for (const f of e.findings) {
      if (f.acceptance) accepted++;
      else openBySeverity[f.severity]++;
    }
  }

  const attention = inventory
    .filter((e) => e.worstOpenSeverity === "critical" || e.worstOpenSeverity === "high")
    .sort(
      (a, b) =>
        SEVERITY_ORDER.indexOf(a.worstOpenSeverity!) - SEVERITY_ORDER.indexOf(b.worstOpenSeverity!) ||
        b.risk.score - a.risk.score,
    )
    .slice(0, 8)
    .map((e) => ({
      id: e.asset.id,
      name: e.asset.name,
      type: e.asset.type,
      status: e.asset.status,
      riskLevel: e.risk.level,
      riskScore: e.risk.score,
      worst: e.worstOpenSeverity,
      openFindings: e.openFindings,
      topFinding: e.findings.find((f) => !f.acceptance)?.title ?? null,
    }));

  const pendingApprovals = all<{ role: string; asset_id: number }>(
    db,
    `SELECT ap.role, ap.asset_id FROM approvals ap JOIN assets a ON a.id = ap.asset_id
     WHERE ap.decision = 'pending' AND ap.round = a.approval_round AND a.status NOT IN ('retired', 'rejected')`,
  );
  const mine = pendingApprovals.filter((p) => {
    const asset = inventory.find((e) => e.asset.id === p.asset_id)?.asset;
    return hasRole(user, p.role as never) && asset && asset.ownerId !== user.id && asset.createdBy !== user.id;
  });

  const costs = costSummary(db, now, false);
  const licenses = licenseOverview(db, now);
  const redundancy = redundancyCandidates(db);

  return {
    assets: {
      total: inventory.filter((e) => !["retired", "rejected"].includes(e.asset.status)).length,
      live: inventory.filter((e) => ["approved", "active", "deprecated"].includes(e.asset.status)).length,
      byStatus,
      byType,
      byRisk,
    },
    findings: { openBySeverity, accepted },
    approvals: { pending: pendingApprovals.length, pendingForMe: mine.length },
    costs: {
      mtdUsd: costs.mtdUsd,
      forecastUsd: costs.forecastUsd,
      budgetUsd: costs.budgetUsd,
      previousMonthUsd: costs.previousMonthUsd,
      budgetAlertPercent: costs.budgetAlertPercent,
      daily: costs.daily.slice(-30),
      byTeam: costs.byTeam.slice(0, 6),
      byAsset: costs.byAsset.slice(0, 6),
    },
    licenses: licenses.kpis,
    discovery: {
      new: get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM discoveries WHERE status = 'new'")?.n ?? 0,
    },
    redundancy: {
      open: redundancy.filter((r) => !r.decision).length,
      consolidate: redundancy.filter((r) => r.decision?.decision === "consolidate").length,
    },
    attention,
    recent: listAudit(db, { limit: 8, offset: 0 }).items,
  };
}
