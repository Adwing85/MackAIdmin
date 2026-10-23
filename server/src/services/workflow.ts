// Approval workflow and lifecycle transitions.

import { all, get, nowIso, run, transaction, type DB } from "../db/database.js";
import { ASSET_STATUSES, ROLES, type AssetStatus } from "../domain/catalog.js";
import { riskRelevantChanges } from "../domain/approvals.js";
import type { Asset } from "../domain/types.js";
import { hasRole, type CurrentUser } from "../auth/auth.js";
import { conflict, forbidden, notFound } from "../lib/http.js";
import { audit } from "./audit.js";
import { evaluateAsset, loadAsset, setAssetStatus } from "./assets.js";

const REVIEWED_STATUSES: AssetStatus[] = ["in_review", "approved", "active", "deprecated"];

/** Creates pending approval rows for every role the current round requires (idempotent). */
export function ensureApprovalRows(db: DB, assetId: number): void {
  const evaluated = evaluateAsset(db, assetId);
  if (!evaluated) return;
  for (const req of evaluated.requiredApprovals) {
    run(
      db,
      `INSERT INTO approvals (asset_id, round, role, reason) VALUES (:a, :r, :role, :reason)
       ON CONFLICT(asset_id, round, role) DO UPDATE SET reason = excluded.reason`,
      { a: assetId, r: evaluated.asset.approvalRound, role: req.role, reason: req.reason },
    );
  }
}

/** After governance thresholds change, open the approval requests that are now required. */
export function refreshOpenApprovalRounds(db: DB): void {
  const statuses = REVIEWED_STATUSES.map((s) => `'${s}'`).join(", ");
  for (const { id } of all<{ id: number }>(db, `SELECT id FROM assets WHERE status IN (${statuses})`)) {
    ensureApprovalRows(db, id);
  }
}

/**
 * Called after an edit. A risk-relevant change on an asset that is in review or already
 * approved starts a new approval round, so approvals always refer to what is actually running.
 */
export function handleAssetChange(db: DB, before: Asset, after: Asset, actor: CurrentUser): string[] {
  const changed = riskRelevantChanges(before, after);
  if (!changed.length || !REVIEWED_STATUSES.includes(after.status)) return changed;
  run(db, "UPDATE assets SET approval_round = approval_round + 1 WHERE id = :id", { id: after.id });
  ensureApprovalRows(db, after.id);
  audit(db, actor, {
    action: "approval.round_started",
    entityType: "asset",
    entityId: after.id,
    summary: `Neue Freigaberunde ${after.approvalRound + 1} für „${after.name}“ wegen Änderung an: ${changed.join(", ")}`,
  });
  return changed;
}

export function isAssetEditor(user: CurrentUser, asset: Asset): boolean {
  return (
    hasRole(user, "admin") ||
    asset.ownerId === user.id ||
    asset.createdBy === user.id ||
    (user.roles.includes("team_lead") && asset.teamId !== null && asset.teamId === user.teamId)
  );
}

type Transition = { from: AssetStatus[]; to: AssetStatus; label: string; adminOnly?: boolean };

export const TRANSITIONS: Transition[] = [
  { from: ["draft", "rejected"], to: "in_review", label: "Zur Freigabe einreichen" },
  { from: ["in_review", "rejected"], to: "draft", label: "Zurück in Entwurf" },
  { from: ["approved"], to: "active", label: "In Betrieb nehmen" },
  { from: ["approved", "active"], to: "deprecated", label: "Abkündigen" },
  { from: ["deprecated", "approved", "active", "draft", "rejected"], to: "retired", label: "Stilllegen" },
  { from: ["deprecated"], to: "active", label: "Abkündigung zurücknehmen" },
  { from: ["retired"], to: "draft", label: "Reaktivieren (neuer Entwurf)", adminOnly: true },
];

export function availableTransitions(status: AssetStatus) {
  return TRANSITIONS.filter((t) => t.from.includes(status)).map(({ to, label, adminOnly }) => ({
    to,
    label,
    adminOnly: !!adminOnly,
  }));
}

