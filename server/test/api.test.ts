import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { openDatabase, run, type DB } from "../src/db/database.js";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { hashPassword } from "../src/auth/auth.js";
import { syncClaudeCodeUsage } from "../src/integrations/anthropic.js";
import { DEMO_PASSWORD, seedDemoData } from "../src/db/seed.js";

let db: DB;
let server: Server;
let base: string;

class Client {
  cookie = "";
  constructor(private token?: string) {}
  async req(method: string, path: string, body?: unknown, contentType = "application/json") {
    const headers: Record<string, string> = {};
    if (this.cookie) headers.cookie = this.cookie;
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (body !== undefined || method !== "GET") headers["content-type"] = contentType;
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers,
      body: body === undefined ? (method === "GET" ? undefined : "{}") : typeof body === "string" ? body : JSON.stringify(body),
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, raw: text };
  }
  get = (p: string) => this.req("GET", p);
  post = (p: string, b?: unknown) => this.req("POST", p, b);
  put = (p: string, b?: unknown) => this.req("PUT", p, b);
}

async function login(email: string, password = "passwort-1234") {
  const c = new Client();
  const res = await c.post("/auth/login", { email, password });
  assert.equal(res.status, 200, `login ${email}: ${res.raw}`);
  return c;
}

before(async () => {
  db = openDatabase(":memory:");
  const team = Number(run(db, "INSERT INTO teams (name) VALUES ('Team A')").lastInsertRowid);
  const add = (email: string, roles: string[]) =>
    run(db, "INSERT INTO people (email, name, roles, team_id, password_hash) VALUES (:e, :n, :r, :t, :p)", {
      e: email,
      n: email.split("@")[0],
      r: JSON.stringify(roles),
      t: team,
      p: hashPassword("passwort-1234"),
    });
  add("admin@test.local", ["admin"]);
  add("dev@test.local", ["developer"]);
  add("lead@test.local", ["team_lead"]);
  add("sec@test.local", ["security"]);
  add("arch@test.local", ["architecture"]);
  add("viewer@test.local", ["viewer"]);
  const app = createApp(db, { ...loadConfig({}), databasePath: ":memory:", cookieSecure: false, staticDir: null });
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
});

describe("authentication", () => {
  it("rejects wrong passwords and unauthenticated access", async () => {
    const c = new Client();
    assert.equal((await c.post("/auth/login", { email: "dev@test.local", password: "falsch-falsch" })).status, 401);
    assert.equal((await c.get("/assets")).status, 401);
  });

  it("logs in and returns the current user", async () => {
    const c = await login("dev@test.local");
    const me = await c.get("/auth/me");
    assert.equal(me.body.email, "dev@test.local");
    assert.deepEqual(me.body.roles, ["developer"]);
  });

  it("blocks cookie-authenticated mutations without a JSON content type (CSRF)", async () => {
    const c = await login("dev@test.local");
    const res = await c.req("POST", "/assets", "name=x", "application/x-www-form-urlencoded");
    assert.equal(res.status, 415);
  });

  it("forbids viewers from registering assets", async () => {
    const c = await login("viewer@test.local");
    assert.equal((await c.post("/assets", { name: "Test", type: "agent" })).status, 403);
  });
});

