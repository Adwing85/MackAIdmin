import { useState } from "react";
import { api } from "../lib/api";
import { useAction, useApi, useApp } from "../lib/app";
import { fmtDate, fmtUsd } from "../lib/format";
import type { Person } from "../lib/types";
import { Badge, Card, ErrorBox, Field, Icon, Loading, Modal, PageHeader, Stat } from "../components/ui";

interface LicenseType {
  id: number;
  name: string;
  vendor: string;
  monthlyPriceUsd: number;
  seatsPurchased: number;
  includesClaudeCode: boolean;
  notes: string;
  assigned: number;
  inactive: number;
  monthlyCostUsd: number;
}

interface Assignment {
  id: number;
  licenseTypeId: number;
  licenseName: string;
  personId: number;
  personName: string;
  personEmail: string;
  personActive: boolean;
  teamName: string | null;
  assignedAt: string;
  lastActiveAt: string | null;
  daysSinceActive: number;
  inactive: boolean;
}

interface Overview {
  inactiveSeatDays: number;
  types: LicenseType[];
  assignments: Assignment[];
  kpis: {
    seatsPurchased: number;
    seatsAssigned: number;
    unassignedSeats: number;
    inactiveSeats: number;
    monthlyCostUsd: number;
    potentialSavingsUsd: number;
  };
}

