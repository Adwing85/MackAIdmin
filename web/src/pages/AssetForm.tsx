import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAction, useApi, useApp, useDebounced } from "../lib/app";
import type { AssetDetail, AssetSummary, Person, RiskAssessment, SimilarAsset, Team } from "../lib/types";
import { Card, ChipInput, ErrorBox, Field, Icon, Loading, PageHeader, RiskBadge, StatusBadge } from "../components/ui";

interface FormState {
  name: string;
  type: string;
  description: string;
  purpose: string;
  ownerId: number | null;
  teamId: number | null;
  repositoryUrl: string;
  environments: string[];
  dataClassification: string;
  processesPersonalData: boolean;
  exposure: string;
  autonomyLevel: 0 | 1 | 2 | 3;
  humanInTheLoop: boolean;
  sandboxed: boolean;
  secretsManagement: string;
  models: string[];
  capabilities: string[];
  tags: string[];
  permissions: Record<string, string>; // key -> justification
  dependencies: number[];
  mcpTransport: string;
  mcpEndpoint: string;
  monthlyBudgetUsd: string;
  reviewIntervalDays: string;
}

const EMPTY: FormState = {
  name: "",
  type: "agent",
  description: "",
  purpose: "",
  ownerId: null,
  teamId: null,
  repositoryUrl: "",
  environments: [],
  dataClassification: "internal",
  processesPersonalData: false,
  exposure: "internal",
  autonomyLevel: 1,
  humanInTheLoop: true,
  sandboxed: false,
  secretsManagement: "none",
  models: ["claude-sonnet-5-5"],
  capabilities: [],
  tags: [],
  permissions: {},
  dependencies: [],
  mcpTransport: "http",
  mcpEndpoint: "",
  monthlyBudgetUsd: "",
  reviewIntervalDays: "",
};

function toPayload(f: FormState) {
  return {
    name: f.name,
    type: f.type,
    description: f.description,
    purpose: f.purpose,
    ownerId: f.ownerId,
    teamId: f.teamId,
    repositoryUrl: f.repositoryUrl.trim() || null,
    environments: f.environments,
    dataClassification: f.dataClassification,
    processesPersonalData: f.processesPersonalData,
    exposure: f.exposure,
    autonomyLevel: f.autonomyLevel,
    humanInTheLoop: f.humanInTheLoop,
    sandboxed: f.sandboxed,
    secretsManagement: f.secretsManagement,
    models: f.models,
    capabilities: f.capabilities,
    tags: f.tags,
    permissions: Object.entries(f.permissions).map(([key, justification]) => ({ key, justification })),
    dependencies: f.dependencies,
    mcpTransport: f.type === "mcp_server" ? f.mcpTransport : null,
    mcpEndpoint: f.type === "mcp_server" ? f.mcpEndpoint.trim() || null : null,
    monthlyBudgetUsd: f.monthlyBudgetUsd === "" ? null : Number(f.monthlyBudgetUsd),
    reviewIntervalDays: f.reviewIntervalDays === "" ? null : Number(f.reviewIntervalDays),
  };
}