export function transitionAsset(db: DB, assetId: number, to: AssetStatus, actor: CurrentUser): Asset {
  return transaction(db, () => {
    const asset = loadAsset(db, assetId);
    if (!asset) throw notFound("Asset");
    if (!isAssetEditor(actor, asset))
      throw forbidden("Nur Owner, Ersteller:in, Teamleitung oder Admins können den Status ändern.");
    const transition = TRANSITIONS.find((t) => t.to === to && t.from.includes(asset.status));
    if (!transition) {
      throw conflict(`Statuswechsel von „${ASSET_STATUSES[asset.status]}“ nach „${ASSET_STATUSES[to]}“ ist nicht möglich.`);
    }
    if (transition.adminOnly && !hasRole(actor, "admin")) throw forbidden("Nur Admins können stillgelegte Assets reaktivieren.");

    if (to === "in_review") {
      // Every (re)submission after decisions were made starts a clean round – otherwise an asset could
      // be withdrawn, changed as a draft and resubmitted while keeping approvals for the old version.
      const decided = get(db, "SELECT 1 FROM approvals WHERE asset_id = :id AND round = :r AND decision <> 'pending'", {
        id: asset.id,
        r: asset.approvalRound,
      });
      if (asset.status === "rejected" || decided) {
        run(db, "UPDATE assets SET approval_round = approval_round + 1 WHERE id = :id", { id: asset.id });
      }
      setAssetStatus(db, asset.id, "in_review");
      ensureApprovalRows(db, asset.id);
    } else if (to === "active") {
      const evaluated = evaluateAsset(db, asset.id)!;
      if (evaluated.approvalState !== "complete") throw conflict("Inbetriebnahme erst nach vollständiger Freigabe möglich.");
      const blocking = evaluated.findings.filter((f) => f.severity === "critical" && !f.acceptance);
      if (blocking.length) {
        throw conflict(
          "Inbetriebnahme blockiert durch kritische Befunde.",
          blocking.map((f) => `${f.ruleId}: ${f.title}`),
        );
      }
      setAssetStatus(db, asset.id, "active");
    } else {
      setAssetStatus(db, asset.id, to);
    }

    audit(db, actor, {
      action: "asset.transition",
      entityType: "asset",
      entityId: asset.id,
      summary: `„${asset.name}“: ${ASSET_STATUSES[asset.status]} → ${ASSET_STATUSES[to]}`,
      changes: { status: { from: asset.status, to } },
    });
    return loadAsset(db, asset.id)!;
  });
}

export function decideApproval(
  db: DB,
  approvalId: number,
  decision: "approved" | "rejected",
  comment: string,
  actor: CurrentUser,
) {
  return transaction(db, () => {
    const approval = get<{ id: number; asset_id: number; round: number; role: string; decision: string }>(
      db,
      "SELECT * FROM approvals WHERE id = :id",
      { id: approvalId },
    );
    if (!approval) throw notFound("Freigabe");
    const asset = loadAsset(db, approval.asset_id);
    if (!asset) throw notFound("Asset");
    if (approval.round !== asset.approvalRound) throw conflict("Diese Freigabe gehört zu einer veralteten Freigaberunde.");
    if (approval.decision !== "pending") throw conflict("Über diese Freigabe wurde bereits entschieden.");
    if (!hasRole(actor, approval.role as keyof typeof ROLES)) {
      throw forbidden(
        `Für diese Freigabe wird die Rolle „${ROLES[approval.role as keyof typeof ROLES] ?? approval.role}“ benötigt.`,
      );
    }
    // Four-eyes principle: nobody approves their own asset, not even admins.
    if (asset.ownerId === actor.id || asset.createdBy === actor.id) {
      throw forbidden("Vier-Augen-Prinzip: Eigene Assets können nicht selbst freigegeben werden.");
    }
    if (decision === "rejected" && !comment.trim()) throw conflict("Bitte eine Begründung für die Ablehnung angeben.");

    run(db, "UPDATE approvals SET decision = :d, comment = :c, decided_by = :by, decided_at = :at WHERE id = :id", {
      d: decision,
      c: comment.trim() || null,
      by: actor.id,
      at: nowIso(),
      id: approval.id,
    });

    let newStatus: AssetStatus | null = null;
    if (decision === "rejected") {
      if (asset.status === "in_review") newStatus = "rejected";
    } else {
      const evaluated = evaluateAsset(db, asset.id)!;
      if (evaluated.approvalState === "complete" && asset.status === "in_review") newStatus = "approved";
    }
    if (newStatus) setAssetStatus(db, asset.id, newStatus);

    audit(db, actor, {
      action: `approval.${decision}`,
      entityType: "asset",
      entityId: asset.id,
      summary: `${ROLES[approval.role as keyof typeof ROLES] ?? approval.role}: „${asset.name}“ ${
        decision === "approved" ? "freigegeben" : "abgelehnt"
      }${comment.trim() ? ` – ${comment.trim()}` : ""}${newStatus ? ` (Status: ${ASSET_STATUSES[newStatus]})` : ""}`,
    });
    return { assetStatus: newStatus ?? asset.status };
  });
}

export function canAcceptRisk(user: CurrentUser, category: string): boolean {
  switch (category) {
    case "Sicherheit":
      return hasRole(user, "security");
    case "Datenschutz":
      return hasRole(user, "privacy");
    case "Kosten":
      return hasRole(user, "finance", "team_lead");
    default:
      return hasRole(user, "architecture", "team_lead", "security");
  }
}
