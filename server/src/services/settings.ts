import { get, parseJson, run, type DB } from "../db/database.js";
import { DEFAULT_CLAUDE_CODE_POLICY, type ClaudeCodePolicy } from "../domain/policy.js";
import { DEFAULT_GOVERNANCE, type GovernanceSettings } from "../domain/types.js";

function read<T extends object>(db: DB, key: string, defaults: T): T {
  const row = get<{ value: string }>(db, "SELECT value FROM settings WHERE key = :k", { k: key });
  return { ...defaults, ...parseJson<Partial<T>>(row?.value, {}) };
}

function write(db: DB, key: string, value: unknown): void {
  run(db, "INSERT INTO settings (key, value) VALUES (:k, :v) ON CONFLICT(key) DO UPDATE SET value = excluded.value", {
    k: key,
    v: JSON.stringify(value),
  });
}

export const getGovernance = (db: DB): GovernanceSettings => read(db, "governance", DEFAULT_GOVERNANCE);
export const setGovernance = (db: DB, value: GovernanceSettings) => write(db, "governance", value);

export const getClaudeCodePolicy = (db: DB): ClaudeCodePolicy => read(db, "claude_code_policy", DEFAULT_CLAUDE_CODE_POLICY);
export const setClaudeCodePolicy = (db: DB, value: ClaudeCodePolicy) => write(db, "claude_code_policy", value);

export interface IntegrationSettings {
  /** Asset key that Claude Code usage synced from the Admin API is attributed to. */
  claudeCodeAssetKey: string | null;
  lastClaudeCodeSyncAt: string | null;
  lastClaudeCodeSyncResult: string | null;
}
const DEFAULT_INTEGRATIONS: IntegrationSettings = {
  claudeCodeAssetKey: "claude-code",
  lastClaudeCodeSyncAt: null,
  lastClaudeCodeSyncResult: null,
};
export const getIntegrations = (db: DB): IntegrationSettings => read(db, "integrations", DEFAULT_INTEGRATIONS);
export const setIntegrations = (db: DB, value: IntegrationSettings) => write(db, "integrations", value);
