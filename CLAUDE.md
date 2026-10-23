# MackAIdmin – Hinweise für Claude Code

Governance-Plattform für Claude Code, KI-Agenten, Apps und MCP-Server. UI-Texte und Doku auf Deutsch, Code und Kommentare auf Englisch.

## Befehle

- `npm install` – Abhängigkeiten (npm workspaces `server`, `web`)
- `npm run dev` – API (Port 8080, tsx watch) + Vite-UI (Port 5173, Proxy auf /api)
- `npm test` – Server-Tests mit `node:test` (Domain, API, Scanner)
- `npm run typecheck` – Server und Web
- `npm run build` – Web nach `web/dist`, Server nach `server/dist`
- `npm run seed:demo` – Demo-Daten in eine leere Datenbank

## Struktur

- `server/src/domain/` – reine Fachlogik ohne I/O (Risiko, Befundregeln, Freigabematrix, Redundanz, Kosten, Policy-Generator). Neue Regeln in `findings.ts` ergänzen und testen.
- `server/src/services/` – Datenbankzugriff und Workflows; `evaluateInventory()` berechnet Befunde immer aus aktuellen Daten.
- `server/src/auth/` – Sessions, Rollenprüfung, API-Tokens; `entra.ts` = Entra-ID-Login (OIDC über `openid-client`), Tests gegen einen lokalen Fake-IdP in `test/entra.test.ts`.
- `server/src/routes/` – REST-API, Validierung mit zod, Rechte über `requireRole`/`requireUserOrScope`, jede Änderung mit `audit()`.
- `server/src/db/migrations/` – SQL-Migrationen, fortlaufend nummeriert; nie bestehende Dateien ändern.
- `web/src/pages/` – eine Datei pro Seite; Labels kommen aus `/api/meta` (`server/src/domain/catalog.ts`).
- `scripts/mackaidmin-scan.mjs` – Shadow-AI-Scanner ohne Abhängigkeiten; darf nie Dateiinhalte, `env`- oder `headers`-Werte übertragen.

## Konventionen

- `node:sqlite` bindet keine Booleans/undefined – immer über die Helfer `run/get/all` aus `db/database.ts` gehen.
- Schreibende Requests müssen `Content-Type: application/json` senden (CSRF-Schutz).
- Personenbezogene Auswertungen nur für die Rollen `finance`/`admin`.
