import { useState } from "react";
import { api } from "../lib/api";
import { useAction, useApi, useApp } from "../lib/app";
import { fmtDate, fmtRelative, fmtUsd } from "../lib/format";
import type { Person, Team } from "../lib/types";
import { Badge, Card, ErrorBox, Field, Icon, Loading, Modal, PageHeader, Tabs } from "../components/ui";

type Tab = "people" | "teams" | "tokens";

interface Token {
  id: number;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdBy: string | null;
}

export function OrganizationPage() {
  const { hasRole } = useApp();
  const [tab, setTab] = useState<Tab>("people");
  const tabs: { id: Tab; label: string }[] = [
    { id: "people", label: "Personen & Rollen" },
    { id: "teams", label: "Teams" },
  ];
  if (hasRole("admin")) tabs.push({ id: "tokens", label: "API-Tokens" });
  return (
    <>
      <PageHeader
        title="Organisation"
        description="Personen, Rollen, Teams und Maschinen-Zugänge. Rollen steuern, wer welche Freigaben erteilen darf."
      />
      <Tabs<Tab> active={tab} onChange={setTab} tabs={tabs} />
      {tab === "people" && <PeopleTab />}
      {tab === "teams" && <TeamsTab />}
      {tab === "tokens" && <TokensTab />}
    </>
  );
}

function PeopleTab() {
  const { meta, hasRole } = useApp();
  const { data, error, reload } = useApi<Person[]>("/org/people");
  const teams = useApi<Team[]>("/org/teams").data ?? [];
  const [editing, setEditing] = useState<Person | "new" | null>(null);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  return (
    <Card
      flush
      title={`${data.filter((p) => p.active).length} aktive Personen`}
      actions={
        hasRole("admin") && (
          <button className="btn btn-primary btn-sm" style={{ marginRight: 18 }} onClick={() => setEditing("new")}>
            <Icon name="plus" /> Person anlegen
          </button>
        )
      }
    >
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Rollen</th>
              <th>Team</th>
              <th>Letzte Anmeldung</th>
              {hasRole("admin") && <th />}
            </tr>
          </thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.id}>
                <td>
                  <div className="cell-title">
                    {p.name} {!p.active && <Badge dot="muted">deaktiviert</Badge>}
                  </div>
                  <div className="cell-sub">{p.email}</div>
                </td>
                <td>
                  <div className="row" style={{ gap: 4 }}>
                    {p.roles.map((r) => (
                      <span key={r} className="tag">
                        {meta.roles[r] ?? r}
                      </span>
                    ))}
                  </div>
                </td>
                <td>{p.teamName ?? "–"}</td>
                <td className="small">{p.lastLoginAt ? fmtRelative(p.lastLoginAt) : <span className="muted">nie</span>}</td>
                {hasRole("admin") && (
                  <td className="right">
                    <button className="btn btn-sm" onClick={() => setEditing(p)}>
                      Bearbeiten
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <PersonModal person={editing === "new" ? null : editing} teams={teams} onClose={() => setEditing(null)} onDone={reload} />
      )}
    </Card>
  );
}

