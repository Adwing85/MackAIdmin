import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { useAction } from "../lib/app";
import { ErrorBox, Field } from "../components/ui";

interface AuthConfig {
  localLogin: boolean;
  entra: { label: string } | null;
}

/** An error the Entra callback redirected back with (`?loginError=…`). */
const readLoginError = () => new URLSearchParams(window.location.search).get("loginError");

function MicrosoftLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

export function LoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null);
  const [ssoError] = useState(readLoginError);
  const { busy, error, run } = useAction();

  useEffect(() => {
    // Drop the error from the address bar so a reload or the post-login return target stays clean.
    const params = new URLSearchParams(window.location.search);
    if (params.has("loginError")) {
      params.delete("loginError");
      const rest = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}`);
    }
  }, []);

  useEffect(() => {
    api
      .get<AuthConfig>("/auth/config")
      .then(setAuthConfig)
      .catch(() => setAuthConfig({ localLogin: true, entra: null }));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await run(() => api.post("/auth/login", { email, password }));
    if (ok) onLoggedIn();
  };

  const returnParams = new URLSearchParams(window.location.search);
  returnParams.delete("loginError");
  const returnQuery = returnParams.toString();
  const returnTo = `${window.location.pathname}${returnQuery ? `?${returnQuery}` : ""}`;
  const entraHref = `/api/auth/entra/login?returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <div className="login-page">
      <form className="card login-card stack" onSubmit={submit}>
        <div className="brand" style={{ padding: 0 }}>
          <span className="brand-mark" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 32 32">
              <path
                d="M7 24V9l9 9 9-9v15"
                stroke="white"
                strokeWidth="3.4"
                fill="none"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </svg>
          </span>
          MackAIdmin
        </div>
        <p className="secondary" style={{ margin: 0 }}>
          Governance für Claude Code, KI-Agenten, Apps und MCP-Server.
        </p>
        <ErrorBox error={ssoError ? new ApiError(401, ssoError) : error} />
        {authConfig?.entra && (
          <a className="btn btn-sso" href={entraHref}>
            <MicrosoftLogo />
            {authConfig.entra.label}
          </a>
        )}
        {authConfig?.entra && authConfig.localLogin && <div className="divider">oder mit Passwort</div>}
        {authConfig?.localLogin && (
          <>
            <Field label="E-Mail" htmlFor="email">
              <input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus={!authConfig.entra}
              />
            </Field>
            <Field label="Passwort" htmlFor="password">
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
            <button className={`btn ${authConfig.entra ? "" : "btn-primary"}`} type="submit" disabled={busy}>
              {busy ? "Anmelden …" : "Anmelden"}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
