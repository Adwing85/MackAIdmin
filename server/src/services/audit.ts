import { all, run, type DB } from "../db/database.js";
import { actorLabel, type CurrentToken, type CurrentUser } from "../auth/auth.js";

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: number | string | null;
  summary: string;
  changes?: unknown;
}

export function audit(db: DB, actor: CurrentUser | CurrentToken | undefined, entry: AuditEntry): void {
  run(
    db,
    `INSERT INTO audit_log (actor_id, actor_label, action, entity_type, entity_id, summary, changes)
     VALUES (:actorId, :actorLabel, :action, :entityType, :entityId, :summary, :changes)`,
    {
      actorId: actor?.kind === "user" ? actor.id : null,
      actorLabel: actorLabel(actor),
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId == null ? null : String(entry.entityId),
      summary: entry.summary,
      changes: entry.changes === undefined ? null : JSON.stringify(entry.changes),
    },
  );
}

/** Field-level diff of two flat objects (arrays compared by value). */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (["updatedAt", "createdAt"].includes(key)) continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changes[key] = { from: before[key], to: after[key] };
  }
  return changes;
}

export interface AuditRow {
  id: number;
  at: string;
  actorLabel: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  changes: unknown;
}

export function listAudit(
  db: DB,
  filter: { entityType?: string; entityId?: string; q?: string; limit: number; offset: number },
): { items: AuditRow[]; total: number } {
  const where: string[] = [];
  const params: Record<string, string | number> = { limit: filter.limit, offset: filter.offset };
  if (filter.entityType) {
    where.push("entity_type = :entityType");
    params.entityType = filter.entityType;
  }
  if (filter.entityId) {
    where.push("entity_id = :entityId");
    params.entityId = filter.entityId;
  }
  if (filter.q) {
    where.push("(summary LIKE :q OR actor_label LIKE :q)");
    params.q = `%${filter.q}%`;
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = all<Record<string, unknown>>(
    db,
    `SELECT * FROM audit_log ${clause} ORDER BY id DESC LIMIT :limit OFFSET :offset`,
    params,
  );
  const { limit: _l, offset: _o, ...countParams } = params;
  const total = (all<{ n: number }>(db, `SELECT COUNT(*) AS n FROM audit_log ${clause}`, countParams)[0]?.n ?? 0) as number;
  return {
    total,
    items: rows.map((r) => ({
      id: r.id as number,
      at: r.at as string,
      actorLabel: r.actor_label as string,
      action: r.action as string,
      entityType: r.entity_type as string,
      entityId: r.entity_id as string | null,
      summary: r.summary as string,
      changes: r.changes ? JSON.parse(r.changes as string) : null,
    })),
  };
}
