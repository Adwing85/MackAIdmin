import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAction, useApi, useApp } from "../lib/app";
import { Card, ChipInput, ErrorBox, Field, Icon, Loading, PageHeader, Tabs } from "../components/ui";

interface Governance {
  reviewIntervalDays: number;
  globalMonthlyBudgetUsd: number;
  budgetAlertPercent: number;
  financeApprovalThresholdUsd: number;
  inactiveSeatDays: number;
  redundancyThreshold: number;
  allowedModels: string[];
}

interface ClaudeCodePolicy {
  allowRules: string[];
  askRules: string[];
  denyRules: string[];
  disableBypassPermissions: boolean;
  allowManagedPermissionRulesOnly: boolean;
  allowManagedHooksOnly: boolean;
  allowManagedMcpServersOnly: boolean;
  availableModels: string[];
  sandboxEnabled: boolean;
  sandboxAllowedDomains: string[];
  sandboxAllowManagedDomainsOnly: boolean;
  cleanupPeriodDays: number | null;
  requiredMinimumVersion: string | null;
  forceLoginMethod: "claudeai" | "console" | null;
  forceLoginOrgUUID: string | null;
  companyAnnouncements: string[];
  telemetryEnabled: boolean;
  otlpEndpoint: string | null;
}

interface Generated {
  settings: Record<string, unknown>;
  warnings: string[];
  allowedServers: string[];
  deniedServers: string[];
}

interface PoliciesResponse {
  governance: Governance;
  claudeCode: ClaudeCodePolicy;
  generated: Generated;
  paths: Record<string, string>;
}

type Tab = "claude" | "governance";

const lines = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

export function PoliciesPage() {
  const { data, error, reload } = useApi<PoliciesResponse>("/policies");
  const [tab, setTab] = useState<Tab>("claude");
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  return (
    <>
      <PageHeader
        title="Richtlinien & Policy"
        description="Die Plattform ist die Quelle der Wahrheit: Aus dem Inventar und diesen Vorgaben entsteht die verbindliche Claude-Code-Konfiguration (managed-settings.json) für alle Entwickler-Rechner."
      />
      <Tabs<Tab>
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "claude", label: "Claude-Code-Policy" },
          { id: "governance", label: "Governance-Regeln" },
        ]}
      />
      {tab === "claude" ? (
        <ClaudeCodeTab data={data} reload={reload} />
      ) : (
        <GovernanceTab data={data.governance} reload={reload} />
      )}
    </>
  );
}

