import { useState } from "react";
import { api } from "../lib/api";
import { useAction, useApi, useApp } from "../lib/app";
import { fmtCompact, fmtDateTime, fmtInt, fmtPct, fmtUsd } from "../lib/format";
import { BarList, DailyColumnChart } from "../components/charts";
import { Card, ErrorBox, Field, Icon, Loading, Modal, PageHeader, Stat } from "../components/ui";

interface Summary {
  month: { start: string; end: string; daysElapsed: number; daysInMonth: number };
  mtdUsd: number;
  forecastUsd: number;
  previousMonthUsd: number;
  budgetUsd: number;
  budgetAlertPercent: number;
  daily: { date: string; costUsd: number }[];
  byTeam: { id: number | null; name: string; costUsd: number; budgetUsd: number | null }[];
  byAsset: { id: number | null; name: string; key: string | null; costUsd: number; budgetUsd: number | null }[];
  byModel: { model: string; costUsd: number; inputTokens: number; outputTokens: number; cacheReadTokens: number }[];
  bySource: { source: string; costUsd: number }[];
  byPerson: { id: number | null; name: string; costUsd: number; sessions: number }[] | null;
  cacheHitRate: number | null;
  unpricedModels: string[];
}

interface Price {
  model: string;
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWritePerMTok: number;
  cacheReadPerMTok: number;
}

interface Integrations {
  claudeCodeAssetKey: string | null;
  lastClaudeCodeSyncAt: string | null;
  lastClaudeCodeSyncResult: string | null;
  anthropicAdminKeyConfigured: boolean;
}

const SOURCES: Record<string, string> = {
  anthropic_claude_code: "Claude Code (Admin API)",
  api: "API-Meldungen (Apps/Agents)",
  csv: "CSV-Import",
  manual: "Manuell",
};