describe("asset lifecycle and approvals", () => {
  let assetId: number;

  it("registers an asset and previews similar ones", async () => {
    const dev = await login("dev@test.local");
    const created = await dev.post("/assets", {
      name: "Ticket-Klassifizierer",
      type: "agent",
      description: "Klassifiziert Support-Tickets nach Dringlichkeit",
      capabilities: ["ticket-triage"],
      exposure: "internal",
      permissions: [{ key: "db.read", justification: "Ticket-DB lesen" }],
    });
    assert.equal(created.status, 201, created.raw);
    assetId = created.body.id;

    const preview = await dev.post("/assets/preview", {
      name: "Ticket Triage Bot",
      type: "agent",
      description: "Klassifiziert eingehende Support-Tickets",
      capabilities: ["ticket-triage"],
      exposure: "public",
    });
    assert.equal(preview.status, 200, preview.raw);
    assert.equal(preview.body.similar[0].id, assetId);
    assert.ok(preview.body.requiredApprovals.some((r: { role: string }) => r.role === "security"));
  });

  it("enforces the four-eyes principle and completes the approval", async () => {
    const dev = await login("dev@test.local");
    const submit = await dev.post(`/assets/${assetId}/transition`, { to: "in_review" });
    assert.equal(submit.status, 200, submit.raw);

    const detail = await dev.get(`/assets/${assetId}`);
    const pending = detail.body.approvals.filter((a: { decision: string }) => a.decision === "pending");
    assert.ok(pending.length >= 1);

    // Owner cannot approve – even if they had the role, the asset is their own.
    const own = await dev.post(`/approvals/${pending[0].id}/decide`, { decision: "approved" });
    assert.equal(own.status, 403);

    for (const approval of pending) {
      const approver = await login(
        approval.role === "team_lead" ? "lead@test.local" : approval.role === "security" ? "sec@test.local" : "arch@test.local",
      );
      const res = await approver.post(`/approvals/${approval.id}/decide`, { decision: "approved", comment: "ok" });
      assert.equal(res.status, 200, res.raw);
    }
    const approved = await dev.get(`/assets/${assetId}`);
    assert.equal(approved.body.asset.status, "approved");
    assert.equal(approved.body.approvalState, "complete");

    const live = await dev.post(`/assets/${assetId}/transition`, { to: "active" });
    assert.equal(live.status, 200, live.raw);
  });

  it("starts a new approval round after a risk-relevant change", async () => {
    const dev = await login("dev@test.local");
    const current = (await dev.get(`/assets/${assetId}`)).body.asset;
    const update = await dev.put(`/assets/${assetId}`, {
      ...current,
      permissions: [
        { key: "db.read", justification: "" },
        { key: "secrets.read", justification: "API-Key für Ticketsystem" },
      ],
    });
    assert.equal(update.status, 200, update.raw);
    assert.equal(update.body.newApprovalRound, true);

    const detail = (await dev.get(`/assets/${assetId}`)).body;
    assert.equal(detail.asset.approvalRound, 2);
    assert.equal(detail.approvalState, "pending");
    assert.ok(detail.findings.some((f: { ruleId: string }) => f.ruleId === "GOV-01"));
  });

  it("blocks go-live while critical findings are open", async () => {
    const dev = await login("dev@test.local");
    const created = await dev.post("/assets", {
      name: "Öffentlicher Agent",
      type: "agent",
      exposure: "public",
      permissions: [],
    });
    const id = created.body.id;
    await dev.post(`/assets/${id}/transition`, { to: "in_review" });
    const detail = (await dev.get(`/assets/${id}`)).body;
    // Approve everything except security → status stays in review.
    for (const a of detail.approvals.filter((x: { role: string }) => x.role !== "security")) {
      await (await login("lead@test.local")).post(`/approvals/${a.id}/decide`, { decision: "approved" });
    }
    assert.equal((await dev.post(`/assets/${id}/transition`, { to: "active" })).status, 409);
  });

  it("does not carry approvals over a withdraw → change → resubmit cycle", async () => {
    const dev = await login("dev@test.local");
    const id = (await dev.post("/assets", { name: "Partner-Portal-Agent", type: "agent", exposure: "partner" })).body.id;
    await dev.post(`/assets/${id}/transition`, { to: "in_review" });
    const lead = await login("lead@test.local");
    const tl = (await dev.get(`/assets/${id}`)).body.approvals.find((a: { role: string }) => a.role === "team_lead");
    assert.equal((await lead.post(`/approvals/${tl.id}/decide`, { decision: "approved" })).status, 200);

    assert.equal((await dev.post(`/assets/${id}/transition`, { to: "draft" })).status, 200);
    const current = (await dev.get(`/assets/${id}`)).body.asset;
    await dev.put(`/assets/${id}`, { ...current, permissions: [{ key: "secrets.read", justification: "" }] });
    await dev.post(`/assets/${id}/transition`, { to: "in_review" });

    const detail = (await dev.get(`/assets/${id}`)).body;
    assert.equal(detail.asset.approvalRound, 2);
    const round2 = detail.approvals.filter((a: { round: number }) => a.round === 2);
    assert.ok(round2.length > 0 && round2.every((a: { decision: string }) => a.decision === "pending"));
  });

  it("requires a justification when rejecting", async () => {
    const dev = await login("dev@test.local");
    const id = (await dev.post("/assets", { name: "Noch ein Agent", type: "agent" })).body.id;
    await dev.post(`/assets/${id}/transition`, { to: "in_review" });
    const approval = (await dev.get(`/assets/${id}`)).body.approvals[0];
    const lead = await login("lead@test.local");
    assert.equal((await lead.post(`/approvals/${approval.id}/decide`, { decision: "rejected" })).status, 409);
    assert.equal((await lead.post(`/approvals/${approval.id}/decide`, { decision: "rejected", comment: "Doppelt" })).status, 200);
    assert.equal((await dev.get(`/assets/${id}`)).body.asset.status, "rejected");
  });
});

