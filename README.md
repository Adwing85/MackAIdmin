# MackAIdmin

**Governance-Plattform für Claude Code, KI-Agenten, Apps und MCP-Server.**

Sobald Entwickler:innen mit Claude Code arbeiten, entstehen in kurzer Zeit viele neue Werkzeuge: Agents, Automatisierungen, MCP-Server, Skills, kleine Apps. MackAIdmin sorgt dafür, dass daraus kein Wildwuchs wird:

| Risiko | Was MackAIdmin dagegen tut |
| --- | --- |
| **Überblick geht verloren** | Zentrales **Inventar** aller KI-Assets mit Owner, Team, Zweck, Repository, Lebenszyklus und Abhängigkeiten. **Shadow-AI-Scanner** findet nicht registrierte Nutzung in Repositories. |
| **Token- und Lizenzkosten steigen** | **Kosten & Budgets** pro Asset, Team und Unternehmen mit Monatsprognose, Budgetwarnungen und Sync der Claude-Code-Nutzung über die Anthropic Admin API. **Lizenzmanagement** zeigt ungenutzte Seats und Einsparpotenzial. |
| **Redundanzen** | **Redundanzerkennung** über Fähigkeits-Tags und Textähnlichkeit, schon beim Registrieren („Gibt es das schon?“) und als Kandidatenliste mit Entscheidung (konsolidieren / bewusst parallel). |
| **Sicherheitsprobleme** (Öffnung nach außen, zu viele Rechte) | Transparentes **Risikomodell**, **17 Befundregeln** (z. B. öffentlich erreichbar ohne Security-Freigabe, autonomer Agent mit Produktionsrechten, Exfiltrationsrisiko, Secrets im Klartext), **risikobasierter Freigabe-Workflow** mit Vier-Augen-Prinzip und befristeten Risikoakzeptanzen. |
| **Durchsetzung auf den Rechnern** | Erzeugt die verbindliche **Claude-Code-Policy** (`managed-settings.json`): nur freigegebene MCP-Server erlaubt, abgelehnte blockiert, Deny-Regeln, Bypass-Modus aus, optional Sandbox und Telemetrie. Abrufbar per API für MDM/Config-Management. |
| **Nachvollziehbarkeit** | **Audit-Log** aller Änderungen, Freigaben, Akzeptanzen und Synchronisationen. |

Das Konzept dahinter (Rollen, Freigabematrix, Einführungsplan) steht in [docs/KONZEPT.md](docs/KONZEPT.md).

## Schnellstart (lokal, mit Demo-Daten)

Voraussetzung: **Node.js ≥ 22.13** (nutzt das eingebaute `node:sqlite`, keine native Kompilierung nötig).

```bash
npm install
npm run seed:demo        # füllt server/data/mackaidmin.db mit einer Demo-Organisation
npm run dev              # API auf :8080, Web-UI mit Hot-Reload auf http://localhost:5173
```

Anmelden mit `admin@demo.local` / `demo-passwort-123`. Weitere Demo-Personen (gleiches Passwort) zeigen die Rollen:
`sina.sicherheit@demo.local` (IT-Sicherheit), `dorothea.datenschutz@demo.local` (Datenschutz), `arne.architekt@demo.local` (Architektur), `frank.finanzen@demo.local` (Finanzen), `paul.pipeline@demo.local` (Entwickler), `vera.viewer@demo.local` (Lesezugriff).

Die Demo enthält bewusst typische Probleme: einen öffentlichen Chatbot ohne Security-Freigabe, einen autonomen Deploy-Agent mit Produktionsrechten, einen Agent mit personenbezogenen Daten ohne Datenschutz-Freigabe, eine Automatisierung über Budget, zwei redundante Review-Agents, einen verwaisten Skill, inaktive Lizenzen und Shadow-AI-Funde.

## Produktion

```bash
npm run build            # baut Web-UI und Server
ADMIN_EMAIL=ich@firma.de ADMIN_PASSWORD='…' COOKIE_SECURE=true npm start
```

oder mit Docker:

```bash
ADMIN_PASSWORD='…' docker compose up -d --build
```

Die Datenbank (SQLite, WAL-Modus) liegt im Volume `/data`. Für Backups genügt eine Kopie der Datei (z. B. per `sqlite3 mackaidmin.db ".backup backup.db"`). Betrieb hinter einem TLS-terminierenden Reverse Proxy ist vorgesehen.

### Konfiguration (Umgebungsvariablen)

