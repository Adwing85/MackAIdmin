// Central catalogs (enums + German labels). The web UI fetches these via /api/meta,
// so labels live in exactly one place.

export const ASSET_TYPES = {
  application: "Anwendung",
  agent: "KI-Agent",
  mcp_server: "MCP-Server",
  skill: "Skill / Plugin",
  automation: "Automatisierung / Skript",
  integration: "Integration / API-Anbindung",
  ci_agent: "CI/CD-Agent (z. B. GitHub Action)",
  library: "Bibliothek / Prompt-Baustein",
} as const;
export type AssetType = keyof typeof ASSET_TYPES;

export const ASSET_STATUSES = {
  draft: "Entwurf",
  in_review: "In Prüfung",
  approved: "Freigegeben",
  active: "Im Betrieb",
  rejected: "Abgelehnt",
  deprecated: "Abgekündigt",
  retired: "Stillgelegt",
} as const;
export type AssetStatus = keyof typeof ASSET_STATUSES;

/** Statuses in which an asset consumes resources / is "live" for governance purposes. */
export const LIVE_STATUSES: AssetStatus[] = ["approved", "active", "deprecated"];

export const DATA_CLASSIFICATIONS = {
  public: "Öffentlich",
  internal: "Intern",
  confidential: "Vertraulich",
  strictly_confidential: "Streng vertraulich",
} as const;
export type DataClassification = keyof typeof DATA_CLASSIFICATIONS;

export const EXPOSURES = {
  local: "Nur lokal (Entwickler-Rechner)",
  internal: "Internes Netz",
  partner: "Partner / Kunden (authentifiziert)",
  public: "Öffentlich im Internet",
} as const;
export type Exposure = keyof typeof EXPOSURES;

export const AUTONOMY_LEVELS = {
  0: "L0 – Nur Vorschläge",
  1: "L1 – Mensch bestätigt jede Aktion",
  2: "L2 – Autonom mit Leitplanken",
  3: "L3 – Vollautonom",
} as const;
export type AutonomyLevel = 0 | 1 | 2 | 3;

export const SECRETS_MANAGEMENT = {
  none: "Keine Secrets nötig",
  vault: "Secret-Store / Vault",
  env: "Umgebungsvariablen",
  plaintext: "Klartext in Code/Konfiguration",
} as const;
export type SecretsManagement = keyof typeof SECRETS_MANAGEMENT;

export const MCP_TRANSPORTS = {
  http: "HTTP (Streamable)",
  sse: "SSE",
  stdio: "stdio (lokaler Prozess)",
} as const;
export type McpTransport = keyof typeof MCP_TRANSPORTS;

export interface PermissionDef {
  label: string;
  category: "Dateisystem" | "Ausführung" | "Netzwerk" | "Code & Repos" | "Daten" | "Produktion" | "Identität & Geld";
  /** 1 (harmless) .. 5 (very dangerous) */
  weight: number;
  /** Permissions that change state (relevant for human-in-the-loop checks). */
  writes: boolean;
}

export const PERMISSIONS = {
  "fs.read": { label: "Dateisystem lesen", category: "Dateisystem", weight: 1, writes: false },
  "fs.write": { label: "Dateisystem schreiben", category: "Dateisystem", weight: 2, writes: true },
  "shell.exec": { label: "Shell-Befehle ausführen", category: "Ausführung", weight: 3, writes: true },
  "code.untrusted": { label: "Fremden Code / Pakete ausführen", category: "Ausführung", weight: 3, writes: true },
  "net.outbound": { label: "Ausgehender Internetzugriff", category: "Netzwerk", weight: 2, writes: false },
  "net.inbound": { label: "Eingehende Verbindungen (Endpunkt)", category: "Netzwerk", weight: 3, writes: false },
  "external.api": { label: "Externe SaaS-APIs aufrufen", category: "Netzwerk", weight: 2, writes: false },
  "vcs.read": { label: "Repositories lesen", category: "Code & Repos", weight: 1, writes: false },
  "vcs.write": { label: "Commits / Pushes / Pull Requests", category: "Code & Repos", weight: 2, writes: true },
  "vcs.admin": { label: "Repo-Administration (Branch-Schutz, Secrets)", category: "Code & Repos", weight: 4, writes: true },
  "db.read": { label: "Datenbanken lesen", category: "Daten", weight: 2, writes: false },
  "db.write": { label: "Datenbanken schreiben", category: "Daten", weight: 3, writes: true },
  "pii.access": { label: "Zugriff auf personenbezogene Daten", category: "Daten", weight: 3, writes: false },
  "secrets.read": { label: "Zugriff auf Secrets / Credentials", category: "Daten", weight: 4, writes: false },
  "prod.deploy": { label: "Deployments in Produktion", category: "Produktion", weight: 4, writes: true },
  "prod.write": { label: "Schreibzugriff auf Produktivsysteme", category: "Produktion", weight: 4, writes: true },
  "email.send": { label: "E-Mails / Nachrichten versenden", category: "Identität & Geld", weight: 2, writes: true },
  "iam.manage": { label: "Benutzer & Berechtigungen verwalten", category: "Identität & Geld", weight: 5, writes: true },
  payments: { label: "Zahlungen / Finanztransaktionen", category: "Identität & Geld", weight: 5, writes: true },
} as const satisfies Record<string, PermissionDef>;
export type PermissionKey = keyof typeof PERMISSIONS;

export const HIGH_IMPACT_WRITE_PERMISSIONS: PermissionKey[] = [
  "prod.write",
  "prod.deploy",
  "db.write",
  "payments",
  "iam.manage",
  "vcs.admin",
];

export const ROLES = {
  admin: "Administrator",
  team_lead: "Teamleitung",
  architecture: "Architektur",
  security: "IT-Sicherheit",
  privacy: "Datenschutz",
  finance: "Finanzen / Controlling",
  developer: "Entwickler:in",
  viewer: "Lesezugriff",
} as const;
export type Role = keyof typeof ROLES;

/** Roles that can be asked for an approval. */
export const APPROVER_ROLES = ["team_lead", "architecture", "security", "privacy", "finance"] as const;
export type ApproverRole = (typeof APPROVER_ROLES)[number];

export const SEVERITIES = {
  critical: "Kritisch",
  high: "Hoch",
  medium: "Mittel",
  low: "Niedrig",
} as const;
export type Severity = keyof typeof SEVERITIES;

export const RISK_LEVELS = {
  low: "Niedrig",
  medium: "Mittel",
  high: "Hoch",
  critical: "Kritisch",
} as const;
export type RiskLevel = keyof typeof RISK_LEVELS;

export const DISCOVERY_KINDS = {
  claude_md: "CLAUDE.md (Projektkontext)",
  claude_settings: "Claude-Code-Einstellungen (.claude/settings.json)",
  mcp_config: "MCP-Konfiguration (.mcp.json)",
  claude_agents: "Subagents (.claude/agents)",
  claude_skills: "Skills / Commands (.claude/skills, .claude/commands)",
  claude_hooks: "Hooks in Claude-Code-Einstellungen",
  anthropic_sdk: "Anthropic SDK im Code",
  agent_sdk: "Claude Agent SDK im Code",
  ci_claude: "Claude in CI/CD (z. B. GitHub Action)",
} as const;
export type DiscoveryKind = keyof typeof DISCOVERY_KINDS;

export function isKey<T extends object>(obj: T, key: unknown): key is keyof T {
  return typeof key === "string" && Object.prototype.hasOwnProperty.call(obj, key);
}
