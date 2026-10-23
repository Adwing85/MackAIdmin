import { useState } from "react";
import { Link } from "react-router-dom";
import { useApi, useDebounced } from "../lib/app";
import { fmtDateTime } from "../lib/format";
import type { AuditEntry } from "../lib/types";
import { Card, ErrorBox, Loading, PageHeader } from "../components/ui";

const ENTITY_LABELS: Record<string, string> = {
  asset: "Asset",
  person: "Person",
  team: "Team",
  token: "API-Token",
  settings: "Einstellungen",
  usage: "Verbrauch",
  discovery: "Discovery",
  license: "Lizenz",
  system: "System",
};

const PAGE = 100;

export function AuditPage() {
  const [q, setQ] = useState("");
  const [entityType, setEntityType] = useState("");
  const [offset, setOffset] = useState(0);
  const debounced = useDebounced(q, 300);
  const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
  if (debounced) params.set("q", debounced);
  if (entityType) params.set("entityType", entityType);
  const { data, error } = useApi<{ items: AuditEntry[]; total: number }>(`/audit?${params.toString()}`);

  return (
    <>
      <PageHeader
        title="Audit-Log"
        description="Lückenloses Protokoll aller Änderungen, Freigaben, Risikoakzeptanzen und Synchronisationen – Nachweis für Revision, ISO 27001 und EU AI Act."
      />
      <div className="filters">
        <input
          type="search"
          placeholder="Suche in Zusammenfassung oder Akteur …"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOffset(0);
          }}
        />
        <select
          value={entityType}
          onChange={(e) => {
            setEntityType(e.target.value);
            setOffset(0);
          }}
          aria-label="Objekttyp"
        >
          <option value="">Alle Objekte</option>
          {Object.entries(ENTITY_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <ErrorBox error={error} />
      <Card flush>
        {!data ? (
          <Loading />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Zeitpunkt</th>
                  <th>Akteur</th>
                  <th>Ereignis</th>
                  <th>Objekt</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((e) => (
                  <tr key={e.id}>
                    <td className="nowrap small">{fmtDateTime(e.at)}</td>
                    <td className="small">{e.actorLabel}</td>
                    <td>
                      <div>{e.summary}</div>
                      <div className="cell-sub mono">{e.action}</div>
                      {e.changes != null && (
                        <details>
                          <summary className="small muted" style={{ cursor: "pointer" }}>
                            Details
                          </summary>
                          <pre className="code-block small">{JSON.stringify(e.changes, null, 2)}</pre>
                        </details>
                      )}
                    </td>
                    <td className="small nowrap">
                      {e.entityType === "asset" && e.entityId ? (
                        <Link to={`/inventar/${e.entityId}`}>Asset #{e.entityId}</Link>
                      ) : (
                        `${ENTITY_LABELS[e.entityType] ?? e.entityType}${e.entityId ? ` #${e.entityId}` : ""}`
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.items.length === 0 && <div className="empty">Keine Einträge.</div>}
          </div>
        )}
      </Card>
      {data && data.total > PAGE && (
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn btn-sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
            Zurück
          </button>
          <span className="small muted">
            {offset + 1}–{Math.min(offset + PAGE, data.total)} von {data.total}
          </span>
          <button className="btn btn-sm" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>
            Weiter
          </button>
        </div>
      )}
    </>
  );
}
