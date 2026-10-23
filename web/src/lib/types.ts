export type Severity = "critical" | "high" | "medium" | "low";
export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface Meta {
  assetTypes: Record<string, string>;
  assetStatuses: Record<string, string>;
  dataClassifications: Record<string, string>;
  exposures: Record<string, string>;
  autonomyLevels: Record<string, string>;
  secretsManagement: Record<string, string>;
  mcpTransports: Record<string, string>;
  permissions: Record<string, { label: string; category: string; weight: number; writes: boolean }>;
  roles: Record<string, string>;
  approverRoles: string[];
  severities: Record<Severity, string>;
  riskLevels: Record<RiskLevel, string>;
  discoveryKinds: Record<string, string>;
  tokenScopes: Record<string, string>;
  rules: { id: string; severity: Severity; category: string; title: string; recommendation: string }[];
}

export interface Me {
  id: number;
  email: string;
  name: string;
  roles: string[];
  teamId: number | null;
  ssoProxy: boolean;
  entraLinked: boolean;
  hasPassword: boolean;
}

export interface AssetSummary {
  id: number;
  key: string;
  name: string;
  type: string;
  status: string;
  description: string;
  capabilities: string[];
  tags: string[];
  exposure: string;
  models: string[];
  owner: { id: number; name: string; email: string; active: boolean } | null;
  team: { id: number; name: string } | null;
  riskScore: number;
  riskLevel: RiskLevel;
  approvalState: "complete" | "pending" | "rejected";
  openFindings: number;
  worstOpenSeverity: Severity | null;
  mtdCostUsd: number;
  monthlyBudgetUsd: number | null;
  updatedAt: string;
}

export interface Asset {
  id: number;
  key: string;
  name: string;
  type: string;
  description: string;
  purpose: string;
  status: string;
  ownerId: number | null;
  teamId: number | null;
  repositoryUrl: string | null;
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
  permissions: string[];
  dependencies: number[];
  mcpTransport: string | null;
  mcpEndpoint: string | null;
  monthlyBudgetUsd: number | null;
  lastReviewAt: string | null;
  reviewIntervalDays: number | null;
  approvalRound: number;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Finding {
  ruleId: string;
  severity: Severity;
  category: string;
  title: string;
  detail: string;
  recommendation: string;
  acceptance: {
    id: number;
    justification: string;
    acceptedByName: string | null;
    acceptedAt: string;
    expiresAt: string;
  } | null;
}

export interface Approval {
  id: number;
  assetId: number;
  round: number;
  role: string;
  reason: string;
  decision: "pending" | "approved" | "rejected";
  comment: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface RiskAssessment {
  score: number;
  level: RiskLevel;
  factors: { label: string; points: number }[];
}

export interface SimilarAsset {
  id: number;
  key: string;
  name: string;
  type: string;
  status: string;
  score: number;
  sharedCapabilities: string[];
  sharedTerms: string[];
}

export interface AuditEntry {
  id: number;
  at: string;
  actorLabel: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  changes: unknown;
}

export interface BriefAsset {
  id: number;
  key: string;
  name: string;
  type: string;
  status: string;
}

export interface AssetDetail {
  asset: Asset;
  owner: AssetSummary["owner"];
  team: AssetSummary["team"];
  risk: RiskAssessment;
  requiredApprovals: { role: string; reason: string }[];
  approvals: Approval[];
  approvalState: "complete" | "pending" | "rejected";
  findings: Finding[];
  openFindings: number;
  mtdCostUsd: number;
  forecastUsd: number;
  permissionJustifications: Record<string, string>;
  dependencies: BriefAsset[];
  dependents: BriefAsset[];
  transitions: { to: string; label: string }[];
  canEdit: boolean;
  canReview: boolean;
  usage: { date: string; costUsd: number; tokens: number }[];
  similar: SimilarAsset[];
  discoveries: { id: number; repoUrl: string; path: string; kind: string; lastSeenAt: string }[];
  history: AuditEntry[];
}

export interface Person {
  id: number;
  email: string;
  name: string;
  roles: string[];
  teamId: number | null;
  teamName: string | null;
  active: boolean;
  lastLoginAt: string | null;
  hasPassword: boolean;
  entraLinked: boolean;
}

export interface Team {
  id: number;
  name: string;
  costCenter: string | null;
  monthlyBudgetUsd: number | null;
  members: number;
  assets: number;
}