export function AssetFormPage() {
  const { id } = useParams();
  const editing = !!id;
  const { meta, me, toast, refreshCounts } = useApp();
  const navigate = useNavigate();
  const existing = useApi<AssetDetail>(editing ? `/assets/${id}` : null);
  const people = useApi<Person[]>("/org/people").data ?? [];
  const teams = useApi<Team[]>("/org/teams").data ?? [];
  const assets = useApi<AssetSummary[]>("/assets").data ?? [];
  const policy = useApi<{ governance: { allowedModels: string[] } }>("/policies").data;
  const [params] = useSearchParams();
  const [form, setForm] = useState<FormState | null>(
    editing
      ? null
      : {
          ...EMPTY,
          ownerId: me.id,
          teamId: me.teamId,
          // Prefill from a shadow-AI discovery ("register this repository").
          name: params.get("name") ?? "",
          type: params.get("type") ?? EMPTY.type,
          repositoryUrl: params.get("repo") ?? "",
        },
  );
  const action = useAction();

  useEffect(() => {
    if (!existing.data || form) return;
    const a = existing.data.asset;
    setForm({
      name: a.name,
      type: a.type,
      description: a.description,
      purpose: a.purpose,
      ownerId: a.ownerId,
      teamId: a.teamId,
      repositoryUrl: a.repositoryUrl ?? "",
      environments: a.environments,
      dataClassification: a.dataClassification,
      processesPersonalData: a.processesPersonalData,
      exposure: a.exposure,
      autonomyLevel: a.autonomyLevel,
      humanInTheLoop: a.humanInTheLoop,
      sandboxed: a.sandboxed,
      secretsManagement: a.secretsManagement,
      models: a.models,
      capabilities: a.capabilities,
      tags: a.tags,
      permissions: Object.fromEntries(a.permissions.map((p) => [p, existing.data!.permissionJustifications[p] ?? ""])),
      dependencies: a.dependencies,
      mcpTransport: a.mcpTransport ?? "http",
      mcpEndpoint: a.mcpEndpoint ?? "",
      monthlyBudgetUsd: a.monthlyBudgetUsd == null ? "" : String(a.monthlyBudgetUsd),
      reviewIntervalDays: a.reviewIntervalDays == null ? "" : String(a.reviewIntervalDays),
    });
  }, [existing.data, form]);

  // Live preview: risk, required approvals and "does this already exist?"
  const debounced = useDebounced(form, 450);
  const [preview, setPreview] = useState<{
    risk: RiskAssessment;
    requiredApprovals: { role: string; reason: string }[];
    similar: SimilarAsset[];
  } | null>(null);
  useEffect(() => {
    if (!debounced) return;
    api
      .post<typeof preview>("/assets/preview", { ...toPayload(debounced), id: editing ? Number(id) : undefined })
      .then(setPreview)
      .catch(() => undefined);
  }, [debounced, editing, id]);

  const capabilitySuggestions = useMemo(() => [...new Set(assets.flatMap((a) => a.capabilities))].sort(), [assets]);
  const permissionGroups = useMemo(() => {
    const groups: Record<string, string[]> = {};
    for (const [key, p] of Object.entries(meta.permissions)) (groups[p.category] ??= []).push(key);
    return groups;
  }, [meta]);

  if (existing.error) return <ErrorBox error={existing.error} />;
  if (!form) return <Loading />;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));
  const togglePermission = (key: string) =>
    setForm((f) => {
      if (!f) return f;
      const next = { ...f.permissions };
      if (key in next) delete next[key];
      else next[key] = "";
      return { ...f, permissions: next };
    });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (editing) {
      const res = await action.run(() => api.put<{ id: number; newApprovalRound: boolean }>(`/assets/${id}`, toPayload(form)));
      if (res) {
        toast(res.newApprovalRound ? "Gespeichert – risikorelevante Änderung: neue Freigaberunde gestartet" : "Gespeichert");
        refreshCounts();
        navigate(`/inventar/${id}`);
      }
    } else {
      const res = await action.run(() => api.post<{ id: number }>("/assets", toPayload(form)));
      if (res) {
        toast("Asset registriert");
        navigate(`/inventar/${res.id}`);
      }
    }
  };

  const dependencyOptions = assets
    .filter((a) => a.id !== Number(id))
    .sort((a, b) => Number(b.type === "mcp_server") - Number(a.type === "mcp_server") || a.name.localeCompare(b.name));
  const modelSuggestions = policy?.governance.allowedModels ?? [];

  return (
    <form onSubmit={submit}>
      <PageHeader
        title={editing ? `${form.name || "Asset"} bearbeiten` : "Asset registrieren"}
        description={
          editing
            ? "Änderungen an Rechten, Erreichbarkeit, Daten oder Budget eines freigegebenen Assets starten automatisch eine neue Freigaberunde."
            : "Neue App, neuer Agent, MCP-Server oder Skill? Erst registrieren – die Plattform prüft Risiko, Redundanzen und holt die richtigen Freigaben ein."
        }
        actions={
          <>
            <Link className="btn" to={editing ? `/inventar/${id}` : "/inventar"}>
              Abbrechen
            </Link>
            <button className="btn btn-primary" type="submit" disabled={action.busy}>
              {editing ? "Speichern" : "Als Entwurf anlegen"}
            </button>
          </>
        }
      />
      <ErrorBox error={action.error} />
      <div className="grid grid-main-side" style={{ marginTop: 12, alignItems: "start" }}>
        <div className="stack">
          <Card title="Grunddaten">
            <div className="form-grid">
              <Field label="Name *" htmlFor="f-name">
                <input
                  id="f-name"
                  type="text"
                  required
                  minLength={2}
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                />
              </Field>
              <Field label="Typ" htmlFor="f-type">
                <select id="f-type" value={form.type} onChange={(e) => set("type", e.target.value)}>
                  {Object.entries(meta.assetTypes).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Beschreibung"
                className="span-2"
                htmlFor="f-desc"
                hint="Was macht das Asset? Je genauer, desto besser funktioniert die Redundanzerkennung."
              >
                <textarea id="f-desc" value={form.description} onChange={(e) => set("description", e.target.value)} />
              </Field>
              <Field label="Zweck / Business-Nutzen" className="span-2" htmlFor="f-purpose">
                <input id="f-purpose" type="text" value={form.purpose} onChange={(e) => set("purpose", e.target.value)} />
              </Field>
              <Field
                label="Fähigkeiten"
                className="span-2"
                hint="Standardisierte Funktions-Tags (z. B. code-review, ticket-triage). Wichtigstes Signal für die Redundanzerkennung."
              >
                <ChipInput
                  id="f-caps"
                  value={form.capabilities}
                  onChange={(v) => set("capabilities", v)}
                  suggestions={capabilitySuggestions}
                  placeholder="code-review, sql-generation …"
                />
              </Field>
              <Field label="Owner" htmlFor="f-owner">
                <select
                  id="f-owner"
                  value={form.ownerId ?? ""}
                  onChange={(e) => set("ownerId", e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">– kein Owner –</option>
                  {people
                    .filter((p) => p.active || p.id === form.ownerId)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Team" htmlFor="f-team">
                <select
                  id="f-team"
                  value={form.teamId ?? ""}
                  onChange={(e) => set("teamId", e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">– ohne Team –</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Repository-URL" htmlFor="f-repo" hint="Ermöglicht die automatische Zuordnung von Discovery-Funden.">
                <input
                  id="f-repo"
                  type="text"
                  placeholder="https://github.example.com/org/repo"
                  value={form.repositoryUrl}
                  onChange={(e) => set("repositoryUrl", e.target.value)}
                />
              </Field>
              <Field label="Umgebungen">
                <ChipInput value={form.environments} onChange={(v) => set("environments", v)} placeholder="dev, test, prod" />
              </Field>
              <Field label="Tags" className="span-2">
                <ChipInput value={form.tags} onChange={(v) => set("tags", v)} placeholder="Freie Schlagworte" />
              </Field>
            </div>
          </Card>

          {form.type === "mcp_server" && (
            <Card
              title="MCP-Server"
              subtitle="Freigegebene MCP-Server landen automatisch in der Allowlist der Claude-Code-Policy (managed-settings.json)."
            >
              <div className="form-grid">
                <Field label="Transport" htmlFor="f-transport">
                  <select id="f-transport" value={form.mcpTransport} onChange={(e) => set("mcpTransport", e.target.value)}>
                    {Object.entries(meta.mcpTransports).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label={form.mcpTransport === "stdio" ? "Startbefehl" : "URL"}
                  htmlFor="f-endpoint"
                  hint={
                    form.mcpTransport === "stdio"
                      ? "Exakter Befehl inkl. Argumente, z. B. npx -y @org/mcp-server"
                      : "Platzhalter * erlaubt, z. B. https://mcp.example.com/*"
                  }
                >
                  <input
                    id="f-endpoint"
                    type="text"
                    className="mono"
                    value={form.mcpEndpoint}
                    onChange={(e) => set("mcpEndpoint", e.target.value)}
                  />
                </Field>
              </div>
            </Card>
          )}

          <Card title="Daten, Erreichbarkeit & Autonomie">
            <div className="form-grid">
              <Field label="Datenklassifizierung" htmlFor="f-class">
                <select id="f-class" value={form.dataClassification} onChange={(e) => set("dataClassification", e.target.value)}>
                  {Object.entries(meta.dataClassifications).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Erreichbarkeit" htmlFor="f-exposure">
                <select id="f-exposure" value={form.exposure} onChange={(e) => set("exposure", e.target.value)}>
                  {Object.entries(meta.exposures).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Autonomiestufe" htmlFor="f-autonomy">
                <select
                  id="f-autonomy"
                  value={form.autonomyLevel}
                  onChange={(e) => set("autonomyLevel", Number(e.target.value) as 0 | 1 | 2 | 3)}
                >
                  {Object.entries(meta.autonomyLevels).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Secrets-Verwaltung" htmlFor="f-secrets">
                <select id="f-secrets" value={form.secretsManagement} onChange={(e) => set("secretsManagement", e.target.value)}>
                  {Object.entries(meta.secretsManagement).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="span-2 stack" style={{ gap: 8 }}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={form.processesPersonalData}
                    onChange={(e) => set("processesPersonalData", e.target.checked)}
                  />
                  <span>
                    Verarbeitet personenbezogene Daten (DSGVO)
                    <div className="cell-sub">Kunden-, Mitarbeiter- oder Bewerberdaten, auch in Logs oder Prompts</div>
                  </span>
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={form.humanInTheLoop}
                    onChange={(e) => set("humanInTheLoop", e.target.checked)}
                  />
                  <span>Mensch bestätigt schreibende Aktionen (Human-in-the-Loop)</span>
                </label>
                <label className="check">
                  <input type="checkbox" checked={form.sandboxed} onChange={(e) => set("sandboxed", e.target.checked)} />
                  <span>Läuft isoliert (Sandbox / Container mit Netzwerk-Allowlist)</span>
                </label>
              </div>
            </div>
          </Card>

          <Card title="Berechtigungen" subtitle="Nur anhaken, was wirklich benötigt wird – und kurz begründen.">
            <div className="grid grid-2">
              {Object.entries(permissionGroups).map(([category, keys]) => (
                <div key={category}>
                  <h3 style={{ marginBottom: 8 }}>{category}</h3>
                  <div className="stack" style={{ gap: 8 }}>
                    {keys.map((key) => (
                      <div key={key}>
                        <label className="check">
                          <input type="checkbox" checked={key in form.permissions} onChange={() => togglePermission(key)} />
                          <span>
                            {meta.permissions[key].label} <span className="muted small">({meta.permissions[key].weight})</span>
                          </span>
                        </label>
                        {key in form.permissions && (
                          <input
                            type="text"
                            style={{ marginTop: 6, height: 30 }}
                            placeholder="Begründung"
                            aria-label={`Begründung für ${meta.permissions[key].label}`}
                            value={form.permissions[key]}
                            onChange={(e) =>
                              setForm((f) => (f ? { ...f, permissions: { ...f.permissions, [key]: e.target.value } } : f))
                            }
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Modelle, Budget & Review">
            <div className="form-grid">
              <Field
                label="Genutzte Modelle"
                className="span-2"
                hint={modelSuggestions.length ? `Freigegeben: ${modelSuggestions.join(", ")}` : undefined}
              >
                <ChipInput
                  id="f-models"
                  value={form.models}
                  onChange={(v) => set("models", v)}
                  suggestions={modelSuggestions}
                  placeholder="claude-sonnet-5-5"
                />
              </Field>
              <Field label="Monatsbudget (USD)" htmlFor="f-budget">
                <input
                  id="f-budget"
                  type="number"
                  min={0}
                  step={10}
                  value={form.monthlyBudgetUsd}
                  onChange={(e) => set("monthlyBudgetUsd", e.target.value)}
                />
              </Field>
              <Field label="Review-Intervall (Tage)" htmlFor="f-review" hint="Leer = Standard aus den Richtlinien">
                <input
                  id="f-review"
                  type="number"
                  min={7}
                  max={1095}
                  value={form.reviewIntervalDays}
                  onChange={(e) => set("reviewIntervalDays", e.target.value)}
                />
              </Field>
            </div>
          </Card>

          <Card
            title="Abhängigkeiten"
            subtitle="Welche MCP-Server, Agents oder Dienste nutzt dieses Asset? Nicht freigegebene Abhängigkeiten erzeugen einen Befund."
          >
            <div className="grid grid-2" style={{ gap: 6 }}>
              {dependencyOptions.map((a) => (
                <label key={a.id} className="check">
                  <input
                    type="checkbox"
                    checked={form.dependencies.includes(a.id)}
                    onChange={(e) =>
                      set(
                        "dependencies",
                        e.target.checked ? [...form.dependencies, a.id] : form.dependencies.filter((d) => d !== a.id),
                      )
                    }
                  />
                  <span>
                    {a.name} <span className="cell-sub">{meta.assetTypes[a.type]}</span>
                  </span>
                </label>
              ))}
            </div>
          </Card>
        </div>

        <div className="stack" style={{ position: "sticky", top: 70 }}>
          <Card title="Live-Bewertung">
            {!preview ? (
              <Loading />
            ) : (
              <>
                <div className="spread">
                  <span className="secondary">Risiko</span>
                  <RiskBadge level={preview.risk.level} score={preview.risk.score} />
                </div>
                <ul className="list" style={{ marginTop: 6 }}>
                  {preview.risk.factors.slice(0, 6).map((f) => (
                    <li key={f.label} className="spread small" style={{ padding: "6px 0", flexWrap: "nowrap" }}>
                      <span>{f.label}</span>
                      <strong className="num">+{f.points}</strong>
                    </li>
                  ))}
                </ul>
                <h3 style={{ margin: "12px 0 6px" }}>Benötigte Freigaben</h3>
                <ul className="list">
                  {preview.requiredApprovals.map((r) => (
                    <li key={r.role} style={{ padding: "6px 0" }}>
                      <strong className="small">{meta.roles[r.role]}</strong>
                      <div className="cell-sub">{r.reason}</div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
          <Card title="Gibt es das schon?" subtitle="Ähnliche Assets im Inventar">
            {!preview || preview.similar.length === 0 ? (
              <p className="muted small mt-0" style={{ marginBottom: 0 }}>
                {form.name.length < 3 ? "Name und Beschreibung eingeben …" : "Keine ähnlichen Assets gefunden."}
              </p>
            ) : (
              <>
                {preview.similar[0].score >= 0.4 && (
                  <div className="callout warn small" style={{ marginBottom: 8 }}>
                    <Icon name="redundancy" />
                    <span>Bitte prüfen, ob ein bestehendes Asset wiederverwendet oder erweitert werden kann.</span>
                  </div>
                )}
                <ul className="list">
                  {preview.similar.map((s) => (
                    <li key={s.id} style={{ padding: "6px 0" }}>
                      <div className="spread">
                        <Link to={`/inventar/${s.id}`} target="_blank">
                          {s.name}
                        </Link>
                        <strong className="num small">{Math.round(s.score * 100)} %</strong>
                      </div>
                      <div className="row" style={{ marginTop: 2 }}>
                        <StatusBadge status={s.status} />
                        <span className="cell-sub">{s.sharedCapabilities.join(", ") || s.sharedTerms.join(", ")}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        </div>
      </div>
    </form>
  );
}
