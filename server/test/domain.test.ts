import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assessRisk } from "../src/domain/risk.js";
import { approvalState, requiredApprovals, riskRelevantChanges } from "../src/domain/approvals.js";
import { evaluateFindings, type FindingContext } from "../src/domain/findings.js";
import { findRedundancyPairs, findSimilar, tokenize } from "../src/domain/redundancy.js";
import { DEFAULT_MODEL_PRICES, findPrice, forecastMonth, monthWindow, priceUsage } from "../src/domain/costs.js";
import { buildManagedSettings, DEFAULT_CLAUDE_CODE_POLICY, splitCommandLine } from "../src/domain/policy.js";
import { DEFAULT_GOVERNANCE, type Asset } from "../src/domain/types.js";

function asset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 1,
    key: "test",
    name: "Test",
    type: "agent",
    description: "",
    purpose: "",
    status: "draft",
    ownerId: 1,
    teamId: 1,
    repositoryUrl: "https://git.example.com/test",
    environments: [],
    dataClassification: "internal",
    processesPersonalData: false,
    exposure: "local",
    autonomyLevel: 1,
    humanInTheLoop: true,
    sandboxed: true,
    secretsManagement: "none",
    models: ["claude-sonnet-5-5"],
    capabilities: [],
    tags: [],
    permissions: ["fs.read"],
    dependencies: [],
    mcpTransport: null,
    mcpEndpoint: null,
    monthlyBudgetUsd: 100,
    lastReviewAt: null,
    reviewIntervalDays: null,
    approvalRound: 1,
    createdBy: 1,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

function ctx(a: Asset, overrides: Partial<FindingContext> = {}): FindingContext {
  const risk = assessRisk(a);
  return {
    now: new Date("2026-10-23T12:00:00Z"),
    settings: DEFAULT_GOVERNANCE,
    risk,
    requiredApprovals: requiredApprovals(a, risk, DEFAULT_GOVERNANCE),
    approvalDecisions: [],
    ownerActive: true,
    dependencies: [],
    mtdCostUsd: 0,
    forecastUsd: 0,
    ...overrides,
  };
}

describe("risk assessment", () => {
  it("rates a local read-only helper as low risk", () => {
    const r = assessRisk(asset());
    assert.equal(r.level, "low");
    assert.ok(r.score < 20);
  });

  it("rates an autonomous, internet-facing agent with production access as critical", () => {
    const r = assessRisk(
      asset({
        exposure: "public",
        dataClassification: "confidential",
        processesPersonalData: true,
        autonomyLevel: 3,
        humanInTheLoop: false,
        sandboxed: false,
        permissions: ["shell.exec", "net.outbound", "prod.write", "secrets.read"],
      }),
    );
    assert.equal(r.level, "critical");
    assert.equal(r.score, 100);
    assert.ok(r.factors.some((f) => f.label.includes("Exfiltrationsrisiko")));
  });

  it("explains every point with a factor", () => {
    const r = assessRisk(asset({ exposure: "internal", permissions: ["fs.read", "vcs.write"] }));
    assert.equal(
      r.factors.reduce((s, f) => s + f.points, 0),
      r.score,
    );
  });
});

