import { Link } from "react-router-dom";
import { useApi, useApp } from "../lib/app";
import { fmtDateTime, fmtInt, fmtUsd } from "../lib/format";
import type { AuditEntry, RiskLevel, Severity } from "../lib/types";
import { BarList, DailyColumnChart, Meter, StackedBar } from "../components/charts";
import { Card, ErrorBox, Loading, PageHeader, RiskBadge, SeverityBadge, Stat, StatusBadge } from "../components/ui";

interface Dashboard {
  assets: {
    total: number;
    live: number;
    byStatus: Record<string, number>;
    byType: Record<string, number>;
    byRisk: Record<RiskLevel, number>;
  };
  findings: { openBySeverity: Record<Severity, number>; accepted: number };
  approvals: { pending: number; pendingForMe: number };
  costs: {
    mtdUsd: number;
    forecastUsd: number;
    budgetUsd: number;
    previousMonthUsd: number;
    budgetAlertPercent: number;
    daily: { date: string; costUsd: number }[];
    byTeam: { id: number | null; name: string; costUsd: number; budgetUsd: number | null }[];
    byAsset: { id: number | null; name: string; costUsd: number; budgetUsd: number | null }[];
  };
  licenses: {
    seatsPurchased: number;
    seatsAssigned: number;
    inactiveSeats: number;
    unassignedSeats: number;
    monthlyCostUsd: number;
    potentialSavingsUsd: number;
  };
  discovery: { new: number };
  redundancy: { open: number; consolidate: number };
  attention: {
    id: number;
    name: string;
    type: string;
    status: string;
    riskLevel: RiskLevel;
    riskScore: number;
    worst: Severity;
    openFindings: number;
    topFinding: string | null;
  }[];
  recent: AuditEntry[];
}

