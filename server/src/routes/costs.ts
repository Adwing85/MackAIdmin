import { Router } from "express";
import { z } from "zod";
import { all, get, transaction, type DB } from "../db/database.js";
import type { Config } from "../config.js";
import { hasRole, requireRole, requireUser, requireUserOrScope } from "../auth/auth.js";
import { isoDate } from "../domain/costs.js";
import { badRequest, conflict, parse } from "../lib/http.js";
import { audit } from "../services/audit.js";
import { costSummary, loadPrices, parseCsv, recordUsage, savePrices } from "../services/costs.js";
import { getIntegrations, setIntegrations } from "../services/settings.js";
import { syncClaudeCodeUsage } from "../integrations/anthropic.js";
import { isoDay, usageRecordSchema } from "./schemas.js";

type UsageRecordInput = z.infer<typeof usageRecordSchema>;

function resolveRecord(db: DB, rec: UsageRecordInput, errors: string[], index: number) {
  let assetId: number | null = rec.assetId ?? null;
  if (rec.assetKey) {
    assetId = get<{ id: number }>(db, "SELECT id FROM assets WHERE key = :k", { k: rec.assetKey })?.id ?? null;
    if (!assetId) errors.push(`Zeile ${index + 1}: Asset „${rec.assetKey}“ ist nicht registriert.`);
  }
  let personId: number | null = null;
  if (rec.personEmail) {
    personId = get<{ id: number }>(db, "SELECT id FROM people WHERE email = :e", { e: rec.personEmail })?.id ?? null;
  }
  return { assetId, personId };
}

