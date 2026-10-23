import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Finding = { repoUrl: string; path: string; kind: string; details: Record<string, unknown> };
const scannerPath = new URL("../../scripts/mackaidmin-scan.mjs", import.meta.url).href;

describe("shadow-AI scanner", () => {
  it("detects Claude artefacts without leaking credentials or secrets", async () => {
    const { scanRepo } = (await import(scannerPath)) as { scanRepo: (dir: string) => Finding[] };
    const repo = mkdtempSync(join(tmpdir(), "mka-scan-"));
    try {
      mkdirSync(join(repo, ".git"));
      mkdirSync(join(repo, ".claude"));
      writeFileSync(
        join(repo, ".git", "config"),
        '[remote "origin"]\n\turl = https://bot:hunter2@git.example.com/team/app.git\n',
      );
      writeFileSync(join(repo, "CLAUDE.md"), "# App");
      writeFileSync(
        join(repo, ".claude", "settings.json"),
        JSON.stringify({ permissions: { defaultMode: "bypassPermissions" } }),
      );
      writeFileSync(
        join(repo, ".mcp.json"),
        JSON.stringify({ mcpServers: { db: { command: "npx", args: ["-y", "pg-mcp"], env: { PGPASSWORD: "top-secret" } } } }),
      );
      writeFileSync(join(repo, "requirements.txt"), "anthropic>=1.0\n");

      const findings = scanRepo(repo);
      const kinds = findings.map((f) => f.kind).sort();
      assert.deepEqual(kinds, ["anthropic_sdk", "claude_md", "claude_settings", "mcp_config"]);
      assert.ok(findings.every((f) => f.repoUrl === "https://git.example.com/team/app.git"));
      assert.equal(findings.find((f) => f.kind === "claude_settings")?.details.bypassPermissions, true);
      const serialized = JSON.stringify(findings);
      assert.ok(!serialized.includes("hunter2"), "remote credentials must be stripped");
      assert.ok(!serialized.includes("top-secret"), "MCP env values must never be reported");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