export function CostsPage() {
  const { hasRole } = useApp();
  const summary = useApi<Summary>("/costs/summary");
  const [modal, setModal] = useState<"csv" | "sync" | "prices" | null>(null);
  const finance = hasRole("finance");

  if (summary.error) return <ErrorBox error={summary.error} />;
  if (!summary.data) return <Loading />;
  const s = summary.data;
  const delta = s.previousMonthUsd ? ((s.forecastUsd - s.previousMonthUsd) / s.previousMonthUsd) * 100 : null;

  return (
    <>
      <PageHeader
        title="Kosten & Budgets"
        description="Token-Kosten aller registrierten Assets und der Claude-Code-Nutzung, mit Budgets pro Asset, Team und Unternehmen."
        actions={
          finance && (
            <>
              <button className="btn" onClick={() => setModal("prices")}>
                Modellpreise
              </button>
              <button className="btn" onClick={() => setModal("csv")}>
                CSV importieren
              </button>
              <button className="btn btn-primary" onClick={() => setModal("sync")}>
                <Icon name="refresh" /> Claude Code synchronisieren
              </button>
            </>
          )
        }
      />
      {s.unpricedModels.length > 0 && (
        <div className="callout warn" style={{ marginBottom: 16 }}>
          <Icon name="alert" />
          <span>
            Für folgende Modelle ist kein Preis hinterlegt, ihre Kosten werden ohne explizite Kostenangabe mit 0 bewertet:{" "}
            <strong>{s.unpricedModels.join(", ")}</strong>.
          </span>
        </div>
      )}
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat label="Laufender Monat" value={fmtUsd(s.mtdUsd)} sub={`Tag ${s.month.daysElapsed} von ${s.month.daysInMonth}`} />
        <Stat
          label="Hochrechnung Monatsende"
          value={fmtUsd(s.forecastUsd)}
          sub={
            delta == null ? (
              `Budget ${fmtUsd(s.budgetUsd)}`
            ) : (
              <span>
                <span className={delta > 0 ? "delta-up-bad" : "delta-down-good"}>
                  {delta > 0 ? "+" : ""}
                  {fmtPct(delta)}
                </span>{" "}
                ggü. Vormonat · Budget {fmtUsd(s.budgetUsd)}
              </span>
            )
          }
        />
        <Stat label="Vormonat" value={fmtUsd(s.previousMonthUsd)} />
        <Stat
          label="Cache-Trefferquote"
          value={fmtPct(s.cacheHitRate, 1)}
          sub="Anteil gecachter Input-Tokens – höher ist günstiger"
        />
      </div>

      <Card title="Tägliche Kosten" subtitle="Letzte 60 Tage, alle Quellen">
        <DailyColumnChart
          data={s.daily.map((d) => ({ date: d.date, value: d.costUsd }))}
          reference={s.budgetUsd / s.month.daysInMonth}
          referenceLabel="Tagesbudget"
          height={220}
          ariaLabel="Tägliche Kosten der letzten 60 Tage"
        />
      </Card>

      <div className="grid grid-3" style={{ margin: "16px 0" }}>
        <Card title="Nach Team" subtitle="Strich = Teambudget">
          <BarList items={s.byTeam.map((t) => ({ key: t.id ?? "none", label: t.name, value: t.costUsd, budget: t.budgetUsd }))} />
        </Card>
        <Card title="Nach Asset" subtitle="Strich = Asset-Budget">
          <BarList
            items={s.byAsset.map((a) => ({
              key: a.id ?? "none",
              label: a.name,
              value: a.costUsd,
              budget: a.budgetUsd,
              to: a.id ? `/inventar/${a.id}` : undefined,
            }))}
          />
        </Card>
        <Card title="Nach Quelle">
          <BarList items={s.bySource.map((x) => ({ key: x.source, label: SOURCES[x.source] ?? x.source, value: x.costUsd }))} />
        </Card>
      </div>

      <div className="grid grid-2">
        <Card title="Nach Modell" flush>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Modell</th>
                  <th className="num">Input</th>
                  <th className="num">Cache-Read</th>
                  <th className="num">Output</th>
                  <th className="num">Kosten</th>
                </tr>
              </thead>
              <tbody>
                {s.byModel.map((m) => (
                  <tr key={m.model}>
                    <td className="mono">{m.model}</td>
                    <td className="num">{fmtCompact(m.inputTokens)}</td>
                    <td className="num">{fmtCompact(m.cacheReadTokens)}</td>
                    <td className="num">{fmtCompact(m.outputTokens)}</td>
                    <td className="num">{fmtUsd(m.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Nach Person (Claude Code)" flush>
          {s.byPerson ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Person</th>
                    <th className="num">Sessions</th>
                    <th className="num">Kosten</th>
                  </tr>
                </thead>
                <tbody>
                  {s.byPerson.map((p) => (
                    <tr key={p.id ?? "none"}>
                      <td>{p.name}</td>
                      <td className="num">{fmtInt(p.sessions)}</td>
                      <td className="num">{fmtUsd(p.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">
              Personenbezogene Auswertungen sind nur für die Rollen Finanzen und Admin sichtbar.
              <br />
              Nutzungsdaten einzelner Beschäftigter unterliegen dem Datenschutz und in der Regel der Mitbestimmung (§ 87 Abs. 1
              Nr. 6 BetrVG).
            </div>
          )}
        </Card>
      </div>

      {modal === "csv" && <CsvModal onClose={() => setModal(null)} onDone={summary.reload} />}
      {modal === "sync" && <SyncModal onClose={() => setModal(null)} onDone={summary.reload} />}
      {modal === "prices" && <PricesModal onClose={() => setModal(null)} onDone={summary.reload} />}
    </>
  );
}

function CsvModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const [csv, setCsv] = useState("");
  const action = useAction();
  const submit = async () => {
    const res = await action.run(() => api.post<{ imported: number; costUsd: number }>("/costs/import-csv", { csv }));
    if (res) {
      toast(`${res.imported} Datensätze importiert (${fmtUsd(res.costUsd)})`);
      onDone();
      onClose();
    }
  };
  return (
    <Modal
      title="Verbrauch per CSV importieren"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={action.busy || !csv.trim()}>
            Importieren
          </button>
        </>
      }
    >
      <div className="stack">
        <p className="mt-0 secondary">
          Für Quellen ohne API-Anbindung (z. B. Claude-Team/Enterprise-Exporte, Cloud-Rechnungen). Trennzeichen Komma oder
          Semikolon. Spalten:{" "}
          <code>
            date, asset_key, person_email, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd
          </code>
          . Fehlt <code>cost_usd</code>, wird mit den hinterlegten Modellpreisen gerechnet. Der Import ist atomar: bei einem
          Fehler wird nichts übernommen.
        </p>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) setCsv(await file.text());
          }}
        />
        <textarea
          className="mono"
          rows={8}
          placeholder={
            "date,asset_key,model,input_tokens,output_tokens\n2026-10-01,pr-review-agent,claude-sonnet-5-5,1200000,90000"
          }
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
        />
        <ErrorBox error={action.error} />
      </div>
    </Modal>
  );
}

function SyncModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const integrations = useApi<Integrations>("/integrations");
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(today);
  const [assetKey, setAssetKey] = useState<string | null>(null);
  const action = useAction();
  const [result, setResult] = useState<{ records: number; costUsd: number; unknownActors: string[] } | null>(null);

  const saveKey = async () => {
    if (assetKey === null) return;
    const ok = await action.run(() => api.put("/integrations", { claudeCodeAssetKey: assetKey || null }));
    if (ok) {
      toast("Zuordnung gespeichert");
      integrations.reload();
      setAssetKey(null);
    }
  };
  const sync = async () => {
    const res = await action.run(() =>
      api.post<{ records: number; costUsd: number; unknownActors: string[] }>("/integrations/anthropic/sync", { from, to }),
    );
    if (res) {
      setResult(res);
      onDone();
      integrations.reload();
    }
  };
  const i = integrations.data;
  return (
    <Modal
      title="Claude-Code-Nutzung synchronisieren"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Schließen
          </button>
          <button className="btn btn-primary" onClick={sync} disabled={action.busy || !i?.anthropicAdminKeyConfigured}>
            {action.busy ? "Synchronisiere …" : "Jetzt synchronisieren"}
          </button>
        </>
      }
    >
      {!i ? (
        <Loading />
      ) : (
        <div className="stack">
          <p className="mt-0 secondary">
            Lädt Tageswerte pro Person und Modell aus der <strong>Claude Code Analytics API</strong> der Anthropic Admin API (
            <code>/v1/organizations/usage_report/claude_code</code>): Tokens, geschätzte Kosten, Sessions und Codezeilen. Die
            Synchronisation ist idempotent und aktualisiert auch die Lizenz-Aktivität. Gilt für Claude-Console-Organisationen;
            Claude Team/Enterprise (claude.ai) bitte per CSV-Export oder OpenTelemetry anbinden.
          </p>
          {!i.anthropicAdminKeyConfigured && (
            <div className="callout warn">
              <Icon name="key" />
              <span>
                Kein Admin-API-Key konfiguriert. Setzen Sie die Umgebungsvariable <code>ANTHROPIC_ADMIN_KEY</code> (sk-ant-admin…)
                auf dem Server.
              </span>
            </div>
          )}
          <div className="form-grid">
            <Field label="Von">
              <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="Bis">
              <input type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} />
            </Field>
            <Field
              label="Kosten zuordnen zu Asset (Schlüssel)"
              className="span-2"
              hint="Die synchronisierte Nutzung wird diesem Inventar-Eintrag zugerechnet (z. B. „claude-code“)."
            >
              <div className="row" style={{ flexWrap: "nowrap" }}>
                <input
                  type="text"
                  className="mono"
                  value={assetKey ?? i.claudeCodeAssetKey ?? ""}
                  onChange={(e) => setAssetKey(e.target.value)}
                />
                <button className="btn" onClick={saveKey} disabled={assetKey === null || action.busy}>
                  Speichern
                </button>
              </div>
            </Field>
          </div>
          {i.lastClaudeCodeSyncAt && (
            <p className="muted small mt-0">
              Letzte Synchronisation: {fmtDateTime(i.lastClaudeCodeSyncAt)} – {i.lastClaudeCodeSyncResult}
            </p>
          )}
          <ErrorBox error={action.error} />
          {result && (
            <div className="callout ok">
              <Icon name="check" />
              <div>
                {result.records} Datensätze, {fmtUsd(result.costUsd)} übernommen.
                {result.unknownActors.length > 0 && (
                  <div className="small">
                    Nicht zugeordnete Nutzer (bitte unter Organisation anlegen): {result.unknownActors.join(", ")}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function PricesModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const prices = useApi<Price[]>("/costs/prices");
  const [rows, setRows] = useState<Price[] | null>(null);
  const action = useAction();
  const data = rows ?? prices.data;
  const update = (i: number, key: keyof Price, value: string) => {
    const next = [...(data ?? [])];
    next[i] = { ...next[i], [key]: key === "model" ? value : Number(value) };
    setRows(next);
  };
  const save = async () => {
    const ok = await action.run(() => api.put("/costs/prices", data));
    if (ok) {
      toast("Modellpreise gespeichert");
      onDone();
      onClose();
    }
  };
  return (
    <Modal
      title="Modellpreise (USD pro 1 Mio. Tokens)"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn btn-primary" onClick={save} disabled={action.busy || !data}>
            Speichern
          </button>
        </>
      }
    >
      {!data ? (
        <Loading />
      ) : (
        <div className="stack">
          <p className="mt-0 secondary small">
            Listenpreise der Anthropic API (Stand Oktober 2026). Bitte regelmäßig mit der offiziellen Preisliste und dem eigenen
            Vertrag abgleichen. Neue Preise gelten für künftig erfasste Verbräuche.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Modell</th>
                  <th>Input</th>
                  <th>Output</th>
                  <th>Cache-Write</th>
                  <th>Cache-Read</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.map((p, i) => (
                  <tr key={i}>
                    <td>
                      <input
                        type="text"
                        className="mono"
                        value={p.model}
                        onChange={(e) => update(i, "model", e.target.value)}
                        aria-label="Modell"
                      />
                    </td>
                    {(["inputPerMTok", "outputPerMTok", "cacheWritePerMTok", "cacheReadPerMTok"] as const).map((k) => (
                      <td key={k}>
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          value={p[k]}
                          onChange={(e) => update(i, k, e.target.value)}
                          aria-label={k}
                          style={{ width: 90 }}
                        />
                      </td>
                    ))}
                    <td>
                      <button
                        className="btn btn-ghost icon-btn"
                        aria-label="Entfernen"
                        onClick={() => setRows(data.filter((_, j) => j !== i))}
                      >
                        <Icon name="x" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <button
              className="btn btn-sm"
              onClick={() =>
                setRows([...data, { model: "", inputPerMTok: 0, outputPerMTok: 0, cacheWritePerMTok: 0, cacheReadPerMTok: 0 }])
              }
            >
              <Icon name="plus" /> Modell hinzufügen
            </button>
          </div>
          <ErrorBox error={action.error} />
        </div>
      )}
    </Modal>
  );
}