| Variable | Bedeutung | Standard |
| --- | --- | --- |
| `PORT` | HTTP-Port | `8080` |
| `DATABASE_PATH` | Pfad der SQLite-Datei | `data/mackaidmin.db` im Arbeitsverzeichnis (bei `npm run dev`/`start`: `server/data/`) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | erster Admin, nur bei leerer Datenbank | `admin@example.com`, zufällig (wird geloggt) |
| `SEED_DEMO` | Demo-Daten bei leerer Datenbank einspielen | `false` |
| `COOKIE_SECURE` | Session-Cookie nur über HTTPS, HSTS aktiv | `true` bei `NODE_ENV=production` |
| `SESSION_TTL_HOURS` | Gültigkeit einer Anmeldung | `12` |
| `AUTH_PROXY_HEADER` | SSO über vorgeschalteten Proxy (z. B. `x-forwarded-email` von oauth2-proxy). **Nur setzen, wenn die App ausschließlich über den Proxy erreichbar ist.** | – |
| `ANTHROPIC_ADMIN_KEY` | Admin-API-Key der Claude Console (`sk-ant-admin…`) für den Claude-Code-Sync | – |
| `STATIC_DIR` | Verzeichnis der gebauten Web-UI | `web/dist` |

## Module

- **Übersicht** – Kosten des laufenden Monats mit Prognose, offene Befunde, Freigaben, Lizenzen, Shadow-AI, Redundanzen, Assets mit Handlungsbedarf.
- **Inventar** – alle Assets (Anwendung, KI-Agent, MCP-Server, Skill/Plugin, Automatisierung, Integration, CI/CD-Agent, Bibliothek) mit Steckbrief, Berechtigungen inkl. Begründung, Abhängigkeiten, Kosten, Verlauf. Registrierung mit **Live-Risikobewertung** und **Redundanz-Check**.
- **Freigaben** – Posteingang je Rolle; Freigabe/Ablehnung mit Kommentar. Risikorelevante Änderungen an freigegebenen Assets starten automatisch eine neue Freigaberunde.
- **Sicherheit & Risiken** – alle Befunde mit Empfehlung; befristete Risikoakzeptanz durch die zuständige Rolle.
- **Kosten & Budgets** – Tageskosten, Aufteilung nach Team/Asset/Modell/Quelle, Cache-Trefferquote, Modellpreise, CSV-Import, Anthropic-Sync. Auswertungen pro Person nur für Finanzen/Admin.
- **Lizenzen** – Lizenztypen, Zuweisungen, inaktive und freie Seats, Einsparpotenzial.
- **Redundanzen** – ähnliche Assets mit gemeinsamen Fähigkeiten und Entscheidung.
- **Shadow-AI-Discovery** – Scanner-Funde, Registrierung mit einem Klick, nicht freigegebene MCP-Server in `.mcp.json`.
- **Richtlinien & Policy** – Governance-Schwellwerte und Claude-Code-Policy mit Vorschau und Download der `managed-settings.json`.
- **Organisation** – Personen, Rollen, Teams, API-Tokens. **Audit-Log** – revisionssicheres Protokoll.

## Integrationen

### Claude-Code-Nutzung aus der Anthropic Admin API

