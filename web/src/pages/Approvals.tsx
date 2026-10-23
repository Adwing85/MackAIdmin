import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAction, useApi, useApp } from "../lib/app";
import { fmtDate, fmtRelative } from "../lib/format";
import type { Approval, RiskLevel } from "../lib/types";
import {
  ApprovalBadge,
  Card,
  ErrorBox,
  Field,
  Loading,
  Modal,
  PageHeader,
  RiskBadge,
  Segmented,
  StatusBadge,
} from "../components/ui";

interface ApprovalItem extends Approval {
  asset: {
    id: number;
    name: string;
    type: string;
    status: string;
    riskLevel: RiskLevel;
    riskScore: number;
    openFindings: number;
    owner: string | null;
    team: string | null;
  };
  canDecide: boolean;
}

type Scope = "mine" | "open" | "history";

export function ApprovalsPage() {
  const { meta, toast, refreshCounts } = useApp();
  const [scope, setScope] = useState<Scope>("mine");
  const { data, error, reload } = useApi<ApprovalItem[]>(`/approvals?scope=${scope}`);
  const [deciding, setDeciding] = useState<{ item: ApprovalItem; decision: "approved" | "rejected" } | null>(null);

  return (
    <>
      <PageHeader
        title="Freigaben"
        description="Risikobasierter Freigabeprozess: Teamleitung immer, Architektur ab mittlerem Risiko und für MCP-Server, IT-Sicherheit bei hohem Risiko oder externer Erreichbarkeit, Datenschutz bei personenbezogenen Daten, Finanzen bei hohen Budgets."
      />
      <div className="filters">
        <Segmented<Scope>
          value={scope}
          onChange={setScope}
          options={[
            { id: "mine", label: "Für mich" },
            { id: "open", label: "Alle offenen" },
            { id: "history", label: "Entschieden" },
          ]}
        />
      </div>
      <ErrorBox error={error} />
      <Card flush>
        {!data ? (
          <Loading />
        ) : data.length === 0 ? (
          <div className="empty">{scope === "mine" ? "Keine offenen Freigaben für Ihre Rollen." : "Keine Einträge."}</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Rolle</th>
                  <th>Begründung</th>
                  <th>Risiko</th>
                  <th>{scope === "history" ? "Entscheidung" : "Angefordert"}</th>
                  {scope !== "history" && <th />}
                </tr>
              </thead>
              <tbody>
                {data.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <Link className="cell-title" to={`/inventar/${item.asset.id}`}>
                        {item.asset.name}
                      </Link>
                      <div className="cell-sub">
                        {meta.assetTypes[item.asset.type]} · {item.asset.owner ?? "kein Owner"} · {item.asset.team ?? "ohne Team"}
                      </div>
                      <div style={{ marginTop: 4 }}>
                        <StatusBadge status={item.asset.status} />
                      </div>
                    </td>
                    <td className="nowrap">
                      {meta.roles[item.role]}
                      <div className="cell-sub">Runde {item.round}</div>
                    </td>
                    <td className="small">{item.reason}</td>
                    <td>
                      <RiskBadge level={item.asset.riskLevel} score={item.asset.riskScore} />
                      {item.asset.openFindings > 0 && <div className="cell-sub">{item.asset.openFindings} offene Befunde</div>}
                    </td>
                    <td className="small">
                      {scope === "history" ? (
                        <>
                          <ApprovalBadge decision={item.decision} />
                          <div className="cell-sub">
                            {item.decidedByName}, {fmtDate(item.decidedAt)}
                          </div>
                          {item.comment && <div className="cell-sub">„{item.comment}“</div>}
                        </>
                      ) : (
                        fmtRelative(item.createdAt)
                      )}
                    </td>
                    {scope !== "history" && (
                      <td className="nowrap right">
                        {item.canDecide ? (
                          <div className="row" style={{ justifyContent: "flex-end" }}>
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={() => setDeciding({ item, decision: "approved" })}
                            >
                              Freigeben
                            </button>
                            <button className="btn btn-sm btn-danger" onClick={() => setDeciding({ item, decision: "rejected" })}>
                              Ablehnen
                            </button>
                          </div>
                        ) : (
                          <span className="muted small">andere Rolle</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {deciding && (
        <DecisionModal
          item={deciding.item}
          decision={deciding.decision}
          onClose={() => setDeciding(null)}
          onDone={() => {
            setDeciding(null);
            toast(deciding.decision === "approved" ? "Freigegeben" : "Abgelehnt");
            reload();
            refreshCounts();
          }}
        />
      )}
    </>
  );
}

function DecisionModal({
  item,
  decision,
  onClose,
  onDone,
}: {
  item: ApprovalItem;
  decision: "approved" | "rejected";
  onClose: () => void;
  onDone: () => void;
}) {
  const { meta } = useApp();
  const [comment, setComment] = useState("");
  const action = useAction();
  const submit = async () => {
    const ok = await action.run(() => api.post(`/approvals/${item.id}/decide`, { decision, comment }));
    if (ok) onDone();
  };
  return (
    <Modal
      title={decision === "approved" ? "Freigabe erteilen" : "Freigabe ablehnen"}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button
            className={`btn ${decision === "approved" ? "btn-primary" : "btn-danger"}`}
            onClick={submit}
            disabled={action.busy || (decision === "rejected" && !comment.trim())}
          >
            {decision === "approved" ? "Freigeben" : "Ablehnen"}
          </button>
        </>
      }
    >
      <div className="stack">
        <p className="mt-0">
          <strong>{item.asset.name}</strong> als <strong>{meta.roles[item.role]}</strong>. Bitte vorher die{" "}
          <Link to={`/inventar/${item.asset.id}`} target="_blank">
            Befunde und Berechtigungen
          </Link>{" "}
          prüfen.
        </p>
        <ErrorBox error={action.error} />
        <Field label={decision === "rejected" ? "Begründung (Pflicht)" : "Kommentar (optional)"}>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} autoFocus />
        </Field>
      </div>
    </Modal>
  );
}
