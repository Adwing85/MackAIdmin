import {
  ASSET_STATUSES,
  HIGH_IMPACT_WRITE_PERMISSIONS,
  LIVE_STATUSES,
  ROLES,
  type AssetStatus,
  type AssetType,
  type Severity,
} from "./catalog.js";
import { approvalState, type RequiredApproval } from "./approvals.js";
import type { RiskAssessment } from "./risk.js";
import type { Asset, GovernanceSettings } from "./types.js";

export type FindingCategory = "Sicherheit" | "Datenschutz" | "Governance" | "Kosten";

export interface FindingContext {
  now: Date;
  settings: GovernanceSettings;
  risk: RiskAssessment;
  requiredApprovals: RequiredApproval[];
  /** Decisions of the asset's current approval round. */
  approvalDecisions: { role: string; decision: "pending" | "approved" | "rejected" }[];
  ownerActive: boolean;
  dependencies: { id: number; key: string; name: string; type: AssetType; status: AssetStatus }[];
  mtdCostUsd: number;
  forecastUsd: number;
}

export interface Finding {
  ruleId: string;
  severity: Severity;
  category: FindingCategory;
  title: string;
  detail: string;
  recommendation: string;
}

export interface Rule {
  id: string;
  severity: Severity;
  category: FindingCategory;
  title: string;
  recommendation: string;
  /** Returns a detail text when the rule fires, otherwise null. */
  check: (asset: Asset, ctx: FindingContext) => string | null;
}

const isLive = (a: Asset) => LIVE_STATUSES.includes(a.status);
const isInUse = (a: Asset) => isLive(a) || a.status === "in_review";
const approvedBy = (ctx: FindingContext, role: string) =>
  ctx.approvalDecisions.some((d) => d.role === role && d.decision === "approved");
const has = (a: Asset, ...perms: string[]) => perms.some((p) => (a.permissions as string[]).includes(p));
const usd = (n: number) => `${n.toLocaleString("de-DE", { maximumFractionDigits: 0 })} USD`;

