import type { ApproverRole } from "./catalog.js";
import { riskAtLeast, type RiskAssessment } from "./risk.js";
import type { Asset, GovernanceSettings } from "./types.js";

export interface RequiredApproval {
  role: ApproverRole;
  reason: string;
}

type ApprovalInput = Pick<
  Asset,
  "exposure" | "processesPersonalData" | "monthlyBudgetUsd" | "permissions" | "secretsManagement" | "type"
>;

/**
 * Risk-based approval matrix: low-risk tools only need the team lead, everything else pulls in
 * the specialist functions that actually carry the risk. This keeps the process light for the
 * 80 % harmless cases and strict where it matters.
 */
export function requiredApprovals(
  asset: ApprovalInput,
  risk: RiskAssessment,
  settings: Pick<GovernanceSettings, "financeApprovalThresholdUsd">,
): RequiredApproval[] {
  const result: RequiredApproval[] = [{ role: "team_lead", reason: "Fachliche Notwendigkeit & Verantwortlichkeit" }];

  if (riskAtLeast(risk.level, "medium") || asset.type === "mcp_server") {
    result.push({
      role: "architecture",
      reason:
        asset.type === "mcp_server"
          ? "MCP-Server werden zentral für alle Entwickler freigegeben"
          : "Risiko ab Stufe „Mittel“ – Architektur- und Redundanzprüfung",
    });
  }

  const securityReasons: string[] = [];
  if (riskAtLeast(risk.level, "high")) securityReasons.push("Risiko ab Stufe „Hoch“");
  if (asset.exposure === "public" || asset.exposure === "partner") securityReasons.push("extern erreichbar");
  if (asset.permissions.includes("secrets.read")) securityReasons.push("Zugriff auf Secrets");
  if (asset.secretsManagement === "plaintext") securityReasons.push("Secrets im Klartext");
  if (securityReasons.length) result.push({ role: "security", reason: securityReasons.join(", ") });

  if (asset.processesPersonalData || asset.permissions.includes("pii.access")) {
    result.push({ role: "privacy", reason: "Verarbeitung personenbezogener Daten (DSGVO, ggf. DSFA/AVV)" });
  }

  if ((asset.monthlyBudgetUsd ?? 0) >= settings.financeApprovalThresholdUsd) {
    result.push({
      role: "finance",
      reason: `Monatsbudget ≥ ${settings.financeApprovalThresholdUsd.toLocaleString("de-DE")} USD`,
    });
  }
  return result;
}

/**
 * Fields whose change on an already approved asset invalidates the approval.
 * Cosmetic edits (description, tags, …) don't trigger a new round.
 */
export const RISK_RELEVANT_FIELDS: (keyof Asset)[] = [
  "exposure",
  "dataClassification",
  "processesPersonalData",
  "autonomyLevel",
  "humanInTheLoop",
  "sandboxed",
  "secretsManagement",
  "permissions",
  "monthlyBudgetUsd",
  "mcpEndpoint",
  "mcpTransport",
];

export function riskRelevantChanges(before: Asset, after: Asset): string[] {
  return RISK_RELEVANT_FIELDS.filter((field) => {
    const a = before[field];
    const b = after[field];
    if (Array.isArray(a) && Array.isArray(b)) return [...a].sort().join("|") !== [...b].sort().join("|");
    return a !== b;
  });
}

export type ApprovalState = "complete" | "pending" | "rejected";

export function approvalState(
  required: RequiredApproval[],
  decisions: { role: string; decision: "pending" | "approved" | "rejected" }[],
): ApprovalState {
  if (decisions.some((d) => d.decision === "rejected")) return "rejected";
  const approved = new Set(decisions.filter((d) => d.decision === "approved").map((d) => d.role));
  return required.every((r) => approved.has(r.role)) ? "complete" : "pending";
}
