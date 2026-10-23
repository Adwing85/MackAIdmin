import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useApi, useApp, useDebounced } from "../lib/app";
import { fmtUsd } from "../lib/format";
import type { AssetSummary, Team } from "../lib/types";
import { Card, ErrorBox, Icon, Loading, PageHeader, RiskBadge, SeverityBadge, StatusBadge } from "../components/ui";

export function InventoryPage() {
  const { meta } = useApp();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const debouncedQ = useDebounced(q, 250);
  const query = new URLSearchParams(params);
  query.set("q", debouncedQ);
  if (!debouncedQ) query.delete("q");
  const { data, error } = useApi<AssetSummary[]>(`/assets?${query.toString()}`);
  const teams = useApi<Team[]>("/org/teams").data ?? [];

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        title="Inventar"
        description="Zentrales Verzeichnis aller Apps, Agents, MCP-Server, Skills und Automatisierungen. Was hier nicht registriert ist, gilt als Shadow-AI."
        actions={
          <Link className="btn btn-primary" to="/inventar/neu">
            <Icon name="plus" /> Asset registrieren
          </Link>
        }
      />
      <div className="filters">
        <input
          type="search"
          placeholder="Suche nach Name, Fähigkeit, Tag …"
          value={q}
          onChange={(e) => set("q", e.target.value)}
          aria-label="Suche"
        />
        <select value={params.get("type") ?? ""} onChange={(e) => set("type", e.target.value)} aria-label="Typ">
          <option value="">Alle Typen</option>
          {Object.entries(meta.assetTypes).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select value={params.get("status") ?? ""} onChange={(e) => set("status", e.target.value)} aria-label="Status">
          <option value="">Alle Status (ohne stillgelegt)</option>
          {Object.entries(meta.assetStatuses).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select value={params.get("teamId") ?? ""} onChange={(e) => set("teamId", e.target.value)} aria-label="Team">
          <option value="">Alle Teams</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select value={params.get("risk") ?? ""} onChange={(e) => set("risk", e.target.value)} aria-label="Risiko">
          <option value="">Alle Risikostufen</option>
          {Object.entries(meta.riskLevels).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={!!params.get("mine")} onChange={(e) => set("mine", e.target.checked ? "1" : "")} />
          Nur meine
        </label>
      </div>
      <ErrorBox error={error} />
      <Card flush>
        {!data ? (
          <Loading />
        ) : data.length === 0 ? (
          <div className="empty">Keine Assets für diese Filter.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Status</th>
                  <th>Risiko</th>
                  <th>Befunde</th>
                  <th>Verantwortlich</th>
                  <th className="num">Kosten (Monat)</th>
                </tr>
              </thead>
              <tbody>
                {data.map((a) => (
                  <tr key={a.id} className="row-link" onClick={() => navigate(`/inventar/${a.id}`)}>
                    <td style={{ maxWidth: 380 }}>
                      <Link to={`/inventar/${a.id}`} className="cell-title" onClick={(e) => e.stopPropagation()}>
                        {a.name}
                      </Link>
                      <div className="cell-sub">
                        {meta.assetTypes[a.type]} · <span className="mono">{a.key}</span>
                      </div>
                      {a.capabilities.length > 0 && (
                        <div className="row" style={{ marginTop: 4, gap: 4 }}>
                          {a.capabilities.slice(0, 4).map((c) => (
                            <span className="tag" key={c}>
                              {c}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td>
                      <StatusBadge status={a.status} />
                      {a.approvalState === "pending" && ["approved", "active"].includes(a.status) && (
                        <div className="cell-sub">Neue Freigabe offen</div>
                      )}
                    </td>
                    <td>
                      <RiskBadge level={a.riskLevel} score={a.riskScore} />
                    </td>
                    <td>
                      {a.worstOpenSeverity ? (
                        <span className="row">
                          <SeverityBadge severity={a.worstOpenSeverity} />
                          {a.openFindings > 1 && <span className="muted small">+{a.openFindings - 1}</span>}
                        </span>
                      ) : (
                        <span className="muted">–</span>
                      )}
                    </td>
                    <td>
                      {a.owner ? (
                        <>
                          {a.owner.name}
                          {!a.owner.active && (
                            <span className="badge" style={{ marginLeft: 6 }}>
                              <span className="dot dot-critical" />
                              ausgeschieden
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="muted">kein Owner</span>
                      )}
                      <div className="cell-sub">{a.team?.name ?? "ohne Team"}</div>
                    </td>
                    <td className="num">
                      {fmtUsd(a.mtdCostUsd)}
                      {a.monthlyBudgetUsd ? <div className="cell-sub">von {fmtUsd(a.monthlyBudgetUsd)}</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {data && <p className="muted small">{data.length} Assets</p>}
    </>
  );
}
