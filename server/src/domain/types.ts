import type {
  AssetStatus,
  AssetType,
  AutonomyLevel,
  DataClassification,
  Exposure,
  McpTransport,
  PermissionKey,
  SecretsManagement,
} from "./catalog.js";

export interface Asset {
  id: number;
  key: string;
  name: string;
  type: AssetType;
  description: string;
  purpose: string;
  status: AssetStatus;
  ownerId: number | null;
  teamId: number | null;
  repositoryUrl: string | null;
  environments: string[];
  dataClassification: DataClassification;
  processesPersonalData: boolean;
  exposure: Exposure;
  autonomyLevel: AutonomyLevel;
  humanInTheLoop: boolean;
  sandboxed: boolean;
  secretsManagement: SecretsManagement;
  models: string[];
  capabilities: string[];
  tags: string[];
  permissions: PermissionKey[];
  /** Ids of assets this asset uses (e.g. MCP servers, other agents). */
  dependencies: number[];
  mcpTransport: McpTransport | null;
  /** URL for remote MCP servers, command line for stdio servers. */
  mcpEndpoint: string | null;
  monthlyBudgetUsd: number | null;
  lastReviewAt: string | null;
  reviewIntervalDays: number | null;
  /** Incremented whenever a risk-relevant change requires a new approval round. */
  approvalRound: number;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

/** The subset of fields that influence risk; used for live previews of unsaved drafts. */
export type RiskInput = Pick<
  Asset,
  | "type"
  | "exposure"
  | "dataClassification"
  | "processesPersonalData"
  | "autonomyLevel"
  | "humanInTheLoop"
  | "sandboxed"
  | "secretsManagement"
  | "permissions"
>;

export interface GovernanceSettings {
  reviewIntervalDays: number;
  globalMonthlyBudgetUsd: number;
  budgetAlertPercent: number;
  financeApprovalThresholdUsd: number;
  inactiveSeatDays: number;
  redundancyThreshold: number;
  allowedModels: string[];
}

export const DEFAULT_GOVERNANCE: GovernanceSettings = {
  reviewIntervalDays: 180,
  globalMonthlyBudgetUsd: 5000,
  budgetAlertPercent: 80,
  financeApprovalThresholdUsd: 1000,
  inactiveSeatDays: 30,
  redundancyThreshold: 0.4,
  allowedModels: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
};
