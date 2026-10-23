import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAction, useApi, useApp } from "../lib/app";
import { fmtDate, fmtDateTime, fmtRelative, fmtUsd } from "../lib/format";
import type { AssetDetail, Finding } from "../lib/types";
import { DailyColumnChart, Meter } from "../components/charts";
import {
  ApprovalBadge,
  Badge,
  Card,
  Empty,
  ErrorBox,
  Field,
  Icon,
  Loading,
  Modal,
  PageHeader,
  RiskBadge,
  SeverityBadge,
  StatusBadge,
  Tabs,
} from "../components/ui";

type Tab = "overview" | "risk" | "approvals" | "costs" | "relations" | "history";

export function AssetDetailPage() {
  const { id } = useParams();
  const { meta, me, hasRole, toast, refreshCounts } = useApp();
  const navigate = useNavigate();
  const { data, error, reload } = useApi<AssetDetail>(`/assets/${id}`);
  const [tab, setTab] = useState<Tab>("overview");
  const action = useAction();
  const [accepting, setAccepting] = useState<Finding | null>(null);

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const a = data.asset;
  const open = data.findings.filter((f) => !f.acceptance);

  const transition = async (to: string, label: string) => {
    if (to === "retired" && !window.confirm(`„${a.name}“ wirklich stilllegen?`)) return;
    const ok = await action.run(() => api.post(`/assets/${a.id}/transition`, { to }));
    if (ok) {
      toast(`${label}: erledigt`);
      reload();
      refreshCounts();
    }
  };
  const markReviewed = async () => {
    const ok = await action.run(() => api.post(`/assets/${a.id}/review`, {}));
    if (ok) {
      toast("Review dokumentiert");
      reload();
    }
  };
  const remove = async () => {
    if (!window.confirm(`„${a.name}“ endgültig löschen? Empfohlen ist stattdessen „Stilllegen“.`)) return;
    const ok = await action.run(async () => {
      await api.del(`/assets/${a.id}`);
      return true;
    });
    if (ok) navigate("/inventar");
  };

  const currentRound = data.approvals.filter((x) => x.round === a.approvalRound);
  const olderRounds = data.approvals.filter((x) => x.round !== a.approvalRound);

  return (
    <>
      <PageHeader
        title={a.name}
        description={
          <span className="row">
            <span>{meta.assetTypes[a.type]}</span>
            <span className="mono muted">{a.key}</span>
            <StatusBadge status={a.status} />
            <RiskBadge level={data.risk.level} score={data.risk.score} />
          </span>
        }
        actions={
          <>
            {data.canEdit && a.status !== "retired" && (
              <Link className="btn" to={`/inventar/${a.id}/bearbeiten`}>
                <Icon name="edit" /> Bearbeiten
              </Link>
            )}
            {data.canReview && ["approved", "active", "deprecated"].includes(a.status) && (
              <button className="btn" onClick={markReviewed} disabled={action.busy}>
                <Icon name="check" /> Review dokumentieren
              </button>
            )}
            {data.transitions.map((t) => (
              <button
                key={t.to}
                className={`btn ${t.to === "in_review" || t.to === "active" ? "btn-primary" : t.to === "retired" ? "btn-danger" : ""}`}
                onClick={() => transition(t.to, t.label)}
                disabled={action.busy}
              >
                {t.label}
              </button>
            ))}
            {hasRole("admin") && (
              <button className="btn btn-ghost btn-danger" onClick={remove} disabled={action.busy}>
                Löschen
              </button>
            )}
          </>
        }
      />
      <div className="stack" style={{ marginBottom: 12 }}>
        <ErrorBox error={action.error} />
        {a.status === "draft" && data.canEdit && (
          <div className="callout info">
            <Icon name="approvals" />
            <div>
              Entwurf – noch nicht freigegeben. Mit „Zur Freigabe einreichen“ werden automatisch die zuständigen Rollen beteiligt:{" "}
              <strong>{data.requiredApprovals.map((r) => meta.roles[r.role]).join(", ")}</strong>.
            </div>
          </div>
        )}
        {data.similar.length > 0 && data.similar[0].score >= 0.4 && (
          <div className="callout warn">
            <Icon name="redundancy" />
            <div>
              Mögliche Redundanz: <Link to={`/inventar/${data.similar[0].id}`}>{data.similar[0].name}</Link> ist zu{" "}
              {Math.round(data.similar[0].score * 100)} % ähnlich
              {data.similar[0].sharedCapabilities.length > 0 && (
                <> (gemeinsame Fähigkeiten: {data.similar[0].sharedCapabilities.join(", ")})</>
              )}
              .
            </div>
          </div>
        )}
      </div>

      <Tabs<Tab>
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "overview", label: "Überblick" },
          { id: "risk", label: `Risiko & Befunde (${open.length})` },
          { id: "approvals", label: `Freigaben${data.approvalState === "pending" && currentRound.length ? " •" : ""}` },
          { id: "costs", label: "Kosten" },
          { id: "relations", label: "Abhängigkeiten" },
          { id: "history", label: "Verlauf" },
        ]}
      />

      {tab === "overview" && (
        <div className="grid grid-main-side">
          <div className="stack">
            <Card title="Beschreibung">
              <p className="mt-0" style={{ whiteSpace: "pre-wrap" }}>
                {a.description || <span className="muted">Keine Beschreibung.</span>}
              </p>
              {a.purpose && (
                <p className="secondary">
                  <strong>Zweck / Nutzen:</strong> {a.purpose}
                </p>
              )}
            </Card>
            <Card
              title="Berechtigungen"
              subtitle="Was darf dieses Asset? Jede Berechtigung sollte begründet sein (Least Privilege)."
            >
              {a.permissions.length === 0 ? (
                <Empty>Keine Berechtigungen erfasst.</Empty>
              ) : (
                <ul className="list">
                  {a.permissions.map((p) => (
                    <li key={p}>
                      <div className="spread">
                        <strong>{meta.permissions[p]?.label ?? p}</strong>
                        <span className="row">
                          <span className="tag">{meta.permissions[p]?.category}</span>
                          <span className="muted small">Gewicht {meta.permissions[p]?.weight}</span>
                        </span>
                      </div>
                      <div className="small secondary">
                        {data.permissionJustifications[p] || <span className="muted">Keine Begründung angegeben</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
          <Card title="Steckbrief">
            <dl className="kv">
              <dt>Owner</dt>
              <dd>
                {data.owner ? (
                  <>
                    {data.owner.name}
                    {!data.owner.active && <Badge dot="critical">ausgeschieden</Badge>}
                    <div className="cell-sub">{data.owner.email}</div>
                  </>
                ) : (
                  <span className="muted">kein Owner</span>
                )}
              </dd>
              <dt>Team</dt>
              <dd>{data.team?.name ?? "–"}</dd>
              <dt>Repository</dt>
              <dd>
                {a.repositoryUrl ? (
                  <a href={a.repositoryUrl} target="_blank" rel="noreferrer noopener">
                    {a.repositoryUrl}
                  </a>
                ) : (
                  "–"
                )}
              </dd>
              {a.type === "mcp_server" && (
                <>
                  <dt>MCP-Endpunkt</dt>
                  <dd>
                    <span className="tag">{a.mcpTransport ? meta.mcpTransports[a.mcpTransport] : "–"}</span>
                    <div className="mono small">{a.mcpEndpoint ?? "–"}</div>
                  </dd>
                </>
              )}
              <dt>Daten</dt>
              <dd>
                {meta.dataClassifications[a.dataClassification]}
                {a.processesPersonalData && <div className="cell-sub">verarbeitet personenbezogene Daten</div>}
              </dd>
              <dt>Erreichbarkeit</dt>
              <dd>{meta.exposures[a.exposure]}</dd>
              <dt>Autonomie</dt>
              <dd>
                {meta.autonomyLevels[a.autonomyLevel]}
                <div className="cell-sub">
                  {a.humanInTheLoop ? "Mensch bestätigt schreibende Aktionen" : "ohne menschliche Bestätigung"} ·{" "}
                  {a.sandboxed ? "in Sandbox" : "ohne Sandbox"}
                </div>
              </dd>
              <dt>Secrets</dt>
              <dd>{meta.secretsManagement[a.secretsManagement]}</dd>
              <dt>Modelle</dt>
              <dd>
                {a.models.length
                  ? a.models.map((m) => (
                      <span key={m} className="tag mono" style={{ marginRight: 4 }}>
                        {m}
                      </span>
                    ))
                  : "–"}
              </dd>
              <dt>Fähigkeiten</dt>
              <dd>
                {a.capabilities.length
                  ? a.capabilities.map((c) => (
                      <span key={c} className="tag" style={{ marginRight: 4 }}>
                        {c}
                      </span>
                    ))
                  : "–"}
              </dd>
              <dt>Tags</dt>
              <dd>{a.tags.length ? a.tags.join(", ") : "–"}</dd>
              <dt>Umgebungen</dt>
              <dd>{a.environments.length ? a.environments.join(", ") : "–"}</dd>
              <dt>Budget / Monat</dt>
              <dd>{a.monthlyBudgetUsd ? fmtUsd(a.monthlyBudgetUsd) : "–"}</dd>
              <dt>Letztes Review</dt>
              <dd>
                {fmtDate(a.lastReviewAt)} <span className="muted small">({fmtRelative(a.lastReviewAt)})</span>
              </dd>
              <dt>Registriert</dt>
              <dd>{fmtDate(a.createdAt)}</dd>
            </dl>
          </Card>
        </div>
      )}

      {tab === "risk" && (
        <div className="grid grid-main-side">
          <div className="stack">
            {data.findings.length === 0 && (
              <div className="callout ok">
                <Icon name="check" /> Keine Befunde – das Asset erfüllt alle Governance-Regeln.
              </div>
            )}
            {data.findings.map((f) => (
              <Card key={f.ruleId}>
                <div className="spread">
                  <div className="row">
                    <SeverityBadge severity={f.severity} />
                    <span className="tag">{f.category}</span>
                    <span className="mono muted small">{f.ruleId}</span>
                  </div>
                  {f.acceptance ? (
                    <Badge dot="muted">akzeptiert bis {fmtDate(f.acceptance.expiresAt)}</Badge>
                  ) : (
                    hasRole("security", "privacy", "finance", "team_lead", "architecture") &&
                    a.ownerId !== me.id &&
                    a.createdBy !== me.id && (
                      <button className="btn btn-sm" onClick={() => setAccepting(f)}>
                        Risiko akzeptieren …
                      </button>
                    )
                  )}
                </div>
                <h3 style={{ margin: "10px 0 4px" }}>{f.title}</h3>
                <p className="mt-0 secondary">{f.detail}</p>
                <p className="small" style={{ marginBottom: 0 }}>
                  <strong>Empfehlung:</strong> {f.recommendation}
                </p>
                {f.acceptance && (
                  <div className="callout" style={{ marginTop: 10 }}>
                    <div className="small">
                      <strong>Risikoakzeptanz</strong> durch {f.acceptance.acceptedByName ?? "–"} am{" "}
                      {fmtDate(f.acceptance.acceptedAt)}: {f.acceptance.justification}
                      <div>
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ paddingLeft: 0 }}
                          onClick={async () => {
                            const ok = await action.run(async () => {
                              await api.del(`/acceptances/${f.acceptance!.id}`);
                              return true;
                            });
                            if (ok) reload();
                          }}
                        >
                          Akzeptanz widerrufen
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </Card>
            ))}
          </div>
          <Card
            title={`Risiko-Score ${data.risk.score} / 100`}
            subtitle="Additives, nachvollziehbares Modell – jeder Punkt hat eine Ursache."
          >
            <ul className="list">
              {data.risk.factors.map((f) => (
                <li key={f.label} className="spread" style={{ flexWrap: "nowrap" }}>
                  <span className="small">{f.label}</span>
                  <strong className="num">+{f.points}</strong>
                </li>
              ))}
              {data.risk.factors.length === 0 && <li className="muted">Keine Risikofaktoren.</li>}
            </ul>
          </Card>
        </div>
      )}

      {tab === "approvals" && <ApprovalsTab data={data} reload={reload} currentRound={currentRound} olderRounds={olderRounds} />}

      {tab === "costs" && (
        <div className="grid grid-main-side">
          <Card title="Tägliche Kosten" subtitle="Letzte 60 Tage">
            <DailyColumnChart
              data={data.usage.map((u) => ({ date: u.date, value: u.costUsd }))}
              reference={a.monthlyBudgetUsd ? a.monthlyBudgetUsd / 30 : undefined}
              referenceLabel="Tagesbudget"
              ariaLabel="Tägliche Kosten des Assets"
            />
          </Card>
          <Card title="Laufender Monat">
            <div className="stat">
              <span className="stat-label">Kosten bisher</span>
              <span className="stat-value num">{fmtUsd(data.mtdCostUsd)}</span>
              <span className="stat-sub">Hochrechnung {fmtUsd(data.forecastUsd)}</span>
            </div>
            {a.monthlyBudgetUsd ? (
              <div style={{ marginTop: 14 }}>
                <div className="spread small secondary" style={{ marginBottom: 6 }}>
                  <span>Budget {fmtUsd(a.monthlyBudgetUsd)}</span>
                  <span>{Math.round((data.mtdCostUsd / a.monthlyBudgetUsd) * 100)} %</span>
                </div>
                <Meter value={data.mtdCostUsd} max={a.monthlyBudgetUsd} />
              </div>
            ) : (
              <p className="muted small">Kein Budget festgelegt.</p>
            )}
          </Card>
        </div>
      )}

      {tab === "relations" && (
        <div className="grid grid-3">
          <Card title="Nutzt" subtitle="MCP-Server, Agents und Dienste, von denen dieses Asset abhängt">
            <RelationList items={data.dependencies} />
          </Card>
          <Card title="Wird genutzt von">
            <RelationList items={data.dependents} />
          </Card>
          <Card title="Ähnliche Assets" subtitle="Redundanz-Check über Fähigkeiten und Beschreibung">
            {data.similar.length === 0 ? (
              <Empty>Keine ähnlichen Assets.</Empty>
            ) : (
              <ul className="list">
                {data.similar.map((s) => (
                  <li key={s.id} className="spread">
                    <span>
                      <Link to={`/inventar/${s.id}`}>{s.name}</Link>
                      <div className="cell-sub">{s.sharedCapabilities.join(", ") || s.sharedTerms.join(", ")}</div>
                    </span>
                    <strong className="num">{Math.round(s.score * 100)} %</strong>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Discovery-Funde im Repository">
            {data.discoveries.length === 0 ? (
              <Empty>Keine Scanner-Funde zugeordnet.</Empty>
            ) : (
              <ul className="list">
                {data.discoveries.map((d) => (
                  <li key={d.id}>
                    <strong>{meta.discoveryKinds[d.kind] ?? d.kind}</strong> <span className="mono small">{d.path}</span>
                    <div className="cell-sub">zuletzt gesehen {fmtRelative(d.lastSeenAt)}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {tab === "history" && (
        <Card title="Verlauf" subtitle="Revisionssicheres Protokoll aller Änderungen und Entscheidungen">
          {data.history.length === 0 ? (
            <Empty>Noch keine Einträge.</Empty>
          ) : (
            <ul className="timeline">
              {data.history.map((h) => (
                <li key={h.id}>
                  <span className="muted small">{fmtDateTime(h.at)}</span>
                  <span>
                    {h.summary}
                    <div className="cell-sub">{h.actorLabel}</div>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {accepting && (
        <AcceptRiskModal
          assetId={a.id}
          finding={accepting}
          onClose={() => setAccepting(null)}
          onDone={() => {
            setAccepting(null);
            reload();
            refreshCounts();
            toast("Risikoakzeptanz dokumentiert");
          }}
        />
      )}
    </>
  );
}

function RelationList({ items }: { items: { id: number; name: string; type: string; status: string }[] }) {
  const { meta } = useApp();
  if (!items.length) return <Empty>Keine.</Empty>;
  return (
    <ul className="list">
      {items.map((d) => (
        <li key={d.id} className="spread">
          <span>
            <Link to={`/inventar/${d.id}`}>{d.name}</Link>
            <div className="cell-sub">{meta.assetTypes[d.type]}</div>
          </span>
          <StatusBadge status={d.status} />
        </li>
      ))}
    </ul>
  );
}

function ApprovalsTab({
  data,
  reload,
  currentRound,
  olderRounds,
}: {
  data: AssetDetail;
  reload: () => void;
  currentRound: AssetDetail["approvals"];
  olderRounds: AssetDetail["approvals"];
}) {
  const { meta, me, hasRole, toast, refreshCounts } = useApp();
  const [comment, setComment] = useState("");
  const action = useAction();
  const a = data.asset;
  const own = a.ownerId === me.id || a.createdBy === me.id;

  const decide = async (approvalId: number, decision: "approved" | "rejected") => {
    const ok = await action.run(() => api.post(`/approvals/${approvalId}/decide`, { decision, comment }));
    if (ok) {
      setComment("");
      toast(decision === "approved" ? "Freigegeben" : "Abgelehnt");
      reload();
      refreshCounts();
    }
  };

  return (
    <div className="grid grid-main-side">
      <Card
        title={`Freigaberunde ${a.approvalRound}`}
        subtitle="Benötigte Freigaben ergeben sich automatisch aus dem Risikoprofil."
      >
        <ErrorBox error={action.error} />
        {currentRound.length === 0 ? (
          <Empty>
            Noch nicht eingereicht. Benötigt werden: {data.requiredApprovals.map((r) => meta.roles[r.role]).join(", ")}.
          </Empty>
        ) : (
          <ul className="list">
            {data.requiredApprovals.map((req) => {
              const ap = currentRound.find((x) => x.role === req.role);
              const canDecide = ap?.decision === "pending" && hasRole(req.role) && !own;
              return (
                <li key={req.role}>
                  <div className="spread">
                    <div>
                      <strong>{meta.roles[req.role]}</strong>
                      <div className="cell-sub">{req.reason}</div>
                    </div>
                    {ap ? <ApprovalBadge decision={ap.decision} /> : <Badge dot="muted">nicht angefordert</Badge>}
                  </div>
                  {ap && ap.decision !== "pending" && (
                    <div className="small secondary" style={{ marginTop: 4 }}>
                      {ap.decidedByName} am {fmtDate(ap.decidedAt)}
                      {ap.comment && <>: „{ap.comment}“</>}
                    </div>
                  )}
                  {canDecide && (
                    <div className="stack" style={{ marginTop: 10, gap: 8 }}>
                      <textarea
                        placeholder="Kommentar (bei Ablehnung Pflicht)"
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                      />
                      <div className="row">
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => decide(ap.id, "approved")}
                          disabled={action.busy}
                        >
                          Freigeben
                        </button>
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() => decide(ap.id, "rejected")}
                          disabled={action.busy}
                        >
                          Ablehnen
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {own && currentRound.some((x) => x.decision === "pending") && (
          <p className="muted small">Vier-Augen-Prinzip: Eigene Assets können nicht selbst freigegeben werden.</p>
        )}
      </Card>
      <Card title="Frühere Runden">
        {olderRounds.length === 0 ? (
          <Empty>Keine.</Empty>
        ) : (
          <ul className="list">
            {olderRounds.map((ap) => (
              <li key={ap.id}>
                <div className="spread">
                  <span>
                    Runde {ap.round} · {meta.roles[ap.role]}
                  </span>
                  <ApprovalBadge decision={ap.decision} />
                </div>
                {ap.decidedByName && (
                  <div className="cell-sub">
                    {ap.decidedByName}, {fmtDate(ap.decidedAt)}
                    {ap.comment && <> – {ap.comment}</>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function AcceptRiskModal({
  assetId,
  finding,
  onClose,
  onDone,
}: {
  assetId: number;
  finding: Finding;
  onClose: () => void;
  onDone: () => void;
}) {
  const [justification, setJustification] = useState("");
  const [days, setDays] = useState(90);
  const action = useAction();
  const submit = async () => {
    const ok = await action.run(() =>
      api.post(`/assets/${assetId}/acceptances`, { ruleId: finding.ruleId, justification, days }),
    );
    if (ok) onDone();
  };
  return (
    <Modal
      title="Risiko akzeptieren"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={action.busy || justification.trim().length < 10}>
            Akzeptanz dokumentieren
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="callout warn">
          <Icon name="alert" />
          <div>
            <strong>
              {finding.ruleId}: {finding.title}
            </strong>
            <div className="small">{finding.detail}</div>
          </div>
        </div>
        <ErrorBox error={action.error} />
        <Field label="Begründung" hint="Warum ist das Risiko vertretbar? Welche kompensierenden Maßnahmen gibt es?">
          <textarea value={justification} onChange={(e) => setJustification(e.target.value)} />
        </Field>
        <Field label="Gültig für (Tage)" hint="Akzeptanzen laufen ab und müssen erneut bewertet werden (max. 365 Tage).">
          <input type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} />
        </Field>
      </div>
    </Modal>
  );
}
