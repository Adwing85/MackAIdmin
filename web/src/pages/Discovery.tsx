import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAction, useApi, useApp } from "../lib/app";
import { fmtRelative } from "../lib/format";
import type { AssetSummary } from "../lib/types";
import { Badge, Card, ErrorBox, Field, Icon, Loading, Modal, PageHeader, Segmented } from "../components/ui";

interface Discovery {
  id: number;
  repoUrl: string;
  path: string;
  kind: string;
  details: Record<string, unknown>;
  source: string;
  status: "new" | "linked" | "ignored";
  assetId: number | null;
  assetName: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  unapprovedMcpServers: string[];
}

type Status = "new" | "linked" | "ignored";

function repoName(url: string): string {
  return (
    url
      .replace(/\.git$/, "")
      .split(/[/:]/)
      .filter(Boolean)
      .slice(-1)[0] ?? url
  );
}

function describe(d: Discovery): string {
  const det = d.details;
  if (d.kind === "mcp_config" && Array.isArray(det.servers)) {
    return `MCP-Server: ${(det.servers as { name: string }[]).map((s) => s.name).join(", ")}`;
  }
  if (typeof det.package === "string") return `Paket ${det.package}${det.files ? ` in ${det.files} Datei(en)` : ""}`;
  if (typeof det.action === "string") return `Action ${det.action}`;
  if (det.bypassPermissions) return "Bypass-Modus / sehr weite Berechtigungen konfiguriert";
  if (Array.isArray(det.permissionsAllow)) return `Erlaubt: ${(det.permissionsAllow as string[]).join(", ")}`;
  return "";
}

