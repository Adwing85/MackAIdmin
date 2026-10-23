import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useApi, useApp } from "../lib/app";
import { fmtDate } from "../lib/format";
import type { Finding, Severity } from "../lib/types";
import { Badge, Card, ErrorBox, Loading, PageHeader, SeverityBadge, Stat, StatusBadge } from "../components/ui";

interface FindingRow extends Finding {
  asset: { id: number; key: string; name: string; type: string; status: string };
  team: string | null;
  owner: string | null;
}

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];

export function SecurityPage() {
  const { meta } = useApp();
  const { data, error } = useApi<FindingRow[]>("/findings");
  const [severity, setSeverity] = useState("");
  const [category, setCategory] = useState("");
  const [showAccepted, setShowAccepted] = useState(false);

  const rows = useMemo(
    () =>
      (data ?? []).filter(
        (f) =>
          (!severity || f.severity === severity) && (!category || f.category === category) && (showAccepted || !f.acceptance),
      ),
    [data, severity, category, showAccepted],
  );

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const open = data.filter((f) => !f.acceptance);
  const count = (s: Severity) => open.filter((f) => f.severity === s).length;
  const categories = [...new Set(meta.rules.map((r) => r.category))];

  return (
    <>
      <PageHeader
        title="Sicherheit & Risiken"
        description="Automatisch berechnete Befunde aus dem Regelwerk – sie aktualisieren sich bei jeder Änderung. Bewusst eingegangene Risiken werden befristet akzeptiert und dokumentiert."
      />
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        {SEVERITIES.map((s) => (
          <Stat
            key={s}
            label={meta.severities[s]}
            value={count(s)}
            sub={s === "critical" ? "blockieren die Inbetriebnahme" : "offene Befunde"}
          />
        ))}
      </div>
      <div className="filters">
        <select value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Schweregrad">
          <option value="">Alle Schweregrade</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {meta.severities[s]}
            </option>
          ))}
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Kategorie">
          <option value="">Alle Kategorien</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={showAccepted} onChange={(e) => setShowAccepted(e.target.checked)} />
          Akzeptierte Risiken anzeigen
        </label>
      </div>
      <Card flush>
        {rows.length === 0 ? (
          <div className="empty">Keine Befunde für diese Filter.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Schwere</th>
                  <th>Befund</th>
                  <th>Asset</th>
                  <th>Empfehlung</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => (
                  <tr key={`${f.asset.id}-${f.ruleId}`}>
                    <td className="nowrap">
                      <SeverityBadge severity={f.severity} />
                      <div className="cell-sub">
                        {f.category} · <span className="mono">{f.ruleId}</span>
                      </div>
                    </td>
                    <td style={{ maxWidth: 420 }}>
                      <div className="cell-title">{f.title}</div>
                      <div className="small secondary">{f.detail}</div>
                      {f.acceptance && (
                        <div style={{ marginTop: 4 }}>
                          <Badge dot="muted">
                            akzeptiert von {f.acceptance.acceptedByName} bis {fmtDate(f.acceptance.expiresAt)}
                          </Badge>
                        </div>
                      )}
                    </td>
                    <td>
                      <Link to={`/inventar/${f.asset.id}`}>{f.asset.name}</Link>
                      <div className="cell-sub">
                        {f.owner ?? "kein Owner"} · {f.team ?? "ohne Team"}
                      </div>
                      <div style={{ marginTop: 4 }}>
                        <StatusBadge status={f.asset.status} />
                      </div>
                    </td>
                    <td className="small" style={{ maxWidth: 340 }}>
                      {f.recommendation}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div style={{ height: 16 }} />
      <Card title="Regelwerk" subtitle="Diese Regeln werden für jedes Asset geprüft.">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Regel</th>
                <th>Schwere</th>
                <th>Kategorie</th>
                <th>Titel</th>
              </tr>
            </thead>
            <tbody>
              {meta.rules.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.id}</td>
                  <td>
                    <SeverityBadge severity={r.severity} />
                  </td>
                  <td>{r.category}</td>
                  <td>{r.title}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
