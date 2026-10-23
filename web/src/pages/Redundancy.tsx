import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAction, useApi, useApp } from "../lib/app";
import { fmtDate } from "../lib/format";
import { Badge, Card, ErrorBox, Field, Loading, Modal, PageHeader, Segmented, StatusBadge } from "../components/ui";

interface Side {
  id: number;
  key: string;
  name: string;
  type: string;
  status: string;
  team: string | null;
}

interface Pair {
  score: number;
  sharedCapabilities: string[];
  sharedTerms: string[];
  a: Side;
  b: Side;
  crossTeam: boolean;
  decision: {
    decision: "intended" | "consolidate" | "false_positive";
    note: string;
    decidedAt: string;
    decidedBy: string | null;
  } | null;
}

const DECISIONS = {
  consolidate: { label: "Konsolidieren", dot: "warning" },
  intended: { label: "Bewusst parallel", dot: "muted" },
  false_positive: { label: "Keine Redundanz", dot: "good" },
} as const;

type Filter = "open" | "decided" | "all";

export function RedundancyPage() {
  const { meta, hasRole, toast } = useApp();
  const { data, error, reload } = useApi<Pair[]>("/redundancy");
  const [filter, setFilter] = useState<Filter>("open");
  const [deciding, setDeciding] = useState<Pair | null>(null);

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const rows = data.filter((p) => (filter === "open" ? !p.decision : filter === "decided" ? !!p.decision : true));
  const canDecide = hasRole("architecture", "team_lead");

  return (
    <>
      <PageHeader
        title="Redundanzen"
        description="Assets mit überlappenden Fähigkeiten oder ähnlicher Beschreibung. Doppelte Lösungen kosten doppelt – Token, Lizenzen, Wartung und Sicherheitsprüfungen. Die Ähnlichkeit kombiniert Fähigkeits-Tags (stark) mit Textähnlichkeit (TF-IDF)."
      />
      <div className="filters">
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { id: "open", label: `Ungeprüft (${data.filter((p) => !p.decision).length})` },
            { id: "decided", label: "Entschieden" },
            { id: "all", label: "Alle" },
          ]}
        />
      </div>
      <Card flush>
        {rows.length === 0 ? (
          <div className="empty">Keine Kandidaten. Der Schwellwert lässt sich unter Richtlinien anpassen.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="num">Ähnlichkeit</th>
                  <th>Asset A</th>
                  <th>Asset B</th>
                  <th>Gemeinsamkeiten</th>
                  <th>Entscheidung</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={`${p.a.id}-${p.b.id}`}>
                    <td className="num">
                      <strong>{Math.round(p.score * 100)} %</strong>
                      {p.crossTeam && <div className="cell-sub">teamübergreifend</div>}
                    </td>
                    {[p.a, p.b].map((side) => (
                      <td key={side.id}>
                        <Link to={`/inventar/${side.id}`} className="cell-title">
                          {side.name}
                        </Link>
                        <div className="cell-sub">
                          {meta.assetTypes[side.type]} · {side.team ?? "ohne Team"}
                        </div>
                        <div style={{ marginTop: 4 }}>
                          <StatusBadge status={side.status} />
                        </div>
                      </td>
                    ))}
                    <td style={{ maxWidth: 260 }}>
                      {p.sharedCapabilities.length > 0 && (
                        <div className="row" style={{ gap: 4 }}>
                          {p.sharedCapabilities.map((c) => (
                            <span key={c} className="tag">
                              {c}
                            </span>
                          ))}
                        </div>
                      )}
                      {p.sharedTerms.length > 0 && <div className="cell-sub">Begriffe: {p.sharedTerms.join(", ")}</div>}
                    </td>
                    <td>
                      {p.decision ? (
                        <>
                          <Badge dot={DECISIONS[p.decision.decision].dot}>{DECISIONS[p.decision.decision].label}</Badge>
                          <div className="cell-sub">
                            {p.decision.decidedBy}, {fmtDate(p.decision.decidedAt)}
                          </div>
                          {p.decision.note && <div className="cell-sub">{p.decision.note}</div>}
                        </>
                      ) : (
                        <span className="muted small">offen</span>
                      )}
                      {canDecide && (
                        <div>
                          <button className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => setDeciding(p)}>
                            {p.decision ? "Ändern" : "Bewerten"}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {deciding && (
        <DecideModal
          pair={deciding}
          onClose={() => setDeciding(null)}
          onDone={() => {
            setDeciding(null);
            toast("Entscheidung gespeichert");
            reload();
          }}
        />
      )}
    </>
  );
}

function DecideModal({ pair, onClose, onDone }: { pair: Pair; onClose: () => void; onDone: () => void }) {
  const [decision, setDecision] = useState<keyof typeof DECISIONS>(pair.decision?.decision ?? "consolidate");
  const [note, setNote] = useState(pair.decision?.note ?? "");
  const action = useAction();
  const save = async (value: keyof typeof DECISIONS | null) => {
    const ok = await action.run(() =>
      api.post("/redundancy/decision", { assetA: pair.a.id, assetB: pair.b.id, decision: value, note }),
    );
    if (ok) onDone();
  };
  return (
    <Modal
      title="Redundanz bewerten"
      onClose={onClose}
      footer={
        <>
          {pair.decision && (
            <button className="btn" style={{ marginRight: "auto" }} onClick={() => save(null)}>
              Zurücksetzen
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn btn-primary" onClick={() => save(decision)} disabled={action.busy}>
            Speichern
          </button>
        </>
      }
    >
      <div className="stack">
        <p className="mt-0">
          <strong>{pair.a.name}</strong> ↔ <strong>{pair.b.name}</strong> ({Math.round(pair.score * 100)} % ähnlich)
        </p>
        <Field label="Entscheidung">
          <select value={decision} onChange={(e) => setDecision(e.target.value as keyof typeof DECISIONS)}>
            {Object.entries(DECISIONS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Notiz / Maßnahme" hint="z. B. welches Asset abgelöst wird und bis wann">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <ErrorBox error={action.error} />
      </div>
    </Modal>
  );
}