describe("API tokens, usage ingest and policy distribution", () => {
  it("ingests usage only for registered assets", async () => {
    const admin = await login("admin@test.local");
    const token = (await admin.post("/tokens", { name: "CI", scopes: ["usage:write"] })).body.token as string;
    const ci = new Client(token);
    const ok = await ci.post("/costs/usage", {
      date: new Date().toISOString().slice(0, 10),
      assetKey: "ticket-klassifizierer",
      model: "claude-sonnet-5-5",
      inputTokens: 1_000_000,
      outputTokens: 100_000,
    });
    assert.equal(ok.status, 201, ok.raw);
    assert.equal(ok.body.costUsd, 3);

    const unknown = await ci.post("/costs/usage", { date: "2026-10-01", assetKey: "gibt-es-nicht", model: "claude-sonnet-5-5" });
    assert.equal(unknown.status, 400);

    // The token's scope does not cover other endpoints.
    assert.equal((await ci.get("/policies/claude-code/managed-settings.json")).status, 403);
  });

  it("publishes approved MCP servers in managed-settings.json", async () => {
    const admin = await login("admin@test.local");
    const dev = await login("dev@test.local");
    const id = (
      await dev.post("/assets", {
        name: "Interner Wiki-MCP",
        type: "mcp_server",
        mcpTransport: "http",
        mcpEndpoint: "https://wiki-mcp.intern.example/*",
      })
    ).body.id;
    await dev.post(`/assets/${id}/transition`, { to: "in_review" });
    for (const a of (await dev.get(`/assets/${id}`)).body.approvals) {
      await admin.post(`/approvals/${a.id}/decide`, { decision: "approved" });
    }
    const token = (await admin.post("/tokens", { name: "MDM", scopes: ["policy:read"] })).body.token as string;
    const res = await new Client(token).get("/policies/claude-code/managed-settings.json");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.allowedMcpServers, [{ serverUrl: "https://wiki-mcp.intern.example/*" }]);
    assert.equal(res.body.permissions.disableBypassPermissionsMode, "disable");
  });
});

describe("discovery", () => {
  it("links findings to registered repositories and flags the rest as shadow AI", async () => {
    const admin = await login("admin@test.local");
    const dev = await login("dev@test.local");
    await dev.post("/assets", { name: "Repo-Agent", type: "agent", repositoryUrl: "https://git.example.com/team/repo-agent" });
    const res = await admin.post("/discovery/reports", {
      source: "test",
      findings: [
        { repoUrl: "git@git.example.com:team/repo-agent.git", path: "CLAUDE.md", kind: "claude_md" },
        { repoUrl: "https://git.example.com/team/unknown", path: "app.py", kind: "anthropic_sdk" },
      ],
    });
    assert.equal(res.status, 201, res.raw);
    assert.deepEqual(res.body, { created: 2, updated: 0, linked: 1 });
    const open = await admin.get("/discovery?status=new");
    assert.equal(open.body.length, 1);
    assert.equal(open.body[0].repoUrl, "https://git.example.com/team/unknown");

    // ssh and https remotes of the same repository are stored once
    const again = await admin.post("/discovery/reports", {
      findings: [{ repoUrl: "git@git.example.com:team/unknown.git", path: "app.py", kind: "anthropic_sdk" }],
    });
    assert.deepEqual(again.body, { created: 0, updated: 1, linked: 0 });
  });
});