export function DashboardPage() {
  const { meta } = useApp();
  const { data, error } = useApi<Dashboard>("/dashboard");
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;

  const c = data.costs;
  const now = new Date();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const forecastRatio = c.budgetUsd ? c.forecastUsd / c.budgetUsd : 0;
  const crit = data.findings.openBySeverity.critical;
  const high = data.findings.openBySeverity.high;

  return (
    <>
      <PageHeader
        title="Übersicht"
        description="Alle KI-Assets, Risiken, Kosten und Lizenzen auf einen Blick – was braucht jetzt Aufmerksamkeit?"
        actions={
          <Link className="btn btn-primary" to="/inventar/neu">
            Asset registrieren
          </Link>
        }
      />

      <div className="grid grid-main-side" style={{ marginBottom: 16 }}>
        <Card
          title="Token-Kosten im laufenden Monat"
          subtitle={`Budget ${fmtUsd(c.budgetUsd)} · Vormonat ${fmtUsd(c.previousMonthUsd)}`}
        >
          <div className="spread" style={{ alignItems: "flex-end" }}>
            <div>
              <div className="hero-value num">{fmtUsd(c.mtdUsd)}</div>
              <div className="secondary" style={{ marginTop: 6 }}>
                Hochrechnung Monatsende: <strong>{fmtUsd(c.forecastUsd)}</strong> ({Math.round(forecastRatio * 100)} % des
                Budgets)
                {forecastRatio * 100 >= c.budgetAlertPercent && (
                  <span className="badge" style={{ marginLeft: 8 }}>
                    <span className={`dot ${forecastRatio >= 1 ? "dot-critical" : "dot-warning"}`} />
                    {forecastRatio >= 1 ? "Budget wird überschritten" : "Budgetwarnung"}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div style={{ margin: "14px 0 18px" }}>
            <Meter value={c.mtdUsd} max={c.budgetUsd} warnAt={c.budgetAlertPercent / 100} />
          </div>
          <DailyColumnChart
            data={c.daily.map((d) => ({ date: d.date, value: d.costUsd }))}
            reference={c.budgetUsd / daysInMonth}
            referenceLabel="Tagesbudget"
            height={270}
            ariaLabel="Tägliche Token-Kosten der letzten 30 Tage"
          />
        </Card>

        <div className="stack">
          <Stat
            label="Offene Befunde"
            to="/sicherheit"
            value={
              <span className="row" style={{ gap: 14 }}>
                <span>{crit + high}</span>
                <span className="row small" style={{ fontWeight: 400 }}>
                  <SeverityBadge severity="critical" /> {crit}
                  <SeverityBadge severity="high" /> {high}
                </span>
              </span>
            }
            sub={`kritisch + hoch · ${data.findings.openBySeverity.medium} mittel · ${data.findings.accepted} akzeptiert`}
          />
          <Stat
            label="Freigaben für mich"
            to="/freigaben"
            value={data.approvals.pendingForMe}
            sub={`${data.approvals.pending} offen insgesamt`}
          />
          <Stat
            label="Lizenzen"
            to="/lizenzen"
            value={`${data.licenses.seatsAssigned} / ${data.licenses.seatsPurchased}`}
            sub={`${data.licenses.inactiveSeats} inaktiv · Einsparpotenzial ${fmtUsd(data.licenses.potentialSavingsUsd)}/Monat`}
          />
          <div className="grid grid-2">
            <Stat label="Shadow-AI-Funde" to="/discovery" value={data.discovery.new} sub="nicht registriert" />
            <Stat label="Redundanzen" to="/redundanzen" value={data.redundancy.open} sub="ungeprüfte Kandidaten" />
          </div>
        </div>
      </div>

      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <Card
          title="Risikoverteilung"
          subtitle={`${data.assets.total} aktive Assets, davon ${data.assets.live} freigegeben/im Betrieb`}
        >
          <StackedBar
            segments={(["low", "medium", "high", "critical"] as RiskLevel[]).map((l) => ({
              key: l,
              label: meta.riskLevels[l],
              value: data.assets.byRisk[l],
              color: { low: "var(--good)", medium: "var(--warning)", high: "var(--serious)", critical: "var(--critical)" }[l],
            }))}
          />
          <h3 style={{ margin: "18px 0 8px" }}>Nach Typ</h3>
          <BarList
            format={fmtInt}
            items={Object.entries(data.assets.byType)
              .sort((a, b) => b[1] - a[1])
              .map(([type, n]) => ({ key: type, label: meta.assetTypes[type] ?? type, value: n, to: `/inventar?type=${type}` }))}
          />
        </Card>
        <Card title="Kosten nach Team" subtitle="Laufender Monat, Strich = Teambudget">
          <BarList items={c.byTeam.map((t) => ({ key: t.id ?? "none", label: t.name, value: t.costUsd, budget: t.budgetUsd }))} />
        </Card>
        <Card title="Teuerste Assets" subtitle="Laufender Monat, Strich = Asset-Budget">
          <BarList
            items={c.byAsset.map((a) => ({
              key: a.id ?? "none",
              label: a.name,
              value: a.costUsd,
              budget: a.budgetUsd,
              to: a.id ? `/inventar/${a.id}` : undefined,
            }))}
          />
        </Card>
      </div>

      <div className="grid grid-main-side">
        <Card title="Braucht Aufmerksamkeit" subtitle="Assets mit offenen kritischen oder hohen Befunden" flush>
          {data.attention.length === 0 ? (
            <div className="empty">Keine kritischen oder hohen Befunde – sehr gut.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Schwerster Befund</th>
                    <th>Risiko</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.attention.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <Link to={`/inventar/${a.id}`} className="cell-title">
                          {a.name}
                        </Link>
                        <div className="cell-sub">{meta.assetTypes[a.type]}</div>
                      </td>
                      <td>
                        <div className="row">
                          <SeverityBadge severity={a.worst} />
                          <span className="small">{a.topFinding}</span>
                        </div>
                        {a.openFindings > 1 && <div className="cell-sub">+{a.openFindings - 1} weitere</div>}
                      </td>
                      <td>
                        <RiskBadge level={a.riskLevel} score={a.riskScore} />
                      </td>
                      <td>
                        <StatusBadge status={a.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="Letzte Aktivitäten">
          <ul className="list">
            {data.recent.map((e) => (
              <li key={e.id}>
                <div className="small">{e.summary}</div>
                <div className="cell-sub">
                  {fmtDateTime(e.at)} · {e.actorLabel.replace(/ <.*>$/, "")}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