export function LicensesPage() {
  const { hasRole, toast } = useApp();
  const { data, error, reload } = useApi<Overview>("/licenses");
  const [onlyInactive, setOnlyInactive] = useState(false);
  const [modal, setModal] = useState<{ kind: "type"; type: LicenseType | null } | { kind: "assign" } | null>(null);
  const action = useAction();
  const canManage = hasRole("finance", "team_lead");

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const k = data.kpis;
  const rows = data.assignments.filter((a) => !onlyInactive || a.inactive);

  const revoke = async (a: Assignment) => {
    if (!window.confirm(`Lizenz „${a.licenseName}“ von ${a.personName} entziehen?`)) return;
    const ok = await action.run(async () => {
      await api.del(`/licenses/assignments/${a.id}`);
      return true;
    });
    if (ok) {
      toast("Lizenz entzogen");
      reload();
    }
  };

  return (
    <>
      <PageHeader
        title="Lizenzen"
        description={`Wer hat welchen Seat – und wird er genutzt? Seats ohne Aktivität seit mehr als ${data.inactiveSeatDays} Tagen oder von ausgeschiedenen Personen gelten als Einsparpotenzial.`}
        actions={
          canManage && (
            <>
              {hasRole("finance") && (
                <button className="btn" onClick={() => setModal({ kind: "type", type: null })}>
                  Lizenztyp anlegen
                </button>
              )}
              <button className="btn btn-primary" onClick={() => setModal({ kind: "assign" })}>
                <Icon name="plus" /> Lizenz zuweisen
              </button>
            </>
          )
        }
      />
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat
          label="Zugewiesene Seats"
          value={`${k.seatsAssigned} / ${k.seatsPurchased}`}
          sub={`${k.unassignedSeats} gekauft, aber frei`}
        />
        <Stat label="Inaktive Seats" value={k.inactiveSeats} sub={`keine Nutzung seit > ${data.inactiveSeatDays} Tagen`} />
        <Stat label="Lizenzkosten / Monat" value={fmtUsd(k.monthlyCostUsd)} />
        <Stat label="Einsparpotenzial / Monat" value={fmtUsd(k.potentialSavingsUsd)} sub="inaktive + nicht zugewiesene Seats" />
      </div>
      <ErrorBox error={action.error} />

      <Card title="Lizenztypen" flush>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Lizenz</th>
                <th className="num">Preis / Monat</th>
                <th className="num">Gekauft</th>
                <th className="num">Zugewiesen</th>
                <th className="num">Inaktiv</th>
                <th className="num">Kosten / Monat</th>
                {hasRole("finance") && <th />}
              </tr>
            </thead>
            <tbody>
              {data.types.map((t) => (
                <tr key={t.id}>
                  <td>
                    <div className="cell-title">{t.name}</div>
                    <div className="cell-sub">
                      {t.vendor}
                      {t.includesClaudeCode ? " · inkl. Claude Code" : ""}
                      {t.notes ? ` · ${t.notes}` : ""}
                    </div>
                  </td>
                  <td className="num">{fmtUsd(t.monthlyPriceUsd)}</td>
                  <td className="num">{t.seatsPurchased}</td>
                  <td className="num">
                    {t.assigned}
                    {t.assigned > t.seatsPurchased && t.seatsPurchased > 0 && (
                      <div>
                        <Badge dot="critical">überbucht</Badge>
                      </div>
                    )}
                  </td>
                  <td className="num">{t.inactive}</td>
                  <td className="num">{fmtUsd(t.monthlyCostUsd)}</td>
                  {hasRole("finance") && (
                    <td className="right">
                      <button className="btn btn-sm" onClick={() => setModal({ kind: "type", type: t })}>
                        Bearbeiten
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {data.types.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty">
                    Noch keine Lizenztypen angelegt.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div style={{ height: 16 }} />
      <Card
        title="Zuweisungen"
        flush
        actions={
          <label className="check" style={{ paddingRight: 18 }}>
            <input type="checkbox" checked={onlyInactive} onChange={(e) => setOnlyInactive(e.target.checked)} />
            Nur inaktive
          </label>
        }
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Person</th>
                <th>Lizenz</th>
                <th>Zugewiesen</th>
                <th>Letzte Aktivität</th>
                <th>Status</th>
                {canManage && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td>
                    <div className="cell-title">{a.personName}</div>
                    <div className="cell-sub">
                      {a.personEmail} · {a.teamName ?? "ohne Team"}
                    </div>
                  </td>
                  <td>{a.licenseName}</td>
                  <td>{fmtDate(a.assignedAt)}</td>
                  <td>
                    {a.lastActiveAt ? fmtDate(a.lastActiveAt) : <span className="muted">nie</span>}
                    <div className="cell-sub">
                      {a.lastActiveAt
                        ? a.daysSinceActive === 0
                          ? "heute"
                          : a.daysSinceActive === 1
                            ? "gestern"
                            : `vor ${a.daysSinceActive} Tagen`
                        : `seit ${a.daysSinceActive} Tagen zugewiesen`}
                    </div>
                  </td>
                  <td>
                    {!a.personActive ? (
                      <Badge dot="critical">Person ausgeschieden</Badge>
                    ) : a.inactive ? (
                      <Badge dot="warning">inaktiv</Badge>
                    ) : (
                      <Badge dot="good">aktiv</Badge>
                    )}
                  </td>
                  {canManage && (
                    <td className="right">
                      <button className="btn btn-sm btn-danger" onClick={() => revoke(a)} disabled={action.busy}>
                        Entziehen
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && <div className="empty">Keine Zuweisungen.</div>}
      </Card>

      {modal?.kind === "type" && <LicenseTypeModal type={modal.type} onClose={() => setModal(null)} onDone={reload} />}
      {modal?.kind === "assign" && <AssignModal types={data.types} onClose={() => setModal(null)} onDone={reload} />}
    </>
  );
}

function LicenseTypeModal({ type, onClose, onDone }: { type: LicenseType | null; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    name: type?.name ?? "",
    vendor: type?.vendor ?? "Anthropic",
    monthlyPriceUsd: type?.monthlyPriceUsd ?? 0,
    seatsPurchased: type?.seatsPurchased ?? 0,
    includesClaudeCode: type?.includesClaudeCode ?? true,
    notes: type?.notes ?? "",
  });
  const action = useAction();
  const save = async () => {
    const ok = await action.run(() => (type ? api.put(`/licenses/types/${type.id}`, f) : api.post("/licenses/types", f)));
    if (ok) {
      onDone();
      onClose();
    }
  };
  const remove = async () => {
    if (!type || !window.confirm(`Lizenztyp „${type.name}“ löschen?`)) return;
    const ok = await action.run(async () => {
      await api.del(`/licenses/types/${type.id}`);
      return true;
    });
    if (ok) {
      onDone();
      onClose();
    }
  };
  return (
    <Modal
      title={type ? "Lizenztyp bearbeiten" : "Lizenztyp anlegen"}
      onClose={onClose}
      footer={
        <>
          {type && (
            <button className="btn btn-danger" style={{ marginRight: "auto" }} onClick={remove}>
              Löschen
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn btn-primary" onClick={save} disabled={action.busy || f.name.trim().length < 2}>
            Speichern
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Name" className="span-2">
          <input type="text" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Anbieter">
          <input type="text" value={f.vendor} onChange={(e) => setF({ ...f, vendor: e.target.value })} />
        </Field>
        <Field label="Preis pro Seat / Monat (USD)">
          <input
            type="number"
            min={0}
            step={1}
            value={f.monthlyPriceUsd}
            onChange={(e) => setF({ ...f, monthlyPriceUsd: Number(e.target.value) })}
          />
        </Field>
        <Field label="Gekaufte Seats">
          <input
            type="number"
            min={0}
            value={f.seatsPurchased}
            onChange={(e) => setF({ ...f, seatsPurchased: Number(e.target.value) })}
          />
        </Field>
        <Field label="Claude Code">
          <label className="check" style={{ marginTop: 6 }}>
            <input
              type="checkbox"
              checked={f.includesClaudeCode}
              onChange={(e) => setF({ ...f, includesClaudeCode: e.target.checked })}
            />
            Seat enthält Claude Code
          </label>
        </Field>
        <Field label="Notizen" className="span-2">
          <input type="text" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
      </div>
      <div style={{ marginTop: 12 }}>
        <ErrorBox error={action.error} />
      </div>
    </Modal>
  );
}

function AssignModal({ types, onClose, onDone }: { types: LicenseType[]; onClose: () => void; onDone: () => void }) {
  const people = useApi<Person[]>("/org/people").data ?? [];
  const [licenseTypeId, setLicense] = useState(types[0]?.id ?? 0);
  const [personId, setPerson] = useState(0);
  const action = useAction();
  const save = async () => {
    const ok = await action.run(() => api.post("/licenses/assignments", { licenseTypeId, personId }));
    if (ok) {
      onDone();
      onClose();
    }
  };
  const type = types.find((t) => t.id === licenseTypeId);
  return (
    <Modal
      title="Lizenz zuweisen"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn btn-primary" onClick={save} disabled={action.busy || !personId || !licenseTypeId}>
            Zuweisen
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="Lizenz">
          <select value={licenseTypeId} onChange={(e) => setLicense(Number(e.target.value))}>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.assigned}/{t.seatsPurchased})
              </option>
            ))}
          </select>
        </Field>
        {type && type.seatsPurchased > 0 && type.assigned >= type.seatsPurchased && (
          <div className="callout warn small">
            <Icon name="alert" /> Alle gekauften Seats sind vergeben – vorher inaktive Seats freigeben oder nachkaufen.
          </div>
        )}
        <Field label="Person">
          <select value={personId} onChange={(e) => setPerson(Number(e.target.value))}>
            <option value={0}>– auswählen –</option>
            {people
              .filter((p) => p.active)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.teamName ?? "ohne Team"})
                </option>
              ))}
          </select>
        </Field>
        <ErrorBox error={action.error} />
      </div>
    </Modal>
  );
}
