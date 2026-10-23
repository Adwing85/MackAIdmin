// Demo data that shows every governance mechanism at work: redundant agents, an orphaned
// skill, an over-budget automation, unapproved MCP servers, shadow AI in repositories, …
// All dates are relative to "now" so the demo always looks current.

import { run, transaction, type DB } from "./database.js";
import { hashPassword } from "../auth/auth.js";
import { DEFAULT_MODEL_PRICES, isoDate } from "../domain/costs.js";
import type { PermissionKey } from "../domain/catalog.js";
import { createAsset, evaluateAsset, setAssetStatus, type AssetInput } from "../services/assets.js";
import { ensureApprovalRows } from "../services/workflow.js";
import { loadPrices, recordUsage, savePrices } from "../services/costs.js";
import { ingestDiscoveries } from "../services/discovery.js";

export const DEMO_PASSWORD = "demo-passwort-123";

function prng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const daysAgo = (n: number, now = new Date()) => new Date(now.getTime() - n * 86_400_000).toISOString();

export function seedDemoData(db: DB, now = new Date()): void {
  transaction(db, () => {
    savePrices(db, DEFAULT_MODEL_PRICES);
    const prices = loadPrices(db);
    const rand = prng(42);

    // --- teams & people -----------------------------------------------------------
    const teams: Record<string, number> = {};
    for (const [name, cc, budget] of [
      ["Plattform & DevOps", "CC-4100", 2500],
      ["E-Commerce", "CC-4200", 1500],
      ["Data & Analytics", "CC-4300", 1200],
      ["Kundenservice-IT", "CC-4400", 800],
      ["Finanz-IT", "CC-4500", 600],
    ] as const) {
      teams[name] = Number(
        run(db, "INSERT INTO teams (name, cost_center, monthly_budget_usd) VALUES (:n, :c, :b)", { n: name, c: cc, b: budget })
          .lastInsertRowid,
      );
    }

    const pw = hashPassword(DEMO_PASSWORD);
    const people: Record<string, number> = {};
    const addPerson = (key: string, name: string, email: string, roles: string[], team: string | null, active = true) => {
      people[key] = Number(
        run(db, "INSERT INTO people (email, name, roles, team_id, password_hash, active) VALUES (:e, :n, :r, :t, :p, :a)", {
          e: email,
          n: name,
          r: JSON.stringify(roles),
          t: team ? teams[team] : null,
          p: pw,
          a: active,
        }).lastInsertRowid,
      );
    };
    addPerson("admin", "Alex Admin", "admin@demo.local", ["admin"], null);
    addPerson("lead_platform", "Petra Plattform", "petra.plattform@demo.local", ["team_lead", "developer"], "Plattform & DevOps");
    addPerson("lead_shop", "Eric Ecommerce", "eric.ecommerce@demo.local", ["team_lead", "developer"], "E-Commerce");
    addPerson("lead_data", "Dana Daten", "dana.daten@demo.local", ["team_lead", "developer"], "Data & Analytics");
    addPerson("lead_cs", "Kai Kundenservice", "kai.kundenservice@demo.local", ["team_lead"], "Kundenservice-IT");
    addPerson("architect", "Arne Architekt", "arne.architekt@demo.local", ["architecture"], "Plattform & DevOps");
    addPerson("security", "Sina Sicherheit", "sina.sicherheit@demo.local", ["security"], null);
    addPerson("privacy", "Dorothea Datenschutz", "dorothea.datenschutz@demo.local", ["privacy"], null);
    addPerson("finance", "Frank Finanzen", "frank.finanzen@demo.local", ["finance", "team_lead"], "Finanz-IT");
    addPerson("dev_platform", "Paul Pipeline", "paul.pipeline@demo.local", ["developer"], "Plattform & DevOps");
    addPerson("dev_shop", "Sophie Shop", "sophie.shop@demo.local", ["developer"], "E-Commerce");
    addPerson("dev_shop2", "Tim Test", "tim.test@demo.local", ["developer"], "E-Commerce");
    addPerson("dev_data", "Lena Lakehouse", "lena.lakehouse@demo.local", ["developer"], "Data & Analytics");
    addPerson("dev_cs", "Chris Chatbot", "chris.chatbot@demo.local", ["developer"], "Kundenservice-IT");
    addPerson("leaver", "Olaf Ausgeschieden", "olaf.ausgeschieden@demo.local", ["developer"], "Data & Analytics", false);
    addPerson("viewer", "Vera Viewer", "vera.viewer@demo.local", ["viewer"], null);

    // --- assets -----------------------------------------------------------------------
    const ids: Record<string, number> = {};
    const base: Omit<AssetInput, "name" | "type"> = {
      description: "",
      purpose: "",
      ownerId: null,
      teamId: null,
      repositoryUrl: null,
      environments: [],
      dataClassification: "internal",
      processesPersonalData: false,
      exposure: "local",
      autonomyLevel: 1,
      humanInTheLoop: true,
      sandboxed: false,
      secretsManagement: "none",
      models: ["claude-sonnet-5-5"],
      capabilities: [],
      tags: [],
      permissions: [],
      dependencies: [],
      mcpTransport: null,
      mcpEndpoint: null,
      monthlyBudgetUsd: null,
      reviewIntervalDays: null,
    };
    const perms = (...keys: PermissionKey[]) => keys.map((key) => ({ key, justification: "" }));
    const add = (
      key: string,
      status: string,
      owner: string,
      team: string | null,
      input: Partial<AssetInput> & Pick<AssetInput, "name" | "type">,
      createdDaysAgo = 120,
    ) => {
      const asset = createAsset(
        db,
        { ...base, ...input, key, ownerId: people[owner], teamId: team ? teams[team] : null },
        people[owner],
      );
      ids[key] = asset.id;
      run(db, "UPDATE assets SET created_at = :c, updated_at = :c, last_review_at = :r WHERE id = :id", {
        c: daysAgo(createdDaysAgo, now),
        r: daysAgo(Math.min(createdDaysAgo, 40), now),
        id: asset.id,
      });
      setAssetStatus(db, asset.id, status as never);
    };

    add("mcp-github", "active", "lead_platform", "Plattform & DevOps", {
      name: "GitHub MCP-Server",
      type: "mcp_server",
      description: "Offizieller Remote-MCP-Server für GitHub: Issues, Pull Requests und Code-Suche.",
      purpose: "Zentral freigegebener Zugriff von Claude Code auf GitHub",
      mcpTransport: "http",
      mcpEndpoint: "https://api.githubcopilot.com/mcp/*",
      exposure: "internal",
      permissions: perms("vcs.read", "vcs.write", "external.api"),
      capabilities: ["github-integration"],
      tags: ["mcp", "github"],
    });
    add("mcp-jira", "active", "lead_platform", "Plattform & DevOps", {
      name: "Atlassian MCP-Server (Jira/Confluence)",
      type: "mcp_server",
      description: "Remote-MCP-Server für Jira-Tickets und Confluence-Seiten.",
      purpose: "Tickets und Doku im Kontext von Claude Code nutzen",
      mcpTransport: "http",
      mcpEndpoint: "https://mcp.atlassian.com/*",
      exposure: "internal",
      dataClassification: "confidential",
      permissions: perms("external.api", "db.read"),
      capabilities: ["ticketing-integration"],
      tags: ["mcp", "jira"],
    });
    add("mcp-datenkatalog", "active", "lead_data", "Data & Analytics", {
      name: "Datenkatalog-MCP",
      type: "mcp_server",
      description: "Interner MCP-Server, der Tabellen- und Spaltenbeschreibungen aus dem Datenkatalog liefert.",
      purpose: "Analysten und Agents finden die richtigen Datenquellen",
      mcpTransport: "stdio",
      mcpEndpoint: "node /opt/mcp/datenkatalog/server.js",
      permissions: perms("db.read"),
      capabilities: ["data-catalog"],
      tags: ["mcp", "daten"],
    });
    add(
      "mcp-postgres-prod",
      "in_review",
      "dev_data",
      "Data & Analytics",
      {
        name: "Postgres-MCP (Produktiv-Shop-DB)",
        type: "mcp_server",
        description: "Community-MCP-Server mit direktem Zugriff auf die produktive Shop-Datenbank.",
        purpose: "Ad-hoc-Analysen direkt auf Produktivdaten",
        mcpTransport: "stdio",
        mcpEndpoint: "npx -y @modelcontextprotocol/server-postgres postgresql://shop-prod.intern/shop",
        dataClassification: "confidential",
        processesPersonalData: true,
        permissions: perms("db.read", "db.write", "pii.access"),
        secretsManagement: "env",
        capabilities: ["sql-generation"],
        tags: ["mcp", "postgres"],
      },
      12,
    );
    add(
      "mcp-webscraper",
      "rejected",
      "dev_shop",
      "E-Commerce",
      {
        name: "Web-Scraper MCP (Community)",
        type: "mcp_server",
        description: "Inoffizieller MCP-Server zum Scrapen beliebiger Webseiten inkl. JavaScript-Ausführung.",
        purpose: "Preise von Wettbewerbern auslesen",
        mcpTransport: "stdio",
        mcpEndpoint: "npx -y mcp-webscraper-unofficial",
        permissions: perms("net.outbound", "code.untrusted", "shell.exec"),
        capabilities: ["web-scraping"],
        tags: ["mcp"],
      },
      30,
    );

    add(
      "claude-code",
      "active",
      "lead_platform",
      "Plattform & DevOps",
      {
        name: "Claude Code (Entwickler-Arbeitsplätze)",
        type: "application",
        description:
          "Agentisches Coding-Werkzeug im Terminal und in der IDE für alle lizenzierten Entwickler:innen. Policy wird über managed-settings.json verteilt.",
        purpose: "Produktivität in der Softwareentwicklung steigern",
        models: ["claude-opus-5-5", "claude-sonnet-5-5"],
        permissions: perms("fs.read", "fs.write", "shell.exec", "vcs.read", "vcs.write"),
        sandboxed: true,
        capabilities: ["coding-assistant"],
        tags: ["claude-code"],
        dependencies: [],
        monthlyBudgetUsd: 3000,
        repositoryUrl: "https://github.example.com/mack/claude-code-config",
      },
      200,
    );
    run(db, "INSERT INTO asset_dependencies (asset_id, depends_on_id) VALUES (:a, :b), (:a, :c), (:a, :d)", {
      a: ids["claude-code"],
      b: ids["mcp-github"],
      c: ids["mcp-jira"],
      d: ids["mcp-datenkatalog"],
    });

    add("pr-review-agent", "active", "dev_platform", "Plattform & DevOps", {
      name: "PR-Review-Agent (GitHub Action)",
      type: "ci_agent",
      description:
        "Prüft jeden Pull Request automatisch auf Codequalität, Sicherheitslücken und Testabdeckung und kommentiert Befunde.",
      purpose: "Code-Reviews beschleunigen und Qualität sichern",
      repositoryUrl: "https://github.example.com/mack/platform-infra",
      autonomyLevel: 2,
      humanInTheLoop: false,
      sandboxed: true,
      permissions: perms("vcs.read", "vcs.write"),
      secretsManagement: "vault",
      capabilities: ["code-review", "pull-requests"],
      tags: ["github", "ci"],
      monthlyBudgetUsd: 400,
      dependencies: [ids["mcp-github"]],
    });
    add(
      "code-review-assistant",
      "active",
      "dev_shop",
      "E-Commerce",
      {
        name: "Review-Assistent Shop",
        type: "agent",
        description: "Kommentiert Pull Requests im Shop-Monorepo mit Hinweisen zu Codequalität und möglichen Sicherheitslücken.",
        purpose: "Reviews im E-Commerce-Team unterstützen",
        repositoryUrl: "https://github.example.com/mack/shop-frontend",
        autonomyLevel: 2,
        humanInTheLoop: false,
        permissions: perms("vcs.read", "vcs.write"),
        secretsManagement: "env",
        capabilities: ["code-review", "pull-requests"],
        tags: ["github"],
        monthlyBudgetUsd: 250,
      },
      60,
    );
    add(
      "support-triage",
      "active",
      "dev_cs",
      "Kundenservice-IT",
      {
        name: "Support-Ticket-Triage-Agent",
        type: "agent",
        description:
          "Liest eingehende Kundenanfragen, klassifiziert sie, schlägt Antworten vor und versendet Standardantworten automatisch.",
        purpose: "Erstreaktionszeit im Kundenservice senken",
        repositoryUrl: "https://github.example.com/mack/cs-triage",
        dataClassification: "confidential",
        processesPersonalData: true,
        exposure: "internal",
        autonomyLevel: 2,
        humanInTheLoop: false,
        permissions: perms("pii.access", "external.api", "email.send", "db.read"),
        secretsManagement: "vault",
        capabilities: ["ticket-triage", "text-classification"],
        tags: ["kundenservice"],
        monthlyBudgetUsd: 600,
        models: ["claude-sonnet-5-5", "claude-haiku-5-5"],
        dependencies: [ids["mcp-jira"]],
      },
      90,
    );
    add(
      "kundenservice-chatbot",
      "in_review",
      "dev_cs",
      "Kundenservice-IT",
      {
        name: "Kundenservice-Chatbot (Website)",
        type: "application",
        description: "Öffentlicher Chatbot auf der Website, beantwortet Fragen zu Bestellungen, Lieferstatus und Retouren.",
        purpose: "Entlastung des Kundenservice, 24/7-Erreichbarkeit",
        repositoryUrl: "https://github.example.com/mack/web-chatbot",
        dataClassification: "confidential",
        processesPersonalData: true,
        exposure: "public",
        autonomyLevel: 1,
        humanInTheLoop: false,
        permissions: perms("net.inbound", "pii.access", "db.read"),
        secretsManagement: "vault",
        capabilities: ["customer-chat"],
        tags: ["website", "kundenservice"],
        monthlyBudgetUsd: 1200,
      },
      20,
    );
    add("sql-assistent", "active", "dev_data", "Data & Analytics", {
      name: "SQL-Assistent für Analysten",
      type: "agent",
      description: "Erzeugt SQL-Abfragen aus natürlicher Sprache und erklärt Ergebnisse.",
      purpose: "Self-Service-Analysen für Fachbereiche",
      repositoryUrl: "https://github.example.com/mack/sql-assistant",
      dataClassification: "confidential",
      permissions: perms("db.read"),
      capabilities: ["sql-generation", "data-analysis"],
      tags: ["daten"],
      monthlyBudgetUsd: 300,
      dependencies: [ids["mcp-datenkatalog"], ids["mcp-postgres-prod"]],
    });
    add("kpi-report-generator", "active", "lead_data", "Data & Analytics", {
      name: "KPI-Report-Generator",
      type: "automation",
      description: "Erstellt wöchentlich Management-Reports mit Kommentierung der wichtigsten Kennzahlen.",
      purpose: "Manuelle Reporting-Arbeit reduzieren",
      repositoryUrl: "https://github.example.com/mack/kpi-reports",
      dataClassification: "confidential",
      permissions: perms("db.read", "email.send"),
      capabilities: ["reporting", "data-analysis"],
      tags: ["reporting"],
      monthlyBudgetUsd: 150,
    });
    add("rechnungs-extraktor", "active", "finance", "Finanz-IT", {
      name: "Rechnungs-Extraktor",
      type: "automation",
      description: "Liest Eingangsrechnungen aus PDFs, extrahiert Positionen und bucht sie im ERP vor.",
      purpose: "Kreditorenbuchhaltung entlasten",
      repositoryUrl: "https://github.example.com/mack/invoice-extractor",
      dataClassification: "confidential",
      permissions: perms("db.write", "fs.read"),
      secretsManagement: "vault",
      capabilities: ["document-extraction"],
      tags: ["finanzen", "erp"],
      monthlyBudgetUsd: 200,
      models: ["claude-opus-5-5"],
    });
    add(
      "auto-deploy-agent",
      "draft",
      "dev_platform",
      "Plattform & DevOps",
      {
        name: "Auto-Deploy-Agent",
        type: "agent",
        description: "Soll fehlgeschlagene Deployments selbstständig analysieren, fixen und erneut in Produktion ausrollen.",
        purpose: "Mean Time to Recovery senken",
        repositoryUrl: "https://github.example.com/mack/platform-infra",
        dataClassification: "confidential",
        autonomyLevel: 3,
        humanInTheLoop: false,
        permissions: perms("shell.exec", "prod.deploy", "secrets.read", "net.outbound", "vcs.write"),
        secretsManagement: "env",
        capabilities: ["deployment-automation", "incident-response"],
        tags: ["devops"],
        monthlyBudgetUsd: 800,
        models: ["claude-opus-5-5"],
      },
      5,
    );
    add(
      "release-notes",
      "active",
      "dev_shop2",
      "E-Commerce",
      {
        name: "Release-Notes-Generator",
        type: "automation",
        description: "Fasst Commits und Tickets eines Releases zu kundenverständlichen Release Notes zusammen.",
        purpose: "Release-Kommunikation vereinfachen",
        repositoryUrl: "https://github.example.com/mack/release-notes",
        permissions: perms("vcs.read"),
        capabilities: ["summarization", "release-management"],
        tags: ["release"],
        monthlyBudgetUsd: 50,
        models: ["claude-haiku-5-5"],
      },
      400,
    );
    run(db, "UPDATE assets SET last_review_at = :r WHERE id = :id", { r: daysAgo(260, now), id: ids["release-notes"] });
    add(
      "unit-test-skill",
      "active",
      "leaver",
      "Data & Analytics",
      {
        name: "Unit-Test-Generator (Skill)",
        type: "skill",
        description: "Claude-Code-Skill, der für geänderte Funktionen automatisch Unit-Tests erzeugt.",
        purpose: "Testabdeckung erhöhen",
        repositoryUrl: "https://github.example.com/mack/claude-skills",
        permissions: perms("fs.read", "fs.write"),
        capabilities: ["test-generation"],
        tags: ["testing", "skill"],
      },
      300,
    );
    add(
      "testfall-generator",
      "active",
      "dev_shop2",
      "E-Commerce",
      {
        name: "Testfall-Generator",
        type: "agent",
        description: "Generiert Unit- und Integrationstests für neue Funktionen im Shop.",
        purpose: "Testabdeckung im Shop erhöhen",
        repositoryUrl: "https://github.example.com/mack/shop-frontend",
        permissions: perms("fs.read", "fs.write", "shell.exec"),
        capabilities: ["test-generation"],
        tags: ["testing"],
        monthlyBudgetUsd: 120,
      },
      45,
    );
    add(
      "marketing-texte",
      "active",
      "dev_shop",
      "E-Commerce",
      {
        name: "Produkttext-Generator",
        type: "automation",
        description: "Erzeugt SEO-optimierte Produktbeschreibungen aus Stammdaten.",
        purpose: "Content-Erstellung im Onlineshop beschleunigen",
        repositoryUrl: "https://github.example.com/mack/product-copy",
        permissions: perms("db.read", "external.api"),
        capabilities: ["content-generation"],
        tags: ["marketing"],
        monthlyBudgetUsd: 100,
        models: ["claude-haiku-4-5"],
      },
      150,
    );
    add(
      "chat-zusammenfasser",
      "retired",
      "dev_cs",
      "Kundenservice-IT",
      {
        name: "Chat-Zusammenfasser (alt)",
        type: "automation",
        description: "Erste Version der Chat-Zusammenfassung, ersetzt durch den Triage-Agent.",
        purpose: "",
        permissions: perms("pii.access"),
        capabilities: ["summarization"],
      },
      500,
    );

    // --- approvals ---------------------------------------------------------------------
    const approverFor: Record<string, string> = {
      team_lead: "admin",
      architecture: "architect",
      security: "security",
      privacy: "privacy",
      finance: "finance",
    };
    const teamLeadFor: Record<string, string> = {
      "Plattform & DevOps": "lead_platform",
      "E-Commerce": "lead_shop",
      "Data & Analytics": "lead_data",
      "Kundenservice-IT": "lead_cs",
      "Finanz-IT": "finance",
    };
    const skip: Record<string, string[]> = {
      "support-triage": ["privacy"], // runs without data-protection sign-off → PRIV-01
      "kundenservice-chatbot": ["security", "privacy"], // still in review
      "mcp-postgres-prod": ["architecture", "security", "privacy"],
      "code-review-assistant": [],
    };
    for (const [key, id] of Object.entries(ids)) {
      const e = evaluateAsset(db, id, now)!;
      if (!["in_review", "approved", "active", "deprecated"].includes(e.asset.status)) continue;
      ensureApprovalRows(db, id);
      const teamName = e.team?.name ?? "";
      for (const req of e.requiredApprovals) {
        if (skip[key]?.includes(req.role)) continue;
        let approver = req.role === "team_lead" ? (teamLeadFor[teamName] ?? "admin") : approverFor[req.role];
        if (people[approver] === e.asset.ownerId) approver = "admin";
        run(
          db,
          `UPDATE approvals SET decision = 'approved', decided_by = :by, decided_at = :at,
             comment = :c WHERE asset_id = :a AND round = :r AND role = :role`,
          {
            by: people[approver],
            at: daysAgo(Math.max(1, Math.floor(rand() * 60)), now),
            c: req.role === "security" ? "Threat-Model geprüft, Rechte minimal." : null,
            a: id,
            r: e.asset.approvalRound,
            role: req.role,
          },
        );
      }
    }
    ensureApprovalRows(db, ids["mcp-webscraper"]);
    run(
      db,
      "UPDATE approvals SET decision = 'rejected', decided_by = :by, decided_at = :at, comment = :c WHERE asset_id = :a AND role = 'architecture'",
      {
        by: people.architect,
        at: daysAgo(25, now),
        c: "Führt beliebiges JavaScript fremder Seiten aus und hat Shell-Zugriff – nicht freigabefähig. Bitte den freigegebenen Crawler-Service nutzen.",
        a: ids["mcp-webscraper"],
      },
    );

    // A documented, time-boxed risk acceptance.
    run(
      db,
      "INSERT INTO risk_acceptances (asset_id, rule_id, justification, accepted_by, accepted_at, expires_at) VALUES (:a, 'SEC-06', :j, :u, :at, :e)",
      {
        a: ids["testfall-generator"],
        j: "Läuft nur in der isolierten CI-Umgebung ohne Netzwerkzugriff; Sandbox-Migration bis Q1 geplant.",
        u: people.security,
        at: daysAgo(10, now),
        e: new Date(now.getTime() + 80 * 86_400_000).toISOString(),
      },
    );

    // --- usage (60 days) ---------------------------------------------------------------------
    const usageProfile: [string, string, number][] = [
      ["pr-review-agent", "claude-sonnet-5-5", 9],
      ["code-review-assistant", "claude-sonnet-5-5", 5],
      ["support-triage", "claude-sonnet-5-5", 14],
      ["support-triage", "claude-haiku-5-5", 1.2],
      ["sql-assistent", "claude-sonnet-5-5", 6],
      ["kpi-report-generator", "claude-sonnet-5-5", 3],
      ["rechnungs-extraktor", "claude-opus-5-5", 11],
      ["release-notes", "claude-haiku-5-5", 0.4],
      ["testfall-generator", "claude-sonnet-5-5", 4],
      ["marketing-texte", "claude-haiku-4-5", 2.5],
      ["unit-test-skill", "claude-sonnet-5-5", 1.5],
    ];
    const tokensFor = (model: string, targetUsd: number) => {
      const p = prices.find((x) => x.model === model) ?? prices[0];
      // Typical agent mix: 55 % of spend on input (half of it cached), 45 % on output.
      const inputTokens = Math.round(((targetUsd * 0.35) / p.inputPerMTok) * 1_000_000);
      const cacheReadTokens = Math.round(((targetUsd * 0.2) / Math.max(p.cacheReadPerMTok, 0.001)) * 1_000_000);
      const outputTokens = Math.round(((targetUsd * 0.45) / p.outputPerMTok) * 1_000_000);
      return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens: Math.round(inputTokens * 0.1) };
    };
    for (let d = 59; d >= 0; d--) {
      const date = isoDate(new Date(now.getTime() - d * 86_400_000));
      const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
      const weekend = weekday === 0 || weekday === 6;
      for (const [key, model, dailyUsd] of usageProfile) {
        const growth = key === "rechnungs-extraktor" && d < 20 ? 1.6 : 1; // spike → budget overrun
        const usd = dailyUsd * growth * (weekend ? 0.25 : 1) * (0.7 + rand() * 0.6);
        recordUsage(
          db,
          {
            date,
            assetId: ids[key],
            personId: null,
            source: "api",
            model,
            ...tokensFor(model, usd),
            dedupeKey: `seed:${key}:${model}:${date}`,
          },
          prices,
        );
      }
      // Claude Code usage per developer (as delivered by the Admin API sync).
      const devs: [string, number][] = [
        ["dev_platform", 22],
        ["lead_platform", 9],
        ["dev_shop", 17],
        ["dev_shop2", 12],
        ["lead_shop", 4],
        ["dev_data", 15],
        ["dev_cs", 8],
      ];
      if (!weekend) {
        for (const [person, dailyUsd] of devs) {
          const usd = dailyUsd * (0.5 + rand());
          const t = tokensFor("claude-opus-5-5", usd * 0.7);
          const s = tokensFor("claude-sonnet-5-5", usd * 0.3);
          const sessions = 2 + Math.floor(rand() * 6);
          for (const [model, tokens, idx] of [
            ["claude-opus-5-5", t, 0],
            ["claude-sonnet-5-5", s, 1],
          ] as const) {
            recordUsage(
              db,
              {
                date,
                assetId: ids["claude-code"],
                personId: people[person],
                source: "anthropic_claude_code",
                model,
                ...tokens,
                sessions: idx === 0 ? sessions : 0,
                linesAdded: idx === 0 ? Math.floor(rand() * 600) : 0,
                linesRemoved: idx === 0 ? Math.floor(rand() * 250) : 0,
                dedupeKey: `seed:cc:${person}:${model}:${date}`,
              },
              prices,
            );
          }
        }
      }
    }

    // --- licenses --------------------------------------------------------------------
    const premium = Number(
      run(
        db,
        "INSERT INTO license_types (name, vendor, monthly_price_usd, seats_purchased, includes_claude_code, notes) VALUES (:n, 'Anthropic', :p, :s, 1, :notes)",
        { n: "Claude Premium-Seat (inkl. Claude Code)", p: 150, s: 12, notes: "Demo-Preis – an den eigenen Vertrag anpassen." },
      ).lastInsertRowid,
    );
    const standard = Number(
      run(
        db,
        "INSERT INTO license_types (name, vendor, monthly_price_usd, seats_purchased, includes_claude_code, notes) VALUES (:n, 'Anthropic', :p, :s, 0, :notes)",
        { n: "Claude Standard-Seat", p: 30, s: 10, notes: "Demo-Preis – an den eigenen Vertrag anpassen." },
      ).lastInsertRowid,
    );
    const assign = (license: number, person: string, assignedDaysAgo: number, lastActiveDaysAgo: number | null) =>
      run(
        db,
        "INSERT INTO license_assignments (license_type_id, person_id, assigned_at, last_active_at) VALUES (:l, :p, :a, :la)",
        {
          l: license,
          p: people[person],
          a: daysAgo(assignedDaysAgo, now),
          la: lastActiveDaysAgo === null ? null : daysAgo(lastActiveDaysAgo, now),
        },
      );
    for (const p of ["dev_platform", "lead_platform", "dev_shop", "dev_shop2", "lead_shop", "dev_data", "dev_cs"])
      assign(premium, p, 150, 1);
    assign(premium, "lead_data", 120, 48); // hasn't used Claude Code for weeks
    assign(premium, "architect", 90, null); // never used it
    assign(premium, "leaver", 200, 70); // left the company
    for (const p of ["security", "privacy", "finance", "lead_cs", "admin"]) assign(standard, p, 100, 3);

    // --- discovery (shadow AI) ------------------------------------------------------------
    ingestDiscoveries(
      db,
      [
        {
          repoUrl: "git@github.example.com:mack/shop-frontend.git",
          path: "CLAUDE.md",
          kind: "claude_md",
          details: { sizeBytes: 4210 },
        },
        {
          repoUrl: "git@github.example.com:mack/shop-frontend.git",
          path: ".mcp.json",
          kind: "mcp_config",
          details: {
            servers: [
              { name: "github", type: "http", url: "https://api.githubcopilot.com/mcp/" },
              { name: "puppeteer", type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-puppeteer"] },
            ],
          },
        },
        {
          repoUrl: "https://github.example.com/mack/pricing-engine",
          path: "src/agents/repricer.ts",
          kind: "agent_sdk",
          details: { package: "@anthropic-ai/claude-agent-sdk", files: 3 },
        },
        {
          repoUrl: "https://github.example.com/mack/hr-tools",
          path: "bewerber_screening/llm.py",
          kind: "anthropic_sdk",
          details: { package: "anthropic", files: 2 },
        },
        {
          repoUrl: "https://github.example.com/mack/hr-tools",
          path: ".mcp.json",
          kind: "mcp_config",
          details: { servers: [{ name: "personio", type: "http", url: "https://personio-mcp.example.net/mcp" }] },
        },
        {
          repoUrl: "https://github.example.com/mack/platform-infra",
          path: ".github/workflows/claude-review.yml",
          kind: "ci_claude",
          details: { action: "anthropics/claude-code-action" },
        },
        {
          repoUrl: "https://github.example.com/mack/data-pipelines",
          path: ".claude/settings.json",
          kind: "claude_settings",
          details: { permissionsAllow: ["Bash(*)"], bypassPermissions: true },
        },
      ],
      "demo-seed",
    );
    run(db, "UPDATE discoveries SET first_seen_at = :t", { t: daysAgo(6, now) });

    // --- redundancy decision & audit trail ----------------------------------------------------
    const [lo, hi] = [ids["unit-test-skill"], ids["testfall-generator"]].sort((a, b) => a - b);
    run(
      db,
      "INSERT INTO redundancy_reviews (asset_a, asset_b, decision, note, decided_by) VALUES (:a, :b, 'consolidate', :n, :u)",
      {
        a: lo,
        b: hi,
        n: "Skill wird zentral weitergeführt, Testfall-Generator im Shop bis Ende Q4 abgelöst.",
        u: people.architect,
      },
    );
    run(
      db,
      "INSERT INTO audit_log (at, actor_label, action, entity_type, summary) VALUES (:at, 'System (Demo-Daten)', 'seed', 'system', 'Demo-Daten eingespielt')",
      { at: now.toISOString() },
    );
  });
}