function PersonModal({
  person,
  teams,
  onClose,
  onDone,
}: {
  person: Person | null;
  teams: Team[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { meta, toast } = useApp();
  const [f, setF] = useState({
    email: person?.email ?? "",
    name: person?.name ?? "",
    roles: person?.roles ?? ["developer"],
    teamId: person?.teamId ?? null,
    active: person?.active ?? true,
    password: "",
  });
  const action = useAction();
  const save = async () => {
    const body = { ...f, password: f.password || undefined };
    const ok = await action.run(() => (person ? api.put(`/org/people/${person.id}`, body) : api.post("/org/people", body)));
    if (ok) {
      toast("Gespeichert");
      onDone();
      onClose();
    }
  };
  const toggleRole = (r: string) => setF({ ...f, roles: f.roles.includes(r) ? f.roles.filter((x) => x !== r) : [...f.roles, r] });
  return (
    <Modal
      title={person ? "Person bearbeiten" : "Person anlegen"}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn btn-primary" onClick={save} disabled={action.busy || !f.roles.length}>
            Speichern
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Name">
          <input type="text" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="E-Mail">
          <input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
        <Field label="Team">
          <select value={f.teamId ?? ""} onChange={(e) => setF({ ...f, teamId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">– ohne Team –</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={person ? "Neues Passwort (optional)" : "Passwort"} hint="Mind. 10 Zeichen. Leer lassen bei SSO.">
          <input
            type="password"
            autoComplete="new-password"
            value={f.password}
            onChange={(e) => setF({ ...f, password: e.target.value })}
          />
        </Field>
        <div className="span-2">
          <div className="field-label" style={{ marginBottom: 6 }}>
            Rollen
          </div>
          <div className="grid grid-2" style={{ gap: 6 }}>
            {Object.entries(meta.roles).map(([k, v]) => (
              <label key={k} className="check">
                <input type="checkbox" checked={f.roles.includes(k)} onChange={() => toggleRole(k)} />
                {v}
              </label>
            ))}
          </div>
        </div>
        <label className="check span-2">
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
          Aktiv (deaktivierte Personen können sich nicht anmelden; ihre Assets werden als verwaist markiert)
        </label>
      </div>
      <div style={{ marginTop: 12 }}>
        <ErrorBox error={action.error} />
      </div>
    </Modal>
  );
}

function TeamsTab() {
  const { hasRole } = useApp();
  const { data, error, reload } = useApi<Team[]>("/org/teams");
  const [editing, setEditing] = useState<Team | "new" | null>(null);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  return (
    <Card
      flush
      title={`${data.length} Teams`}
      actions={
        hasRole("admin") && (
          <button className="btn btn-primary btn-sm" style={{ marginRight: 18 }} onClick={() => setEditing("new")}>
            <Icon name="plus" /> Team anlegen
          </button>
        )
      }
    >
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Team</th>
              <th>Kostenstelle</th>
              <th className="num">Budget / Monat</th>
              <th className="num">Personen</th>
              <th className="num">Assets</th>
              {hasRole("admin") && <th />}
            </tr>
          </thead>
          <tbody>
            {data.map((t) => (
              <tr key={t.id}>
                <td className="cell-title">{t.name}</td>
                <td>{t.costCenter ?? "–"}</td>
                <td className="num">{t.monthlyBudgetUsd != null ? fmtUsd(t.monthlyBudgetUsd) : "–"}</td>
                <td className="num">{t.members}</td>
                <td className="num">{t.assets}</td>
                {hasRole("admin") && (
                  <td className="right">
                    <button className="btn btn-sm" onClick={() => setEditing(t)}>
                      Bearbeiten
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <TeamModal team={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={reload} />}
    </Card>
  );
}

function TeamModal({ team, onClose, onDone }: { team: Team | null; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    name: team?.name ?? "",
    costCenter: team?.costCenter ?? "",
    monthlyBudgetUsd: team?.monthlyBudgetUsd?.toString() ?? "",
  });
  const action = useAction();
  const save = async () => {
    const body = {
      name: f.name,
      costCenter: f.costCenter || null,
      monthlyBudgetUsd: f.monthlyBudgetUsd === "" ? null : Number(f.monthlyBudgetUsd),
    };
    const ok = await action.run(() => (team ? api.put(`/org/teams/${team.id}`, body) : api.post("/org/teams", body)));
    if (ok) {
      onDone();
      onClose();
    }
  };
  return (
    <Modal
      title={team ? "Team bearbeiten" : "Team anlegen"}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn btn-primary" onClick={save} disabled={action.busy || f.name.trim().length < 2}>
            Speichern
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="Name">
          <input type="text" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Kostenstelle">
          <input type="text" value={f.costCenter} onChange={(e) => setF({ ...f, costCenter: e.target.value })} />
        </Field>
        <Field label="Monatsbudget (USD)">
          <input
            type="number"
            min={0}
            value={f.monthlyBudgetUsd}
            onChange={(e) => setF({ ...f, monthlyBudgetUsd: e.target.value })}
          />
        </Field>
        <ErrorBox error={action.error} />
      </div>
    </Modal>
  );
}

function TokensTab() {
  const { meta, toast } = useApp();
  const { data, error, reload } = useApi<Token[]>("/tokens");
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [created, setCreated] = useState<string | null>(null);
  const action = useAction();
  const create = async () => {
    const res = await action.run(() => api.post<{ token: string }>("/tokens", { name, scopes }));
    if (res) {
      setCreated(res.token);
      setName("");
      setScopes([]);
      reload();
    }
  };
  const revoke = async (t: Token) => {
    if (!window.confirm(`Token „${t.name}“ widerrufen?`)) return;
    const ok = await action.run(async () => {
      await api.del(`/tokens/${t.id}`);
      return true;
    });
    if (ok) {
      toast("Token widerrufen");
      reload();
    }
  };
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  return (
    <div className="grid grid-main-side" style={{ alignItems: "start" }}>
      <Card flush title="API-Tokens" subtitle="Für Apps, Agents, CI-Pipelines, Scanner und MDM – jeweils mit minimalen Scopes.">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Scopes</th>
                <th>Zuletzt genutzt</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((t) => (
                <tr key={t.id}>
                  <td>
                    <div className="cell-title">{t.name}</div>
                    <div className="cell-sub mono">
                      {t.prefix}… · erstellt {fmtDate(t.createdAt)} von {t.createdBy ?? "–"}
                    </div>
                  </td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      {t.scopes.map((s) => (
                        <span key={s} className="tag mono">
                          {s}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="small">{fmtRelative(t.lastUsedAt)}</td>
                  <td className="right">
                    {t.revokedAt ? (
                      <Badge dot="muted">widerrufen</Badge>
                    ) : (
                      <button className="btn btn-sm btn-danger" onClick={() => revoke(t)}>
                        Widerrufen
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {data.length === 0 && (
                <tr>
                  <td colSpan={4} className="empty">
                    Noch keine Tokens.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Neues Token">
        <div className="stack">
          <Field label="Name">
            <input type="text" placeholder="z. B. Discovery-Scanner CI" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div>
            <div className="field-label" style={{ marginBottom: 6 }}>
              Scopes
            </div>
            <div className="stack" style={{ gap: 6 }}>
              {Object.entries(meta.tokenScopes).map(([k, v]) => (
                <label key={k} className="check">
                  <input
                    type="checkbox"
                    checked={scopes.includes(k)}
                    onChange={() => setScopes(scopes.includes(k) ? scopes.filter((s) => s !== k) : [...scopes, k])}
                  />
                  <span>
                    <span className="mono">{k}</span>
                    <div className="cell-sub">{v}</div>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <ErrorBox error={action.error} />
          <button className="btn btn-primary" onClick={create} disabled={action.busy || name.trim().length < 2 || !scopes.length}>
            Token erstellen
          </button>
          {created && (
            <div className="callout ok">
              <Icon name="key" />
              <div>
                <strong>Token wird nur einmal angezeigt:</strong>
                <pre className="mono small" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", marginTop: 4 }}>
                  {created}
                </pre>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
