# Governance-Konzept für die Einführung von Claude Code

Dieses Dokument beschreibt das Betriebsmodell, das MackAIdmin technisch abbildet. Es ist als Vorlage gedacht und sollte an Organisation, Verträge und Betriebsvereinbarungen angepasst werden.

## 1. Leitgedanke

**Schnell bauen erlaubt – unsichtbar betreiben nicht.** Entwickler:innen sollen mit Claude Code ohne Bürokratie experimentieren können. Sobald ein Ergebnis von anderen genutzt wird, Daten verarbeitet, Kosten verursacht oder Rechte auf Systeme bekommt, wird es zum **Asset** und muss registriert sein. Die Hürde ist bewusst niedrig (ein Formular, Live-Bewertung), die Kontrolle wächst mit dem Risiko.

Drei Mechanismen sorgen dafür, dass Registrierung nicht nur ein Appell bleibt:

1. **Kein Verbrauch ohne Inventar** – Token-Kosten werden nur registrierten Assets zugeordnet; die Usage-API lehnt unbekannte Assets ab.
2. **Keine MCP-Server ohne Freigabe** – die zentral verteilte `managed-settings.json` erlaubt nur MCP-Server, die im Inventar freigegeben sind.
3. **Shadow-AI wird sichtbar** – der Scanner findet Claude-Artefakte in Repositories und meldet alles, was keinem Asset zugeordnet ist.

## 2. Rollen und Gremien

| Rolle | Aufgabe |
| --- | --- |
| **Asset-Owner** | verantwortet Zweck, Betrieb, Kosten und Rechte eines Assets; führt regelmäßige Reviews durch |
| **Teamleitung** | bestätigt fachliche Notwendigkeit und Verantwortlichkeit, verwaltet Seats im Team |
| **Architektur** | prüft Redundanzen, Wiederverwendung und Integrationsmuster; gibt alle MCP-Server frei |
| **IT-Sicherheit** | prüft extern erreichbare und hochriskante Assets, pflegt die Claude-Code-Policy |
| **Datenschutz** | prüft Verarbeitung personenbezogener Daten (Verarbeitungsverzeichnis, DSFA, AVV) |
| **Finanzen / Controlling** | Budgets, Modellpreise, Lizenzbestand, Kostenzuordnung zu Kostenstellen |
| **KI-Governance-Board** (z. B. monatlich) | Kennzahlen, Redundanz-Entscheidungen, Richtlinien, Ausnahmen |

## 3. Lebenszyklus eines Assets

```
Entwurf → In Prüfung → Freigegeben → Im Betrieb → Abgekündigt → Stillgelegt
              ↘ Abgelehnt → (überarbeiten) → In Prüfung
```

- **Entwurf**: Registrierung inkl. Zweck, Fähigkeiten, Daten, Erreichbarkeit, Autonomie, Berechtigungen (mit Begründung), Modelle, Budget, Abhängigkeiten.
- **In Prüfung**: die erforderlichen Freigaben werden automatisch aus dem Risikoprofil abgeleitet und den Rollen vorgelegt.
- **Inbetriebnahme** ist erst möglich, wenn alle Freigaben vorliegen und **keine kritischen Befunde** offen sind.
- **Wesentliche Änderungen** (Rechte, Erreichbarkeit, Datenklassifizierung, Autonomie, Sandbox, Secrets, Budget, MCP-Endpunkt) an freigegebenen Assets starten automatisch eine **neue Freigaberunde**; bis dahin erscheint der Befund GOV-01.
- **Reviews** in festem Intervall (Standard 180 Tage): Wird das Asset noch gebraucht? Stimmen Rechte und Kosten?

## 4. Risikomodell

Der Risiko-Score (0–100) ist additiv und vollständig erklärbar – jeder Punkt hat eine Ursache, die im Asset angezeigt wird:

| Faktor | Punkte |
| --- | --- |
| Erreichbarkeit: lokal / intern / Partner / öffentlich | 0 / 5 / 15 / 25 |
| Daten: öffentlich / intern / vertraulich / streng vertraulich | 0 / 5 / 15 / 25 |
| Personenbezogene Daten | +10 |
| Autonomie L0 / L1 / L2 / L3 | 0 / 4 / 12 / 20 |
| Berechtigungen (Summe der Gewichte × 2, max. 30) | bis 30 |
| Schreibende Aktionen ohne menschliche Bestätigung | +10 |
| Shell-Ausführung ohne Sandbox | +6 |
| Secrets im Klartext / als Env-Variablen bei externer Erreichbarkeit | +12 / +4 |
| Gefährliche Kombinationen (z. B. Secrets + Internet, personenbezogene Daten + Abflusskanal, Shell + Internet) | +8 bis +12 |

Stufen: **Niedrig** < 20 ≤ **Mittel** < 45 ≤ **Hoch** < 70 ≤ **Kritisch**.

## 5. Freigabematrix

| Freigabe durch | wenn |
| --- | --- |
| Teamleitung | immer |
| Architektur | Risiko ≥ Mittel oder Asset ist ein MCP-Server |
| IT-Sicherheit | Risiko ≥ Hoch, extern erreichbar (Partner/öffentlich), Zugriff auf Secrets oder Secrets im Klartext |
| Datenschutz | personenbezogene Daten oder Berechtigung „Zugriff auf personenbezogene Daten“ |
| Finanzen | Monatsbudget ≥ Schwellwert (Standard 1.000 USD) |

Grundsätze: **Vier-Augen-Prinzip** (eigene Assets können nicht selbst freigegeben werden), Ablehnungen nur mit Begründung, jede Entscheidung im Audit-Log.

## 6. Befundregeln

| Regel | Schwere | Inhalt |
| --- | --- | --- |
| SEC-01 | Kritisch | Öffentlich erreichbar ohne Security-Freigabe |
| SEC-02 | Kritisch | Autonomer Agent (≥ L2, ohne Bestätigung) mit Schreibrechten auf Produktion, DB, Zahlungen, IAM oder Repo-Admin |
| SEC-03 | Hoch | Exfiltrationsrisiko: Secrets/personenbezogene Daten + Kanal nach außen |
| SEC-04 | Hoch | Secrets im Klartext |
| SEC-05 | Hoch | Nutzung nicht freigegebener MCP-Server / Abhängigkeiten |
| SEC-06 | Mittel | Shell-Ausführung / fremder Code ohne Sandbox |
| SEC-07 | Mittel | Administrative Rechte (Least Privilege prüfen) |
| PRIV-01 | Hoch | Personenbezogene Daten ohne Datenschutz-Freigabe |
| PRIV-02 | Mittel | Personenbezogene Daten an externe Dienste |
| GOV-01 | Hoch | Im Betrieb ohne gültige Freigabe (z. B. nach wesentlicher Änderung) |
| GOV-02 | Mittel | Kein aktiver Owner (verwaist, z. B. nach Austritt) |
| GOV-03 | Mittel | Review überfällig |
| GOV-04 | Niedrig | Kein Repository hinterlegt |
| GOV-05 | Mittel | Modell außerhalb der Modell-Policy |
| COST-01 | Hoch | Monatsbudget überschritten |
| COST-02 | Mittel | Prognose überschreitet Monatsbudget |
| COST-03 | Niedrig | Token-Verbrauch ohne Budget |

Befunde werden bei jedem Aufruf aus den aktuellen Daten berechnet und können nicht „vergessen“ werden. Bewusst eingegangene Risiken werden durch die zuständige Rolle **befristet akzeptiert** (max. 365 Tage, mit Begründung) und laufen danach automatisch wieder auf.

## 7. Kosten- und Lizenzsteuerung (FinOps)