describe("Anthropic Claude Code sync", () => {
  it("maps the analytics report onto usage records and is idempotent", async () => {
    const sample = {
      data: [
        {
          date: "2026-10-20T00:00:00Z",
          actor: { type: "user_actor", email_address: "DEV@test.local" },
          organization_id: "org",
          customer_type: "api",
          terminal_type: "vscode",
          core_metrics: {
            num_sessions: 3,
            lines_of_code: { added: 120, removed: 30 },
            commits_by_claude_code: 1,
            pull_requests_by_claude_code: 0,
          },
          model_breakdown: [
            {
              model: "claude-opus-5-5",
              tokens: { input: 1000, output: 500, cache_read: 0, cache_creation: 0 },
              estimated_cost: { currency: "USD", amount: 250 },
            },
            {
              model: "claude-haiku-5-5",
              tokens: { input: 1000, output: 500, cache_read: 0, cache_creation: 0 },
              estimated_cost: { currency: "USD", amount: 10 },
            },
          ],
        },
      ],
      has_more: false,
      next_page: null,
    };
    const calls: string[] = [];
    const fakeFetch = (async (url: URL, init?: RequestInit) => {
      calls.push(String(url));
      assert.equal((init?.headers as Record<string, string>)["x-api-key"], "sk-ant-admin-test");
      return new Response(JSON.stringify(sample), { status: 200 });
    }) as unknown as typeof fetch;

    const opts = {
      adminKey: "sk-ant-admin-test",
      apiBase: "https://api.example",
      from: "2026-10-20",
      to: "2026-10-20",
      fetchImpl: fakeFetch,
    };
    const first = await syncClaudeCodeUsage(db, opts);
    assert.equal(first.records, 2);
    assert.equal(first.costUsd, 2.6);
    assert.deepEqual(first.unknownActors, []);
    assert.ok(calls[0].includes("/v1/organizations/usage_report/claude_code?starting_at=2026-10-20"));

    await syncClaudeCodeUsage(db, opts);
    const rows = db
      .prepare("SELECT COUNT(*) AS n, SUM(sessions) AS s FROM usage_records WHERE source = 'anthropic_claude_code'")
      .get() as {
      n: number;
      s: number;
    };
    assert.equal(rows.n, 2, "re-sync must not duplicate records");
    assert.equal(rows.s, 3, "sessions are counted once per record");
  });
});

describe("demo data", () => {
  it("seeds a consistent demo organisation", async () => {
    const demo = openDatabase(":memory:");
    seedDemoData(demo);
    const app = createApp(demo, { ...loadConfig({}), databasePath: ":memory:", cookieSecure: false, staticDir: null });
    const s = app.listen(0);
    await new Promise((r) => s.once("listening", r));
    const prev = base;
    base = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
    try {
      const c = await login("admin@demo.local", DEMO_PASSWORD);
      const dash = (await c.get("/dashboard")).body;
      assert.ok(dash.assets.total >= 15);
      assert.ok(dash.findings.openBySeverity.critical >= 1);
      assert.ok(dash.redundancy.open >= 1);
      assert.ok(dash.licenses.inactiveSeats >= 2);
      const policy = (await c.get("/policies")).body;
      assert.ok(policy.generated.allowedServers.includes("GitHub MCP-Server"));
      assert.ok(policy.generated.deniedServers.includes("Web-Scraper MCP (Community)"));
    } finally {
      base = prev;
      s.close();
    }
  });
});