Mit `ANTHROPIC_ADMIN_KEY` lädt **Kosten → Claude Code synchronisieren** die Tageswerte der [Claude Code Analytics API](https://platform.claude.com/docs/en/manage-claude/claude-code-analytics-api) (`GET /v1/organizations/usage_report/claude_code`): Tokens und geschätzte Kosten je Person und Modell, Sessions und Codezeilen. Der Sync ist idempotent, ordnet Nutzer:innen über die E-Mail zu und aktualisiert die Lizenzaktivität.
Gilt für Claude-Console-Organisationen. Claude Team/Enterprise (claude.ai) liefern Daten über die Claude Enterprise Analytics API bzw. die Analytics-Ansicht – diese lassen sich per CSV-Import übernehmen; alternativ OpenTelemetry (siehe Policy).

### Verbrauch aus eigenen Apps und Agents melden

API-Token mit Scope `usage:write` anlegen, dann z. B. nach jedem Lauf:

```bash
curl -X POST https://mackaidmin.intern/api/costs/usage \
  -H "Authorization: Bearer $MACKAIDMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"date":"2026-10-23","assetKey":"pr-review-agent","model":"claude-sonnet-5-5",
       "inputTokens":120000,"outputTokens":8000,"cacheReadTokens":900000}'
```

Werte stammen direkt aus `response.usage` der Claude API. Ohne `costUsd` rechnet MackAIdmin mit den hinterlegten Modellpreisen. Verbrauch für **nicht registrierte Assets wird abgelehnt** – so wird jede neue Anwendung zwangsläufig im Inventar sichtbar. Mit `dedupeKey` werden Wiederholungen idempotent.

### Shadow-AI-Scanner

```bash
node scripts/mackaidmin-scan.mjs ~/repos --dry-run                       # nur anzeigen
node scripts/mackaidmin-scan.mjs ~/repos --server https://mackaidmin.intern --token $TOKEN   # Scope discovery:write
```

Findet `CLAUDE.md`, `.claude/settings.json` (inkl. Bypass-Modus und Hooks), Subagents, Skills/Commands, `.mcp.json`, Anthropic-SDK- und Agent-SDK-Nutzung (Python, TS/JS, Go, Java, …) sowie Claude in CI-Pipelines. Übertragen werden nur Metadaten; Secrets in `env`/`headers` und Zugangsdaten in Git-Remotes werden verworfen. Ideal als nächtlicher Job über alle Repositories oder als CI-Schritt.

### Claude-Code-Policy verteilen

`GET /api/policies/claude-code/managed-settings.json` (Token-Scope `policy:read`) liefert die aktuelle Policy. Ablage per MDM/GPO/Ansible unter:

- macOS: `/Library/Application Support/ClaudeCode/managed-settings.json`
- Linux/WSL: `/etc/claude-code/managed-settings.json`
- Windows: `C:\Program Files\ClaudeCode\managed-settings.json`

Alternativ den Inhalt als server-managed Settings in der Claude-Admin-Konsole hinterlegen. Referenz: [Managed Settings](https://code.claude.com/docs/en/managed-settings), [MCP-Steuerung](https://code.claude.com/docs/en/managed-mcp).

## Rollen

| Rolle | Darf |
| --- | --- |
| Administrator | alles, inkl. Personen, Teams, API-Tokens, Governance-Regeln |
| Teamleitung | Freigaben „Teamleitung“, Assets des eigenen Teams bearbeiten, Lizenzen zuweisen, Redundanzen bewerten |
| Architektur | Freigaben „Architektur“ (u. a. alle MCP-Server), Redundanzen, Discovery-Funde |
| IT-Sicherheit | Freigaben „IT-Sicherheit“, Sicherheitsrisiken akzeptieren, Claude-Code-Policy pflegen |
| Datenschutz | Freigaben „Datenschutz“, Datenschutzrisiken akzeptieren |
| Finanzen / Controlling | Freigaben „Finanzen“, Budgets, Modellpreise, Importe/Sync, Lizenzen, Auswertungen pro Person |
| Entwickler:in | Assets registrieren und eigene Assets pflegen |
| Lesezugriff | nur lesen |

Niemand – auch kein Admin – kann eigene Assets freigeben oder deren Risiken akzeptieren (Vier-Augen-Prinzip).

## Architektur & Entwicklung

```
server/   Node.js 22 + TypeScript, Express 5, node:sqlite, zod
  src/domain/      reine Fachlogik: Risiko, Befundregeln, Freigabematrix, Redundanz, Kosten, Policy-Generator
  src/services/    Datenzugriff und Workflows (Assets, Freigaben, Kosten, Lizenzen, Discovery, Audit)
  src/routes/      REST-API unter /api
  src/integrations Anthropic Admin API
web/      React 18 + Vite + TypeScript, keine UI-Bibliothek, Hell-/Dunkelmodus
scripts/  Shadow-AI-Scanner (ohne Abhängigkeiten)
docs/     Governance-Konzept
```

```bash
npm test            # Unit- und API-Tests (node:test)
npm run typecheck   # Server und Web
npm run build
```

Sicherheit: Passwörter mit scrypt, Sessions serverseitig (HttpOnly, SameSite=Lax), CSRF-Schutz über JSON-Pflicht für schreibende Requests, Login-Drosselung, strikte CSP und Security-Header (helmet), API-Tokens nur gehasht gespeichert und mit minimalen Scopes, Eingabevalidierung mit zod, vollständiges Audit-Log.

## Roadmap-Ideen

- OIDC-Login direkt (Entra ID, Okta) und SCIM-Provisioning
- OpenTelemetry-Empfänger für Claude-Code-Metriken in Echtzeit
- Import der Claude Enterprise Analytics API
- Benachrichtigungen (E-Mail/Teams/Slack) bei neuen Befunden, Budgetwarnungen und offenen Freigaben
- PostgreSQL für Mehrinstanz-Betrieb
