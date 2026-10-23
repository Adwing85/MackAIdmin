import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { useAction, useApp } from "../lib/app";
import { Card, ErrorBox, Field, PageHeader } from "../components/ui";

export function AccountPage() {
  const { me, meta, toast } = useApp();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const action = useAction();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await action.run(() => api.post("/auth/password", { currentPassword: current, newPassword: next }));
    if (ok) {
      toast("Passwort geändert");
      setCurrent("");
      setNext("");
      setRepeat("");
    }
  };

  return (
    <>
      <PageHeader title="Mein Konto" />
      <div className="grid grid-2" style={{ alignItems: "start" }}>
        <Card title="Profil">
          <dl className="kv">
            <dt>Name</dt>
            <dd>{me.name}</dd>
            <dt>E-Mail</dt>
            <dd>{me.email}</dd>
            <dt>Rollen</dt>
            <dd>{me.roles.map((r) => meta.roles[r] ?? r).join(", ")}</dd>
          </dl>
        </Card>
        {!me.ssoProxy && (
          <Card title="Passwort ändern">
            <form className="stack" onSubmit={submit}>
              <Field label="Aktuelles Passwort">
                <input
                  type="password"
                  autoComplete="current-password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  required
                />
              </Field>
              <Field label="Neues Passwort" hint="Mindestens 10 Zeichen">
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={10}
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  required
                />
              </Field>
              <Field label="Neues Passwort wiederholen">
                <input
                  type="password"
                  autoComplete="new-password"
                  value={repeat}
                  onChange={(e) => setRepeat(e.target.value)}
                  required
                />
              </Field>
              {repeat && next !== repeat && (
                <div className="small" style={{ color: "var(--critical-text)" }}>
                  Die Passwörter stimmen nicht überein.
                </div>
              )}
              <ErrorBox error={action.error} />
              <div>
                <button className="btn btn-primary" type="submit" disabled={action.busy || next.length < 10 || next !== repeat}>
                  Passwort ändern
                </button>
              </div>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