- **Budgets** auf drei Ebenen: Unternehmen, Team (Kostenstelle), Asset. Warnung, wenn die Monatsprognose einen Schwellwert (Standard 80 %) überschreitet.
- **Datenquellen**: Claude Code Analytics API (Claude Console), Meldungen der eigenen Apps über die Usage-API, CSV-Importe (z. B. Exporte aus Claude Team/Enterprise oder Cloud-Rechnungen).
- **Hebel**, die MackAIdmin sichtbar macht: Cache-Trefferquote (Prompt-Caching), Modellwahl pro Asset, Redundanzen, ungenutzte Seats.
- **Lizenzen**: Seats ohne Aktivität seit 30 Tagen und Seats ausgeschiedener Personen werden als Einsparpotenzial ausgewiesen. Empfehlung: monatlicher Seat-Review durch Teamleitungen.

## 8. Durchsetzung auf den Entwickler-Rechnern

Die Claude-Code-Policy wird zentral gepflegt und als `managed-settings.json` verteilt (MDM, GPO, Config-Management oder server-managed Settings). Empfohlene Grundeinstellungen:

- `allowedMcpServers` aus dem Inventar + `allowManagedMcpServersOnly: true` – nur freigegebene MCP-Server.
- `deniedMcpServers` für abgelehnte/stillgelegte Server.
- `permissions.deny` für `.env`, Secrets-Verzeichnisse, SSH-/Cloud-Credentials und ungeprüfte Netzwerk-Tools.
- `permissions.disableBypassPermissionsMode: "disable"`.
- Optional: Sandbox mit Netzwerk-Allowlist, `availableModels`, Login auf die Firmenorganisation festlegen (`forceLoginMethod`, `forceLoginOrgUUID`), OpenTelemetry-Export an den zentralen Collector.

Entwickler:innen sehen mit `/status`, welche Policy aktiv ist.

## 9. Recht und Mitbestimmung

- **DSGVO**: Assets mit personenbezogenen Daten benötigen die Freigabe des Datenschutzes; das Inventar liefert die Grundlage für das Verarbeitungsverzeichnis.
- **Betriebsrat**: Nutzungs- und Kostendaten je Person sind personenbezogen und eignen sich zur Leistungs- und Verhaltenskontrolle. Ihre Auswertung ist in der Regel mitbestimmungspflichtig (§ 87 Abs. 1 Nr. 6 BetrVG). MackAIdmin zeigt personenbezogene Auswertungen deshalb nur den Rollen Finanzen und Admin; Zweck und Zugriff sollten in einer Betriebsvereinbarung geregelt werden.
- **EU AI Act**: Das Inventar mit Zweck, Datenarten, Autonomiestufe und Freigaben unterstützt die Einordnung von KI-Systemen und die Dokumentationspflichten; die rechtliche Bewertung im Einzelfall ersetzt es nicht.

## 10. Einführungsplan

| Phase | Dauer | Inhalt |
| --- | --- | --- |
| 0 – Vorbereitung | 2 Wochen | Rollen besetzen, Betriebsvereinbarung abstimmen, MackAIdmin bereitstellen, Policy-Grundeinstellungen festlegen |
| 1 – Pilot | 4–6 Wochen | 5–10 Entwickler:innen, Claude Code + Policy, Sync der Nutzung, erste Assets registrieren, Scanner nächtlich |
| 2 – Rollout | laufend | weitere Teams, Seat-Vergabe über Teamleitungen, Freigabeprozess im Alltag, monatliches Governance-Board |
| 3 – Optimierung | ab Monat 3 | Redundanzen konsolidieren, Budgets nachschärfen, Seats bereinigen, Policy verschärfen (Sandbox, nur zentrale Regeln) |

Kennzahlen für das Board: Anzahl Assets je Status, offene kritische/hohe Befunde, Durchlaufzeit von Freigaben, Kosten vs. Budget und Prognose, Seat-Auslastung, Shadow-AI-Funde, Redundanzentscheidungen.
