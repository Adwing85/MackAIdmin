import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError, onUnauthorized } from "./api";
import type { Me, Meta } from "./types";

interface AppState {
  me: Me;
  meta: Meta;
  hasRole: (...roles: string[]) => boolean;
  logout: () => Promise<void>;
  toast: (message: string) => void;
  counts: { approvals: number; discovery: number; critical: number };
  refreshCounts: () => void;
}

const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp outside of AppProvider");
  return ctx;
}

export function AppProvider({ me, meta, onLogout, children }: { me: Me; meta: Meta; onLogout: () => void; children: ReactNode }) {
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const timer = useRef<number>();
  const [counts, setCounts] = useState({ approvals: 0, discovery: 0, critical: 0 });

  const refreshCounts = useCallback(() => {
    api
      .get<{
        approvals: { pendingForMe: number };
        discovery: { new: number };
        findings: { openBySeverity: { critical: number } };
      }>("/dashboard")
      .then((d) =>
        setCounts({
          approvals: d.approvals.pendingForMe,
          discovery: d.discovery.new,
          critical: d.findings.openBySeverity.critical,
        }),
      )
      .catch(() => undefined);
  }, []);
  useEffect(refreshCounts, [refreshCounts]);

  const toast = useCallback((message: string) => {
    setToastMsg(message);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToastMsg(null), 3500);
  }, []);

  const hasRole = useCallback(
    (...roles: string[]) => me.roles.includes("admin") || roles.some((r) => me.roles.includes(r)),
    [me],
  );

  const logout = useCallback(async () => {
    await api.post("/auth/logout").catch(() => undefined);
    onLogout();
  }, [onLogout]);

  return (
    <AppContext.Provider value={{ me, meta, hasRole, logout, toast, counts, refreshCounts }}>
      {children}
      {toastMsg && (
        <div className="toast" role="status">
          {toastMsg}
        </div>
      )}
    </AppContext.Provider>
  );
}

/** Loads a GET endpoint; `reload` refetches while keeping the previous data on screen. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setLoading(true);
    api
      .get<T>(path)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof ApiError ? e : new ApiError(0, String(e)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error, loading, reload, setData };
}

export function useDebounced<T>(value: T, ms = 400): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useUnauthorized(handler: () => void) {
  useEffect(() => {
    const unsubscribe = onUnauthorized(handler);
    return () => {
      unsubscribe();
    };
  }, [handler]);
}

/** Wraps an async action with busy state and error capture for forms and buttons. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, String(e)));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, setError };
}

const THEME_KEY = "mackaidmin-theme";
export function getStoredTheme(): "light" | "dark" | null {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}
export function applyTheme(theme: "light" | "dark" | null) {
  if (theme) document.documentElement.setAttribute("data-theme", theme);
  else document.documentElement.removeAttribute("data-theme");
  try {
    if (theme) localStorage.setItem(THEME_KEY, theme);
    else localStorage.removeItem(THEME_KEY);
  } catch {
    /* storage unavailable – theme just isn't remembered */
  }
}
