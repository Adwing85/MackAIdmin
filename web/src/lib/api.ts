export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }

  /** Human-readable list of validation details, if the server sent any. */
  get detailLines(): string[] {
    if (!Array.isArray(this.details)) return [];
    return this.details.map((d) =>
      typeof d === "string"
        ? d
        : d && typeof d === "object" && "message" in d
          ? `${(d as { path?: string }).path ? `${(d as { path: string }).path}: ` : ""}${(d as { message: string }).message}`
          : JSON.stringify(d),
    );
  }
}

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();
export function onUnauthorized(fn: Listener) {
  unauthorizedListeners.add(fn);
  return () => unauthorizedListeners.delete(fn);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    // Mutations always declare JSON – the server's CSRF guard requires it.
    headers:
      method === "GET" ? { accept: "application/json" } : { "content-type": "application/json", accept: "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && path !== "/auth/login") unauthorizedListeners.forEach((fn) => fn());
    throw new ApiError(res.status, data?.error ?? `Fehler ${res.status}`, data?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};
