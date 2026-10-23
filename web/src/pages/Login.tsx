import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { useAction } from "../lib/app";
import { ErrorBox, Field } from "../components/ui";

export function LoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, run } = useAction();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await run(() => api.post("/auth/login", { email, password }));
    if (ok) onLoggedIn();
  };

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
        <ErrorBox error={error} />
        <Field label="E-Mail" htmlFor="email">
          <input
            id="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
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
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "Anmelden …" : "Anmelden"}
        </button>
      </form>
    </div>
  );
}