describe("approvals", () => {
  it("requires only the team lead for low-risk assets", () => {
    const a = asset();
    const req = requiredApprovals(a, assessRisk(a), DEFAULT_GOVERNANCE);
    assert.deepEqual(
      req.map((r) => r.role),
      ["team_lead"],
    );
  });

  it("adds security, privacy and finance where the attributes demand it", () => {
    const a = asset({ exposure: "public", processesPersonalData: true, monthlyBudgetUsd: 2500 });
    const roles = requiredApprovals(a, assessRisk(a), DEFAULT_GOVERNANCE).map((r) => r.role);
    for (const role of ["team_lead", "security", "privacy", "finance"]) assert.ok(roles.includes(role as never), role);
  });

  it("always involves architecture for MCP servers", () => {
    const a = asset({ type: "mcp_server" });
    const roles = requiredApprovals(a, assessRisk(a), DEFAULT_GOVERNANCE).map((r) => r.role);
    assert.ok(roles.includes("architecture"));
  });

  it("computes the approval state", () => {
    const req = [
      { role: "team_lead" as const, reason: "" },
      { role: "security" as const, reason: "" },
    ];
    assert.equal(approvalState(req, [{ role: "team_lead", decision: "approved" }]), "pending");
    assert.equal(
      approvalState(req, [
        { role: "team_lead", decision: "approved" },
        { role: "security", decision: "approved" },
      ]),
      "complete",
    );
    assert.equal(approvalState(req, [{ role: "security", decision: "rejected" }]), "rejected");
  });

  it("detects risk-relevant changes but ignores cosmetic ones", () => {
    const before = asset();
    assert.deepEqual(riskRelevantChanges(before, { ...before, description: "neu", tags: ["x"] }), []);
    assert.deepEqual(riskRelevantChanges(before, { ...before, permissions: ["fs.read", "shell.exec"] }), ["permissions"]);
    assert.deepEqual(riskRelevantChanges(before, { ...before, permissions: [...before.permissions].reverse() }), []);
  });
});

describe("findings", () => {
  it("flags a public asset in operation without security approval", () => {
    const a = asset({ status: "active", exposure: "public" });
    const ids = evaluateFindings(a, ctx(a)).map((f) => f.ruleId);
    assert.ok(ids.includes("SEC-01"));
    assert.ok(ids.includes("GOV-01"));
  });

  it("clears SEC-01 and GOV-01 once all approvals are given", () => {
    const a = asset({ status: "active", exposure: "public" });
    const c = ctx(a);
    c.approvalDecisions = c.requiredApprovals.map((r) => ({ role: r.role, decision: "approved" as const }));
    const ids = evaluateFindings(a, c).map((f) => f.ruleId);
    assert.ok(!ids.includes("SEC-01"));
    assert.ok(!ids.includes("GOV-01"));
  });

  it("flags autonomous agents with production write access", () => {
    const a = asset({ autonomyLevel: 3, humanInTheLoop: false, permissions: ["prod.deploy"] });
    assert.ok(evaluateFindings(a, ctx(a)).some((f) => f.ruleId === "SEC-02"));
  });

  it("flags unapproved dependencies, overdue reviews and budget overruns", () => {
    const a = asset({ status: "active", lastReviewAt: "2025-01-01T00:00:00Z", monthlyBudgetUsd: 100 });
    const ids = evaluateFindings(
      a,
      ctx(a, {
        dependencies: [{ id: 9, key: "mcp", name: "Wild MCP", type: "mcp_server", status: "draft" }],
        mtdCostUsd: 150,
        forecastUsd: 300,
      }),
    ).map((f) => f.ruleId);
    assert.ok(ids.includes("SEC-05"));
    assert.ok(ids.includes("GOV-03"));
    assert.ok(ids.includes("COST-01"));
    assert.ok(!ids.includes("COST-02"), "COST-02 only fires while still under budget");
  });

  it("flags models outside the model policy", () => {
    const a = asset({ models: ["some-other-model"] });
    assert.ok(evaluateFindings(a, ctx(a)).some((f) => f.ruleId === "GOV-05"));
  });

  it("reports nothing for retired assets", () => {
    const a = asset({ status: "retired", exposure: "public", ownerId: null });
    assert.deepEqual(evaluateFindings(a, ctx(a, { ownerActive: false })), []);
  });
});