export function DiscoveryPage() {
  const { meta, hasRole, toast, refreshCounts } = useApp();
  const [status, setStatus] = useState<Status>("new");
  const { data, error, reload } = useApi<Discovery[]>(`/discovery?status=${status}`);
  const [linking, setLinking] = useState<Discovery | null>(null);
  const action = useAction();
  const canManage = hasRole("architecture", "security");

  const act = async (d: Discovery, what: "ignore" | "reopen") => {
    const ok = await action.run(() => api.post(`/discovery/${d.id}/${what}`, {}));
    if (ok) {
      toast(what === "ignore" ? "Fund ignoriert" : "Fund wieder geöffnet");
      reload();
      refreshCounts();
    }
  };

  return (
    <>
      <PageHeader
        title="Shadow-AI-Discovery"
        description="Der Scanner durchsucht Repositories nach CLAUDE.md, Claude-Code-Einstellungen, MCP-Konfigurationen, Agent-SDK- und Anthropic-SDK-Nutzung sowie Claude in CI. Funde in Repositories registrierter Assets werden automatisch zugeordnet – der Rest ist Shadow-AI."
      />
      <div className="filters">
        <Segmented<Status>
          value={status}
          onChange={setStatus}
          options={[
            { id: "new", label: "Nicht registriert" },
            { id: "linked", label: "Zugeordnet" },
            { id: "ignored", label: "Ignoriert" },
          ]}
        />
      </div>
      <ErrorBox error={error ?? action.error} />
      <div className="grid grid-main-side" style={{ alignItems: "start" }}>
        <Card flush>
          {!data ? (
            <Loading />
          ) : data.length === 0 ? (
            <div className="empty">{status === "new" ? "Keine unregistrierten Funde – sehr gut." : "Keine Einträge."}</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Repository</th>
                    <th>Fund</th>
                    <th>Gesehen</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.map((d) => (
                    <tr key={d.id}>
                      <td style={{ maxWidth: 260 }}>
                        <div className="cell-title">{repoName(d.repoUrl)}</div>
                        <div className="cell-sub mono" style={{ overflowWrap: "anywhere" }}>
                          {d.repoUrl}
                        </div>
                        {d.assetId && (
                          <div className="small" style={{ marginTop: 4 }}>
                            → <Link to={`/inventar/${d.assetId}`}>{d.assetName}</Link>
                          </div>
                        )}
                      </td>
                      <td>
                        <strong>{meta.discoveryKinds[d.kind] ?? d.kind}</strong>
                        <div className="mono small">{d.path}</div>
                        <div className="cell-sub">{describe(d)}</div>
                        {d.unapprovedMcpServers.length > 0 && (
                          <div style={{ marginTop: 4 }}>
                            <Badge dot="serious">nicht freigegeben: {d.unapprovedMcpServers.join(", ")}</Badge>
                          </div>
                        )}
                        {d.kind === "claude_settings" && d.details.bypassPermissions === true && (
                          <div style={{ marginTop: 4 }}>
                            <Badge dot="critical">Bypass-Modus</Badge>
                          </div>
                        )}
                      </td>
                      <td className="small nowrap">
                        {fmtRelative(d.lastSeenAt)}
                        <div className="cell-sub">erstmals {fmtRelative(d.firstSeenAt)}</div>
                      </td>
                      <td className="right">
                        {canManage && (
                          <div className="row" style={{ justifyContent: "flex-end" }}>
                            {d.status === "new" && (
                              <>
                                <Link
                                  className="btn btn-sm btn-primary"
                                  to={`/inventar/neu?repo=${encodeURIComponent(d.repoUrl)}&name=${encodeURIComponent(repoName(d.repoUrl))}`}
                                >
                                  Registrieren
                                </Link>
                                <button className="btn btn-sm" onClick={() => setLinking(d)}>
                                  Zuordnen
                                </button>
                                <button className="btn btn-sm btn-ghost" onClick={() => act(d, "ignore")}>
                                  Ignorieren
                                </button>
                              </>
                            )}
                            {d.status !== "new" && (
                              <button className="btn btn-sm" onClick={() => act(d, "reopen")}>
                                Wieder öffnen
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="Scanner einbinden" subtitle="Lokal, als Cronjob oder in der CI-Pipeline">
          <p className="small secondary mt-0">
            1. Unter <Link to="/organisation">Organisation → API-Tokens</Link> ein Token mit Scope <code>discovery:write</code>{" "}
            erstellen.
            <br />
            2. Scanner auf ein Verzeichnis mit Repository-Checkouts ansetzen:
          </p>
          <pre className="code-block">{`node scripts/mackaidmin-scan.mjs ~/repos \\
  --server ${window.location.origin} \\
  --token $MACKAIDMIN_TOKEN`}</pre>
          <p className="small secondary">
            Mit <code>--dry-run</code> werden die Funde nur angezeigt. Der Scanner liest ausschließlich Metadaten (Pfade,
            Paketnamen, MCP-Server-Namen/URLs) – keine Quelltexte oder Secrets.
          </p>
        </Card>
      </div>
      {linking && (
        <LinkModal
          discovery={linking}
          onClose={() => setLinking(null)}
          onDone={() => {
            setLinking(null);
            toast("Fund zugeordnet");
            reload();
            refreshCounts();
          }}
        />
      )}
    </>
  );
}

function LinkModal({ discovery, onClose, onDone }: { discovery: Discovery; onClose: () => void; onDone: () => void }) {
  const assets = useApi<AssetSummary[]>("/assets").data ?? [];
  const [assetId, setAssetId] = useState(0);
  const action = useAction();
  const save = async () => {
    const ok = await action.run(() => api.post(`/discovery/${discovery.id}/link`, { assetId }));
    if (ok) onDone();
  };
  return (
    <Modal
      title="Fund einem Asset zuordnen"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!assetId || action.busy}>
            Zuordnen
          </button>
        </>
      }
    >
      <div className="stack">
        <p className="mt-0 small">
          <Icon name="radar" /> <span className="mono">{discovery.repoUrl}</span> – {discovery.path}
        </p>
        <Field label="Asset">
          <select value={assetId} onChange={(e) => setAssetId(Number(e.target.value))}>
            <option value={0}>– auswählen –</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <ErrorBox error={action.error} />
      </div>
    </Modal>
  );
}