function ClaudeCodeTab({ data, reload }: { data: PoliciesResponse; reload: () => void }) {
  const { hasRole, toast } = useApp();
  const [p, setP] = useState<ClaudeCodePolicy>(data.claudeCode);
  const [texts, setTexts] = useState({
    allow: data.claudeCode.allowRules.join("\n"),
    ask: data.claudeCode.askRules.join("\n"),
    deny: data.claudeCode.denyRules.join("\n"),
    announcements: data.claudeCode.companyAnnouncements.join("\n"),
  });
  const [generated, setGenerated] = useState<Generated>(data.generated);
  const action = useAction();
  const canEdit = hasRole("security");
  useEffect(() => setGenerated(data.generated), [data.generated]);

  const save = async () => {
    const body: ClaudeCodePolicy = {
      ...p,
      allowRules: lines(texts.allow),
      askRules: lines(texts.ask),
      denyRules: lines(texts.deny),
      companyAnnouncements: lines(texts.announcements),
      requiredMinimumVersion: p.requiredMinimumVersion?.trim() || null,
      forceLoginOrgUUID: p.forceLoginOrgUUID?.trim() || null,
      otlpEndpoint: p.otlpEndpoint?.trim() || null,
    };
    const res = await action.run(() => api.put<Generated>("/policies/claude-code", body));
    if (res) {
      setGenerated(res);
      toast("Policy gespeichert – managed-settings.json aktualisiert");
      reload();
    }
  };

  const json = JSON.stringify(generated.settings, null, 2);
  const flag = (key: keyof ClaudeCodePolicy, label: string, hint?: string) => (
    <label className="check">
      <input type="checkbox" disabled={!canEdit} checked={!!p[key]} onChange={(e) => setP({ ...p, [key]: e.target.checked })} />
      <span>
        {label}
        {hint && <div className="cell-sub">{hint}</div>}
      </span>
    </label>
  );

  return (
    <div className="grid grid-2" style={{ alignItems: "start" }}>
      <div className="stack">
        <Card
          title="MCP-Server"
          subtitle="Abgeleitet aus dem Inventar: freigegebene MCP-Server werden erlaubt, abgelehnte/stillgelegte explizit blockiert."
        >
          <div className="grid grid-2">
            <div>
              <h3 style={{ marginBottom: 6 }}>Erlaubt ({generated.allowedServers.length})</h3>
              <ul className="list small">
                {generated.allowedServers.map((s) => (
                  <li key={s} style={{ padding: "4px 0" }}>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 style={{ marginBottom: 6 }}>Blockiert ({generated.deniedServers.length})</h3>
              <ul className="list small">
                {generated.deniedServers.map((s) => (
                  <li key={s} style={{ padding: "4px 0" }}>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            {flag(
              "allowManagedMcpServersOnly",
              "Nur verwaltete MCP-Server zulassen",
              "Entwickler können die Allowlist nicht lokal erweitern (allowManagedMcpServersOnly).",
            )}
          </div>
          <p className="small muted" style={{ marginBottom: 0 }}>
            Neue MCP-Server werden über das <Link to="/inventar/neu?type=mcp_server">Inventar</Link> registriert und freigegeben.
          </p>
        </Card>

        <Card
          title="Berechtigungsregeln"
          subtitle="Eine Regel pro Zeile, Syntax wie in Claude Code, z. B. Bash(curl *), Read(./.env), WebFetch(domain:example.com)"
        >
          <div className="stack">
            <Field label="Verbieten (deny)">
              <textarea
                className="mono"
                rows={6}
                disabled={!canEdit}
                value={texts.deny}
                onChange={(e) => setTexts({ ...texts, deny: e.target.value })}
              />
            </Field>
            <Field label="Nachfragen (ask)">
              <textarea
                className="mono"
                rows={3}
                disabled={!canEdit}
                value={texts.ask}
                onChange={(e) => setTexts({ ...texts, ask: e.target.value })}
              />
            </Field>
            <Field label="Erlauben (allow)">
              <textarea
                className="mono"
                rows={3}
                disabled={!canEdit}
                value={texts.allow}
                onChange={(e) => setTexts({ ...texts, allow: e.target.value })}
              />
            </Field>
            {flag(
              "disableBypassPermissions",
              "Bypass-Modus deaktivieren",
              "Verhindert --dangerously-skip-permissions (disableBypassPermissionsMode).",
            )}
            {flag(
              "allowManagedPermissionRulesOnly",
              "Nur zentrale Berechtigungsregeln",
              "Ignoriert Regeln aus User- und Projekteinstellungen.",
            )}
            {flag("allowManagedHooksOnly", "Nur zentral verwaltete Hooks ausführen")}
          </div>
        </Card>

        <Card title="Sandbox, Modelle & Betrieb">
          <div className="stack">
            {flag("sandboxEnabled", "Sandbox für Shell-Befehle erzwingen")}
            {p.sandboxEnabled && (
              <>
                <Field label="Erlaubte Domains im Sandbox-Netzwerk">
                  <ChipInput
                    value={p.sandboxAllowedDomains}
                    onChange={(v) => setP({ ...p, sandboxAllowedDomains: v })}
                    placeholder="registry.npmjs.org"
                  />
                </Field>
                {flag("sandboxAllowManagedDomainsOnly", "Nur zentral erlaubte Domains")}
              </>
            )}
            <Field
              label="Erlaubte Modelle in Claude Code"
              hint="Leer = keine Einschränkung. Aliase (opus, sonnet) oder Modell-IDs."
            >
              <ChipInput
                value={p.availableModels}
                onChange={(v) => setP({ ...p, availableModels: v })}
                placeholder="opus, sonnet"
              />
            </Field>
            <div className="form-grid">
              <Field label="Login-Methode erzwingen">
                <select
                  disabled={!canEdit}
                  value={p.forceLoginMethod ?? ""}
                  onChange={(e) =>
                    setP({ ...p, forceLoginMethod: (e.target.value || null) as ClaudeCodePolicy["forceLoginMethod"] })
                  }
                >
                  <option value="">keine Vorgabe</option>
                  <option value="claudeai">Claude-Konto (Team/Enterprise)</option>
                  <option value="console">Claude Console (API)</option>
                </select>
              </Field>
              <Field label="Organisations-UUID erzwingen">
                <input
                  type="text"
                  className="mono"
                  disabled={!canEdit}
                  value={p.forceLoginOrgUUID ?? ""}
                  onChange={(e) => setP({ ...p, forceLoginOrgUUID: e.target.value })}
                />
              </Field>
              <Field label="Mindestversion Claude Code">
                <input
                  type="text"
                  disabled={!canEdit}
                  placeholder="z. B. 2.1.150"
                  value={p.requiredMinimumVersion ?? ""}
                  onChange={(e) => setP({ ...p, requiredMinimumVersion: e.target.value })}
                />
              </Field>
              <Field label="Lokale Transkripte löschen nach (Tagen)">
                <input
                  type="number"
                  min={1}
                  disabled={!canEdit}
                  value={p.cleanupPeriodDays ?? ""}
                  onChange={(e) => setP({ ...p, cleanupPeriodDays: e.target.value ? Number(e.target.value) : null })}
                />
              </Field>
            </div>
            {flag(
              "telemetryEnabled",
              "OpenTelemetry-Export aktivieren",
              "Zentrales Monitoring von Kosten, Tokens und Tool-Nutzung über Ihren OTLP-Collector.",
            )}
            {p.telemetryEnabled && (
              <Field label="OTLP-Endpunkt">
                <input
                  type="url"
                  disabled={!canEdit}
                  placeholder="https://otel.intern.example:4318"
                  value={p.otlpEndpoint ?? ""}
                  onChange={(e) => setP({ ...p, otlpEndpoint: e.target.value })}
                />
              </Field>
            )}
            <Field label="Hinweis beim Start (eine Meldung pro Zeile)">
              <textarea
                rows={2}
                disabled={!canEdit}
                value={texts.announcements}
                onChange={(e) => setTexts({ ...texts, announcements: e.target.value })}
              />
            </Field>
          </div>
        </Card>
        <ErrorBox error={action.error} />
        {canEdit && (
          <div>
            <button className="btn btn-primary" onClick={save} disabled={action.busy}>
              Policy speichern
            </button>
          </div>
        )}
      </div>

      <div className="stack" style={{ position: "sticky", top: 70 }}>
        <Card
          title="managed-settings.json"
          subtitle="Wird bei jeder Änderung im Inventar automatisch neu erzeugt"
          actions={
            <a className="btn btn-sm" href="/api/policies/claude-code/managed-settings.json" download>
              <Icon name="download" /> Herunterladen
            </a>
          }
        >
          {generated.warnings.length > 0 && (
            <div className="callout warn" style={{ marginBottom: 10 }}>
              <Icon name="alert" />
              <ul style={{ margin: 0 }}>
                {generated.warnings.map((w) => (
                  <li key={w} className="small">
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <pre className="code-block">{json}</pre>
        </Card>
        <Card title="Verteilung auf die Rechner">
          <p className="small secondary mt-0">Datei per MDM (Intune, Jamf), GPO oder Config-Management an diesen Ort legen:</p>
          <dl className="kv small">
            {Object.entries(data.paths).map(([os, path]) => (
              <div key={os} style={{ display: "contents" }}>
                <dt>{os}</dt>
                <dd className="mono">{path}</dd>
              </div>
            ))}
          </dl>
          <p className="small secondary">
            Automatisiert abrufen – API-Token mit Scope <code>policy:read</code>:
          </p>
          <pre className="code-block small">{`curl -fsS -H "Authorization: Bearer $MACKAIDMIN_TOKEN" \\
  ${window.location.origin}/api/policies/claude-code/managed-settings.json \\
  -o /etc/claude-code/managed-settings.json`}</pre>
          <p className="small muted" style={{ marginBottom: 0 }}>
            Alternativ den Inhalt als Server-managed Settings in der Claude-Admin-Konsole hinterlegen. Mit <code>/status</code>{" "}
            prüfen Entwickler:innen, welche Policy aktiv ist.
          </p>
        </Card>
      </div>
    </div>
  );
}

function GovernanceTab({ data, reload }: { data: Governance; reload: () => void }) {
  const { hasRole, toast } = useApp();
  const [g, setG] = useState<Governance>(data);
  const action = useAction();
  const canEdit = hasRole("admin");
  const save = async () => {
    const ok = await action.run(() => api.put("/policies/governance", g));
    if (ok) {
      toast("Governance-Regeln gespeichert");
      reload();
    }
  };
  const num = (key: keyof Governance, label: string, hint: string, step = 1) => (
    <Field label={label} hint={hint}>
      <input
        type="number"
        step={step}
        disabled={!canEdit}
        value={g[key] as number}
        onChange={(e) => setG({ ...g, [key]: Number(e.target.value) })}
      />
    </Field>
  );
  return (
    <Card title="Governance-Regeln" subtitle="Schwellwerte für Befunde, Freigaben und Auswertungen">
      <div className="form-grid">
        {num("globalMonthlyBudgetUsd", "Gesamtbudget pro Monat (USD)", "Token-Kosten aller Assets und Claude-Code-Nutzung", 100)}
        {num("budgetAlertPercent", "Budgetwarnung ab (%)", "Hochrechnung in Prozent des Budgets")}
        {num(
          "financeApprovalThresholdUsd",
          "Finanzfreigabe ab Monatsbudget (USD)",
          "Assets mit höherem Budget benötigen eine Freigabe durch Finanzen",
          100,
        )}
        {num("reviewIntervalDays", "Standard-Review-Intervall (Tage)", "Danach wird ein Review-Befund erzeugt")}
        {num("inactiveSeatDays", "Lizenz inaktiv nach (Tagen)", "Seats ohne Nutzung gelten als Einsparpotenzial")}
        {num(
          "redundancyThreshold",
          "Redundanz-Schwellwert (0,1–0,95)",
          "Ab dieser Ähnlichkeit werden Paare als Kandidaten gelistet",
          0.05,
        )}
        <Field label="Freigegebene Modelle" className="span-2" hint="Assets mit anderen Modellen erhalten den Befund GOV-05">
          <ChipInput value={g.allowedModels} onChange={(v) => setG({ ...g, allowedModels: v })} placeholder="claude-sonnet-5-5" />
        </Field>
      </div>
      <div style={{ marginTop: 14 }}>
        <ErrorBox error={action.error} />
        {canEdit && (
          <button className="btn btn-primary" onClick={save} disabled={action.busy} style={{ marginTop: 8 }}>
            Speichern
          </button>
        )}
      </div>
    </Card>
  );
}
