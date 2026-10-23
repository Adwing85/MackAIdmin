import { join } from "node:path";
import { ROLES, type Role } from "./domain/catalog.js";

export interface EntraConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /** OIDC issuer, default https://login.microsoftonline.com/<tenant>/v2.0 (override for sovereign clouds). */
  authority: string;
  redirectUri: string;
  /** Roles for people created on their first Entra login when the token carries no app roles. */
  defaultRoles: Role[];
  autoProvision: boolean;
  /** Only for tests against a local plain-HTTP identity provider. */
  allowInsecureRequests?: boolean;
}

export interface Config {
  port: number;
  databasePath: string;
  cookieSecure: boolean;
  sessionTtlHours: number;
  authProxyHeader: string | null;
  anthropicAdminKey: string | null;
  anthropicApiBase: string;
  adminEmail: string | null;
  adminPassword: string | null;
  seedDemo: boolean;
  staticDir: string | null;
  /** Password login; can be switched off once Entra ID is the only way in. */
  localLoginEnabled: boolean;
  entra: EntraConfig | null;
}

const bool = (v: string | undefined, fallback: boolean) =>
  v === undefined ? fallback : ["1", "true", "yes"].includes(v.toLowerCase());

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function loadEntraConfig(env: NodeJS.ProcessEnv): EntraConfig | null {
  const tenantId = env.ENTRA_TENANT_ID?.trim();
  const clientId = env.ENTRA_CLIENT_ID?.trim();
  const clientSecret = env.ENTRA_CLIENT_SECRET;
  if (!tenantId && !clientId && !clientSecret) return null;
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("Entra ID: ENTRA_TENANT_ID, ENTRA_CLIENT_ID und ENTRA_CLIENT_SECRET müssen gemeinsam gesetzt werden.");
  }
  // Only a tenant GUID pins the issuer to one organisation ("common"/"organizations" would admit any tenant).
  if (!GUID.test(tenantId)) throw new Error("Entra ID: ENTRA_TENANT_ID muss die Verzeichnis-ID (GUID) des Mandanten sein.");
  const publicUrl = env.PUBLIC_URL?.trim().replace(/\/+$/, "");
  const redirectUri = env.ENTRA_REDIRECT_URI?.trim() || (publicUrl ? `${publicUrl}/api/auth/entra/callback` : "");
  if (!redirectUri) {
    throw new Error("Entra ID: PUBLIC_URL (z. B. https://mackaidmin.firma.de) oder ENTRA_REDIRECT_URI setzen.");
  }
  const defaultRoles = (env.ENTRA_DEFAULT_ROLES ?? "viewer")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  const unknown = defaultRoles.filter((r) => !(r in ROLES));
  if (unknown.length || !defaultRoles.length) {
    throw new Error(`Entra ID: ENTRA_DEFAULT_ROLES enthält unbekannte Rollen: ${unknown.join(", ") || "(leer)"}`);
  }
  return {
    tenantId,
    clientId,
    clientSecret,
    authority: env.ENTRA_AUTHORITY?.trim() || `https://login.microsoftonline.com/${tenantId}/v2.0`,
    redirectUri,
    defaultRoles: defaultRoles as Role[],
    autoProvision: bool(env.ENTRA_AUTO_PROVISION, true),
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 8080),
    databasePath: env.DATABASE_PATH ?? join(process.cwd(), "data", "mackaidmin.db"),
    cookieSecure: bool(env.COOKIE_SECURE, env.NODE_ENV === "production"),
    sessionTtlHours: Number(env.SESSION_TTL_HOURS ?? 12),
    authProxyHeader: env.AUTH_PROXY_HEADER?.toLowerCase() || null,
    anthropicAdminKey: env.ANTHROPIC_ADMIN_KEY || null,
    anthropicApiBase: env.ANTHROPIC_API_BASE ?? "https://api.anthropic.com",
    adminEmail: env.ADMIN_EMAIL || null,
    adminPassword: env.ADMIN_PASSWORD || null,
    seedDemo: bool(env.SEED_DEMO, false),
    staticDir: env.STATIC_DIR ?? null,
    localLoginEnabled: bool(env.LOCAL_LOGIN, true),
    entra: loadEntraConfig(env),
  };
}
