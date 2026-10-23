// Generates the Claude Code `managed-settings.json` from the central inventory and policy.
// The platform thereby becomes the single source of truth for what developer machines enforce:
// only MCP servers approved here are allowed, rejected/retired ones are explicitly denied.
// Format reference: https://code.claude.com/docs/en/managed-settings and /docs/en/managed-mcp

import type { McpTransport } from "./catalog.js";

export interface ClaudeCodePolicy {
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

export const DEFAULT_CLAUDE_CODE_POLICY: ClaudeCodePolicy = {
  allowRules: [],
  askRules: ["Bash(git push *)"],
  denyRules: [
    "Read(./.env)",
    "Read(./.env.*)",
    "Read(./secrets/**)",
    "Read(~/.ssh/**)",
    "Read(~/.aws/**)",
    "Bash(curl *)",
    "Bash(wget *)",
  ],
  disableBypassPermissions: true,
  allowManagedPermissionRulesOnly: false,
  allowManagedHooksOnly: false,
  allowManagedMcpServersOnly: true,
  availableModels: [],
  sandboxEnabled: false,
  sandboxAllowedDomains: ["registry.npmjs.org", "pypi.org", "github.com"],
  sandboxAllowManagedDomainsOnly: false,
  cleanupPeriodDays: 30,
  requiredMinimumVersion: null,
  forceLoginMethod: null,
  forceLoginOrgUUID: null,
  companyAnnouncements: [
    "Claude Code wird zentral über MackAIdmin verwaltet. Neue Agents, Apps und MCP-Server bitte dort registrieren.",
  ],
  telemetryEnabled: false,
  otlpEndpoint: null,
};

export interface McpServerRecord {
  key: string;
  name: string;
  status: string;
  transport: McpTransport | null;
  endpoint: string | null;
}

export type McpMatcher = { serverUrl: string } | { serverCommand: string[] };

/** Splits a command line into argv, honouring single and double quotes. */
export function splitCommandLine(cmd: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let hasToken = false;
  for (const ch of cmd.trim()) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      hasToken = true;
    } else if (/\s/.test(ch)) {
      if (hasToken) args.push(current);
      current = "";
      hasToken = false;
    } else {
      current += ch;
      hasToken = true;
    }
  }
  if (hasToken) args.push(current);
  return args;
}

export function mcpMatcher(server: McpServerRecord): McpMatcher | null {
  const endpoint = server.endpoint?.trim();
  if (!endpoint || !server.transport) return null;
  if (server.transport === "stdio") {
    const argv = splitCommandLine(endpoint);
    return argv.length ? { serverCommand: argv } : null;
  }
  return /^(https?|\*):\/\//.test(endpoint) ? { serverUrl: endpoint } : null;
}

export interface GeneratedPolicy {
  settings: Record<string, unknown>;
  warnings: string[];
  allowedServers: string[];
  deniedServers: string[];
}

const ALLOWED_MCP_STATUSES = ["approved", "active", "deprecated"];
const DENIED_MCP_STATUSES = ["rejected", "retired"];

export function buildManagedSettings(policy: ClaudeCodePolicy, mcpServers: McpServerRecord[]): GeneratedPolicy {
  const warnings: string[] = [];
  const allowed: McpMatcher[] = [];
  const denied: McpMatcher[] = [];
  const allowedServers: string[] = [];
  const deniedServers: string[] = [];

  for (const server of mcpServers) {
    const matcher = mcpMatcher(server);
    const isAllowed = ALLOWED_MCP_STATUSES.includes(server.status);
    const isDenied = DENIED_MCP_STATUSES.includes(server.status);
    if (!isAllowed && !isDenied) continue;
    if (!matcher) {
      warnings.push(
        `MCP-Server „${server.name}“ hat keinen gültigen Endpunkt (URL bzw. Startbefehl) und kann nicht in die Policy übernommen werden.`,
      );
      continue;
    }
    if (isAllowed) {
      allowed.push(matcher);
      allowedServers.push(server.name);
    } else {
      denied.push(matcher);
      deniedServers.push(server.name);
    }
  }

  if (policy.allowManagedMcpServersOnly && allowed.length === 0) {
    warnings.push(
      "Keine freigegebenen MCP-Server: Mit „Nur verwaltete MCP-Server“ sind damit alle MCP-Server auf den Entwickler-Rechnern blockiert.",
    );
  }
  if (!policy.disableBypassPermissions) {
    warnings.push("Der Bypass-Modus („--dangerously-skip-permissions“) ist erlaubt. Für Unternehmensgeräte nicht empfohlen.");
  }

  const permissions: Record<string, unknown> = {};
  if (policy.allowRules.length) permissions.allow = policy.allowRules;
  if (policy.askRules.length) permissions.ask = policy.askRules;
  if (policy.denyRules.length) permissions.deny = policy.denyRules;
  if (policy.disableBypassPermissions) permissions.disableBypassPermissionsMode = "disable";

  const settings: Record<string, unknown> = {
    $schema: "https://json.schemastore.org/claude-code-settings.json",
  };
  if (policy.forceLoginMethod) settings.forceLoginMethod = policy.forceLoginMethod;
  if (policy.forceLoginOrgUUID) settings.forceLoginOrgUUID = [policy.forceLoginOrgUUID];
  if (policy.availableModels.length) {
    settings.availableModels = policy.availableModels;
    settings.enforceAvailableModels = true;
  }
  if (Object.keys(permissions).length) settings.permissions = permissions;
  if (policy.allowManagedPermissionRulesOnly) settings.allowManagedPermissionRulesOnly = true;
  if (policy.allowManagedHooksOnly) settings.allowManagedHooksOnly = true;

  settings.allowedMcpServers = allowed;
  if (denied.length) settings.deniedMcpServers = denied;
  if (policy.allowManagedMcpServersOnly) settings.allowManagedMcpServersOnly = true;

  if (policy.sandboxEnabled) {
    settings.sandbox = {
      enabled: true,
      network: {
        allowedDomains: policy.sandboxAllowedDomains,
        ...(policy.sandboxAllowManagedDomainsOnly ? { allowManagedDomainsOnly: true } : {}),
      },
    };
  }
  if (policy.telemetryEnabled && policy.otlpEndpoint) {
    settings.env = {
      CLAUDE_CODE_ENABLE_TELEMETRY: "1",
      OTEL_METRICS_EXPORTER: "otlp",
      OTEL_LOGS_EXPORTER: "otlp",
      OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
      OTEL_EXPORTER_OTLP_ENDPOINT: policy.otlpEndpoint,
    };
  }
  if (policy.requiredMinimumVersion) settings.requiredMinimumVersion = policy.requiredMinimumVersion;
  if (policy.cleanupPeriodDays) settings.cleanupPeriodDays = policy.cleanupPeriodDays;
  if (policy.companyAnnouncements.length) settings.companyAnnouncements = policy.companyAnnouncements;

  return { settings, warnings, allowedServers, deniedServers };
}

export const MANAGED_SETTINGS_PATHS = {
  macOS: "/Library/Application Support/ClaudeCode/managed-settings.json",
  "Linux / WSL": "/etc/claude-code/managed-settings.json",
  Windows: "C:\\Program Files\\ClaudeCode\\managed-settings.json",
};