describe("redundancy detection", () => {
  const items = [
    {
      id: 1,
      name: "PR Review Bot",
      type: "agent",
      description: "Prüft Pull Requests automatisch auf Codequalität und Sicherheitslücken",
      purpose: "Code-Review beschleunigen",
      capabilities: ["code-review", "pull-requests"],
      tags: ["github"],
    },
    {
      id: 2,
      name: "Review Assistant",
      type: "agent",
      description: "Kommentiert Pull Requests mit Hinweisen zu Codequalität",
      purpose: "Reviews unterstützen",
      capabilities: ["code-review"],
      tags: ["github"],
    },
    {
      id: 3,
      name: "Rechnungs-Extraktor",
      type: "automation",
      description: "Liest Rechnungen aus PDFs und überträgt Beträge ins ERP",
      purpose: "Buchhaltung entlasten",
      capabilities: ["document-extraction"],
      tags: ["finance"],
    },
  ];

  it("tokenizes German and English text without stopwords", () => {
    const tokens = tokenize("Prüft die Pull Requests und the reviews");
    assert.ok(!tokens.includes("die"));
    assert.ok(!tokens.includes("the"));
    assert.ok(tokens.includes("review"));
  });

  it("pairs assets with overlapping purpose and ignores unrelated ones", () => {
    const pairs = findRedundancyPairs(items, 0.3);
    assert.equal(pairs.length, 1);
    assert.deepEqual([pairs[0].id, pairs[0].otherId], [1, 2]);
    assert.deepEqual(pairs[0].sharedCapabilities, ["code-review"]);
  });

  it("finds similar existing assets for an unsaved draft", () => {
    const draft = {
      id: 0,
      name: "Automatischer Code Review",
      type: "agent",
      description: "Bewertet Pull Requests",
      purpose: "",
      capabilities: ["code-review"],
      tags: [],
    };
    const matches = findSimilar(draft, items);
    assert.deepEqual(matches.map((m) => m.id).sort(), [1, 2]);
  });
});

describe("costs", () => {
  it("prices token usage per model", () => {
    const price = findPrice("claude-sonnet-5-5", DEFAULT_MODEL_PRICES);
    const cost = priceUsage(
      { inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 2_000_000, cacheWriteTokens: 0 },
      price,
    );
    assert.equal(cost, 2 + 1 + 0.4);
  });

  it("resolves suffixed model ids by prefix", () => {
    assert.equal(findPrice("claude-opus-5-5[1m]", DEFAULT_MODEL_PRICES)?.model, "claude-opus-5-5");
    assert.equal(findPrice("unknown-model", DEFAULT_MODEL_PRICES), undefined);
  });

  it("forecasts the month linearly", () => {
    const w = monthWindow(new Date("2026-10-10T08:00:00Z"));
    assert.equal(w.start, "2026-10-01");
    assert.equal(w.end, "2026-11-01");
    assert.equal(w.daysInMonth, 31);
    assert.equal(forecastMonth(100, w), 310);
  });
});

describe("Claude Code policy generation", () => {
  it("splits command lines with quotes", () => {
    assert.deepEqual(splitCommandLine(`npx -y "@acme/mcp server" --flag='a b'`), ["npx", "-y", "@acme/mcp server", "--flag=a b"]);
  });

  it("allows approved MCP servers and denies rejected ones", () => {
    const { settings, allowedServers, deniedServers } = buildManagedSettings(DEFAULT_CLAUDE_CODE_POLICY, [
      { key: "gh", name: "GitHub", status: "active", transport: "http", endpoint: "https://api.githubcopilot.com/*" },
      {
        key: "fs",
        name: "Filesystem",
        status: "approved",
        transport: "stdio",
        endpoint: "npx -y @modelcontextprotocol/server-filesystem .",
      },
      { key: "bad", name: "Bad", status: "rejected", transport: "http", endpoint: "https://bad.example.com/*" },
      { key: "draft", name: "Draft", status: "in_review", transport: "http", endpoint: "https://draft.example.com/*" },
    ]);
    assert.deepEqual(settings.allowedMcpServers, [
      { serverUrl: "https://api.githubcopilot.com/*" },
      { serverCommand: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "."] },
    ]);
    assert.deepEqual(settings.deniedMcpServers, [{ serverUrl: "https://bad.example.com/*" }]);
    assert.equal(settings.allowManagedMcpServersOnly, true);
    assert.deepEqual(allowedServers, ["GitHub", "Filesystem"]);
    assert.deepEqual(deniedServers, ["Bad"]);
    assert.deepEqual((settings.permissions as Record<string, unknown>).disableBypassPermissionsMode, "disable");
  });

  it("warns when the managed allowlist would block every MCP server", () => {
    const { warnings } = buildManagedSettings(DEFAULT_CLAUDE_CODE_POLICY, []);
    assert.ok(warnings.some((w) => w.includes("alle MCP-Server")));
  });
});
