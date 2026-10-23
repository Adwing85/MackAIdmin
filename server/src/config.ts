import { join } from "node:path";

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
}

const bool = (v: string | undefined, fallback: boolean) =>
  v === undefined ? fallback : ["1", "true", "yes"].includes(v.toLowerCase());

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
  };
}