export function costsRouter(db: DB, config: Config): Router {
  const r = Router();

  r.get("/costs/summary", (req, res) => {
    const user = requireUser(req);
    res.json(costSummary(db, new Date(), hasRole(user, "finance")));
  });

  r.get("/costs/prices", (req, res) => {
    requireUser(req);
    res.json(loadPrices(db));
  });

  r.put("/costs/prices", (req, res) => {
    const user = requireRole(req, "finance");
    const prices = parse(
      z
        .array(
          z.object({
            model: z.string().trim().min(1).max(100),
            inputPerMTok: z.number().nonnegative(),
            outputPerMTok: z.number().nonnegative(),
            cacheWritePerMTok: z.number().nonnegative(),
            cacheReadPerMTok: z.number().nonnegative(),
          }),
        )
        .max(200),
      req.body,
    );
    if (new Set(prices.map((p) => p.model)).size !== prices.length) throw badRequest("Jedes Modell darf nur einmal vorkommen.");
    savePrices(db, prices);
    audit(db, user, {
      action: "prices.updated",
      entityType: "settings",
      entityId: "model_prices",
      summary: "Modellpreise aktualisiert",
      changes: prices,
    });
    res.json(loadPrices(db));
  });

  /**
   * Usage ingest for apps/agents (API token with usage:write) or finance (manual entries).
   * Unregistered assets are rejected on purpose: spend without an inventory entry is shadow IT.
   */
  r.post("/costs/usage", (req, res) => {
    const actor = requireUserOrScope(req, "usage:write", "finance");
    const body = Array.isArray(req.body) ? req.body : [req.body];
    const records = parse(z.array(usageRecordSchema).min(1).max(5000), body);
    const prices = loadPrices(db);
    const errors: string[] = [];
    const resolved = records.map((rec, i) => ({ rec, ...resolveRecord(db, rec, errors, i) }));
    if (errors.length) throw badRequest("Verbrauch konnte nicht zugeordnet werden.", errors);
    let total = 0;
    transaction(db, () => {
      for (const { rec, assetId, personId } of resolved) {
        total += recordUsage(
          db,
          {
            date: rec.date,
            assetId,
            personId,
            source: actor.kind === "token" ? "api" : "manual",
            model: rec.model,
            inputTokens: rec.inputTokens,
            outputTokens: rec.outputTokens,
            cacheReadTokens: rec.cacheReadTokens,
            cacheWriteTokens: rec.cacheWriteTokens,
            costUsd: rec.costUsd ?? null,
            dedupeKey: rec.dedupeKey ? `ext:${rec.dedupeKey}` : null,
          },
          prices,
        ).costUsd;
      }
    });
    res.status(201).json({ accepted: records.length, costUsd: Math.round(total * 100) / 100 });
  });

  r.post("/costs/import-csv", (req, res) => {
    const user = requireRole(req, "finance");
    const { csv } = parse(z.object({ csv: z.string().min(1).max(10_000_000) }), req.body);
    const rows = parseCsv(csv);
    if (!rows.length) throw badRequest("Die CSV-Datei enthält keine Datenzeilen.");
    const num = (v: string | undefined) => (v ? Number(v.replace(/\s/g, "").replace(",", ".")) : 0);
    const errors: string[] = [];
    const records = rows.map((row, i) => {
      const result = usageRecordSchema.safeParse({
        date: row.date ?? row.datum,
        assetKey: row.asset_key || row.asset || undefined,
        personEmail: row.person_email || row.email || undefined,
        model: row.model || row.modell,
        inputTokens: num(row.input_tokens),
        outputTokens: num(row.output_tokens),
        cacheReadTokens: num(row.cache_read_tokens),
        cacheWriteTokens: num(row.cache_write_tokens),
        costUsd: row.cost_usd ? num(row.cost_usd) : undefined,
      });
      if (!result.success)
        errors.push(`Zeile ${i + 2}: ${result.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ")}`);
      return result.success ? result.data : null;
    });
    const resolved = records.map((rec, i) => (rec ? { rec, ...resolveRecord(db, rec, errors, i + 1) } : null));
    if (errors.length) throw badRequest("CSV-Import abgebrochen – bitte Fehler korrigieren.", errors.slice(0, 50));
    const prices = loadPrices(db);
    let total = 0;
    transaction(db, () => {
      for (const item of resolved) {
        const { rec, assetId, personId } = item!;
        total += recordUsage(
          db,
          {
            date: rec.date,
            assetId,
            personId,
            source: "csv",
            model: rec.model,
            inputTokens: rec.inputTokens,
            outputTokens: rec.outputTokens,
            cacheReadTokens: rec.cacheReadTokens,
            cacheWriteTokens: rec.cacheWriteTokens,
            costUsd: rec.costUsd ?? null,
          },
          prices,
        ).costUsd;
      }
    });
    audit(db, user, {
      action: "usage.imported",
      entityType: "usage",
      summary: `CSV-Import: ${records.length} Verbrauchsdatensätze, ${Math.round(total * 100) / 100} USD`,
    });
    res.status(201).json({ imported: records.length, costUsd: Math.round(total * 100) / 100 });
  });

  r.get("/costs/usage", (req, res) => {
    const user = requireUser(req);
    const q = parse(
      z.object({
        from: isoDay.optional(),
        to: isoDay.optional(),
        assetId: z.coerce.number().optional(),
        limit: z.coerce.number().max(1000).default(200),
      }),
      req.query,
    );
    const where = ["date >= :from", "date <= :to"];
    const params: Record<string, string | number> = {
      from: q.from ?? isoDate(new Date(Date.now() - 30 * 86_400_000)),
      to: q.to ?? isoDate(new Date()),
      limit: q.limit,
    };
    if (q.assetId) {
      where.push("u.asset_id = :assetId");
      params.assetId = q.assetId;
    }
    const showPerson = hasRole(user, "finance");
    res.json(
      all(
        db,
        `SELECT u.id, u.date, u.source, u.model, u.input_tokens AS inputTokens, u.output_tokens AS outputTokens,
           u.cache_read_tokens AS cacheReadTokens, u.cache_write_tokens AS cacheWriteTokens, u.cost_usd AS costUsd,
           a.name AS assetName, a.id AS assetId, ${showPerson ? "p.name" : "NULL"} AS personName
         FROM usage_records u LEFT JOIN assets a ON a.id = u.asset_id LEFT JOIN people p ON p.id = u.person_id
         WHERE ${where.join(" AND ")} ORDER BY u.date DESC, u.id DESC LIMIT :limit`,
        params,
      ),
    );
  });

  // --- Anthropic Admin API ------------------------------------------------------------

  r.get("/integrations", (req, res) => {
    requireUser(req);
    res.json({ ...getIntegrations(db), anthropicAdminKeyConfigured: !!config.anthropicAdminKey });
  });

  r.put("/integrations", (req, res) => {
    const user = requireRole(req, "finance");
    const body = parse(z.object({ claudeCodeAssetKey: z.string().trim().max(60).nullable() }), req.body);
    setIntegrations(db, { ...getIntegrations(db), claudeCodeAssetKey: body.claudeCodeAssetKey || null });
    audit(db, user, {
      action: "integrations.updated",
      entityType: "settings",
      entityId: "integrations",
      summary: "Integrations-Einstellungen geändert",
      changes: body,
    });
    res.json(getIntegrations(db));
  });

  r.post("/integrations/anthropic/sync", async (req, res) => {
    const user = requireRole(req, "finance");
    if (!config.anthropicAdminKey) {
      throw conflict("Kein Admin-API-Key konfiguriert (Umgebungsvariable ANTHROPIC_ADMIN_KEY).");
    }
    const today = isoDate(new Date());
    const body = parse(
      z.object({ from: isoDay.default(isoDate(new Date(Date.now() - 7 * 86_400_000))), to: isoDay.default(today) }),
      req.body ?? {},
    );
    const span = (Date.parse(body.to) - Date.parse(body.from)) / 86_400_000;
    if (span < 0 || span > 92) throw badRequest("Zeitraum muss zwischen 1 und 93 Tagen liegen.");
    const result = await syncClaudeCodeUsage(db, {
      adminKey: config.anthropicAdminKey,
      apiBase: config.anthropicApiBase,
      from: body.from,
      to: body.to > today ? today : body.to,
    });
    audit(db, user, {
      action: "usage.synced",
      entityType: "usage",
      summary: `Claude-Code-Nutzung synchronisiert (${body.from} – ${body.to}): ${result.records} Datensätze, ${result.costUsd} USD`,
      changes: { unknownActors: result.unknownActors },
    });
    res.json(result);
  });

  return r;
}