export const RULES: Rule[] = [
  {
    id: "SEC-01",
    severity: "critical",
    category: "Sicherheit",
    title: "Öffentlich erreichbar ohne Security-Freigabe",
    recommendation:
      "Security-Review durchführen (Pentest/Threat-Model, AuthN/AuthZ, Rate-Limits). Bis dahin nur intern betreiben.",
    check: (a, ctx) =>
      isInUse(a) && a.exposure === "public" && !approvedBy(ctx, "security")
        ? "Das Asset ist aus dem Internet erreichbar, die IT-Sicherheit hat es aber (in der aktuellen Version) nicht freigegeben."
        : null,
  },
  {
    id: "SEC-02",
    severity: "critical",
    category: "Sicherheit",
    title: "Autonomer Agent mit Schreibrechten auf kritische Systeme",
    recommendation:
      "Human-in-the-Loop für schreibende Aktionen einführen, Rechte auf Staging begrenzen oder Autonomiestufe senken.",
    check: (a) => {
      const critical = a.permissions.filter((p) => HIGH_IMPACT_WRITE_PERMISSIONS.includes(p));
      if (a.autonomyLevel >= 2 && !a.humanInTheLoop && critical.length) {
        return `Autonomiestufe L${a.autonomyLevel} ohne menschliche Bestätigung, aber Rechte: ${critical.join(", ")}.`;
      }
      return null;
    },
  },
  {
    id: "SEC-03",
    severity: "high",
    category: "Sicherheit",
    title: "Exfiltrationsrisiko: sensible Daten + Kanal nach außen",
    recommendation:
      "Netzwerkzugriff per Allowlist/Sandbox einschränken oder sensiblen Zugriff entfernen. Prompt-Injection-Szenarien prüfen.",
    check: (a) =>
      has(a, "secrets.read", "pii.access") && has(a, "net.outbound", "external.api", "email.send")
        ? "Das Asset kann sensible Daten lesen und gleichzeitig Daten nach außen senden („lethal trifecta“ bei nicht vertrauenswürdigen Eingaben)."
        : null,
  },
  {
    id: "SEC-04",
    severity: "high",
    category: "Sicherheit",
    title: "Secrets im Klartext",
    recommendation: "Secrets in den zentralen Secret-Store (Vault, Key Vault, …) verschieben und rotieren.",
    check: (a) => (a.secretsManagement === "plaintext" ? "Zugangsdaten liegen im Code oder in Konfigurationsdateien." : null),
  },
  {
    id: "SEC-05",
    severity: "high",
    category: "Sicherheit",
    title: "Nutzung nicht freigegebener MCP-Server / Abhängigkeiten",
    recommendation:
      "Abhängigkeit zur Freigabe einreichen oder durch einen freigegebenen MCP-Server ersetzen. Nicht freigegebene Server werden in der Claude-Code-Policy blockiert.",
    check: (a, ctx) => {
      const bad = ctx.dependencies.filter((d) => !["approved", "active"].includes(d.status));
      return bad.length
        ? `Abhängigkeiten ohne Freigabe: ${bad.map((d) => `${d.name} (${ASSET_STATUSES[d.status]})`).join(", ")}.`
        : null;
    },
  },
  {
    id: "SEC-06",
    severity: "medium",
    category: "Sicherheit",
    title: "Shell-Ausführung ohne Sandbox",
    recommendation: "Claude-Code-Sandbox bzw. Container/VM mit Netzwerk-Allowlist verwenden (sandbox.enabled, allowedDomains).",
    check: (a) =>
      has(a, "shell.exec", "code.untrusted") && !a.sandboxed
        ? "Das Asset führt Befehle bzw. fremden Code ohne Isolation aus."
        : null,
  },
  {
    id: "SEC-07",
    severity: "medium",
    category: "Sicherheit",
    title: "Administrative Rechte (Least Privilege verletzt?)",
    recommendation: "Prüfen, ob die Admin-Rechte wirklich benötigt werden; sonst auf minimale Rechte reduzieren.",
    check: (a) =>
      has(a, "iam.manage", "vcs.admin")
        ? "Das Asset besitzt Rechte zur Verwaltung von Benutzern, Berechtigungen oder Repository-Einstellungen."
        : null,
  },
  {
    id: "PRIV-01",
    severity: "high",
    category: "Datenschutz",
    title: "Personenbezogene Daten ohne Datenschutz-Freigabe",
    recommendation: "Datenschutz einbinden: Verarbeitungsverzeichnis, ggf. DSFA, AVV mit Anbietern, Löschkonzept.",
    check: (a, ctx) =>
      isInUse(a) && (a.processesPersonalData || has(a, "pii.access")) && !approvedBy(ctx, "privacy")
        ? "Das Asset verarbeitet personenbezogene Daten ohne Freigabe durch den Datenschutz."
        : null,
  },
  {
    id: "PRIV-02",
    severity: "medium",
    category: "Datenschutz",
    title: "Personenbezogene Daten an externe Dienste",
    recommendation: "Datenübermittlung prüfen (AVV, Drittlandtransfer, Datenminimierung/Pseudonymisierung).",
    check: (a) =>
      a.processesPersonalData && has(a, "external.api", "net.outbound")
        ? "Personenbezogene Daten können an externe APIs oder Dienste übermittelt werden."
        : null,
  },
  {
    id: "GOV-01",
    severity: "high",
    category: "Governance",
    title: "Im Betrieb ohne gültige Freigabe",
    recommendation:
      "Freigabe für die aktuelle Version einholen. Wesentliche Änderungen (Rechte, Erreichbarkeit, Daten) erfordern eine neue Freigaberunde.",
    check: (a, ctx) => {
      if (!["active", "approved"].includes(a.status)) return null;
      const state = approvalState(ctx.requiredApprovals, ctx.approvalDecisions);
      if (state === "complete") return null;
      const missing = ctx.requiredApprovals
        .filter((r) => !approvedBy(ctx, r.role))
        .map((r) => ROLES[r.role])
        .join(", ");
      return `Fehlende Freigaben in Runde ${a.approvalRound}: ${missing}.`;
    },
  },
  {
    id: "GOV-02",
    severity: "medium",
    category: "Governance",
    title: "Kein aktiver Verantwortlicher",
    recommendation: "Einen Owner benennen, der für Betrieb, Kosten und Sicherheit verantwortlich ist.",
    check: (a, ctx) =>
      a.status !== "retired" && !ctx.ownerActive
        ? "Dem Asset ist kein (aktiver) Owner zugeordnet – typisches Zeichen für verwaiste Tools."
        : null,
  },
  {
    id: "GOV-03",
    severity: "medium",
    category: "Governance",
    title: "Review überfällig",
    recommendation: "Regelmäßiges Review durchführen: Wird das Asset noch gebraucht? Stimmen Rechte und Kosten?",
    check: (a, ctx) => {
      if (!isLive(a)) return null;
      const interval = a.reviewIntervalDays ?? ctx.settings.reviewIntervalDays;
      const last = a.lastReviewAt ? new Date(a.lastReviewAt) : new Date(a.createdAt);
      const days = Math.floor((ctx.now.getTime() - last.getTime()) / 86_400_000);
      return days > interval ? `Letztes Review vor ${days} Tagen (Intervall: ${interval} Tage).` : null;
    },
  },
  {
    id: "GOV-04",
    severity: "low",
    category: "Governance",
    title: "Kein Quellcode-Repository hinterlegt",
    recommendation: "Repository-URL pflegen, damit Code, Reviews und Discovery-Scans zugeordnet werden können.",
    check: (a) =>
      isLive(a) && !a.repositoryUrl && a.type !== "mcp_server"
        ? "Für ein produktives Asset ist kein Repository hinterlegt."
        : null,
  },
  {
    id: "GOV-05",
    severity: "medium",
    category: "Governance",
    title: "Nicht freigegebenes Modell",
    recommendation: "Auf ein freigegebenes Modell wechseln oder die Modell-Policy erweitern lassen.",
    check: (a, ctx) => {
      const bad = a.models.filter((m) => !ctx.settings.allowedModels.includes(m));
      return bad.length ? `Nicht in der Modell-Policy: ${bad.join(", ")}.` : null;
    },
  },
  {
    id: "COST-01",
    severity: "high",
    category: "Kosten",
    title: "Monatsbudget überschritten",
    recommendation: "Ursache analysieren (Schleifen, fehlendes Prompt-Caching, zu großes Modell) und Budget anpassen lassen.",
    check: (a, ctx) =>
      a.monthlyBudgetUsd && ctx.mtdCostUsd > a.monthlyBudgetUsd
        ? `Kosten im laufenden Monat ${usd(ctx.mtdCostUsd)} bei Budget ${usd(a.monthlyBudgetUsd)}.`
        : null,
  },
  {
    id: "COST-02",
    severity: "medium",
    category: "Kosten",
    title: "Prognose überschreitet Monatsbudget",
    recommendation: "Verbrauch beobachten, Effort/Modellwahl und Caching prüfen.",
    check: (a, ctx) =>
      a.monthlyBudgetUsd && ctx.mtdCostUsd <= a.monthlyBudgetUsd && ctx.forecastUsd > a.monthlyBudgetUsd
        ? `Hochrechnung ${usd(ctx.forecastUsd)} bei Budget ${usd(a.monthlyBudgetUsd)}.`
        : null,
  },
  {
    id: "COST-03",
    severity: "low",
    category: "Kosten",
    title: "Token-Verbrauch ohne Budget",
    recommendation: "Monatsbudget festlegen, damit Abweichungen früh erkannt werden.",
    check: (a, ctx) =>
      !a.monthlyBudgetUsd && ctx.mtdCostUsd > 0 ? `Bereits ${usd(ctx.mtdCostUsd)} im laufenden Monat ohne Budget.` : null,
  },
];

export function evaluateFindings(asset: Asset, ctx: FindingContext): Finding[] {
  if (asset.status === "retired" || asset.status === "rejected") return [];
  const findings: Finding[] = [];
  for (const rule of RULES) {
    const detail = rule.check(asset, ctx);
    if (detail) {
      findings.push({
        ruleId: rule.id,
        severity: rule.severity,
        category: rule.category,
        title: rule.title,
        detail,
        recommendation: rule.recommendation,
      });
    }
  }
  return findings;
}

export const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];
