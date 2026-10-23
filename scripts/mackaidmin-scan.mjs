#!/usr/bin/env node
// MackAIdmin Shadow-AI scanner.
//
// Walks a directory of repository checkouts and reports Claude/AI artefacts to MackAIdmin:
// CLAUDE.md, .claude/ settings, agents, skills and hooks, .mcp.json, Anthropic SDK / Agent SDK
// usage and Claude in CI. Only metadata is sent (paths, package names, MCP server names and
// URLs/commands) – never file contents, environment values or headers.
//
// Usage:
//   node scripts/mackaidmin-scan.mjs <dir> --server https://mackaidmin.intern --token $MACKAIDMIN_TOKEN
//   node scripts/mackaidmin-scan.mjs <dir> --dry-run
//
// Options:
//   --server <url>     MackAIdmin base URL (or env MACKAIDMIN_URL)
//   --token <token>    API token with scope discovery:write (or env MACKAIDMIN_TOKEN)
//   --source <name>    label for this scan (default: hostname)
//   --max-depth <n>    how deep to look for repositories below <dir> (default 4)
//   --dry-run          print findings, don't send them
//   --json             print findings as JSON

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { hostname } from "node:os";
import { pathToFileURL } from "node:url";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  ".venv",
  "venv",
  "__pycache__",
  ".next",
  ".nuxt",
  ".cache",
  "coverage",
  ".gradle",
  ".idea",
  ".terraform",
]);
const SOURCE_EXT = /\.(py|ts|tsx|js|mjs|cjs|go|java|kt|cs|rb|php)$/;
const MAX_FILES_PER_REPO = 25_000;
const MAX_READ_BYTES = 512 * 1024;

function parseArgs(argv) {
  const opts = {
    dir: ".",
    server: process.env.MACKAIDMIN_URL,
    token: process.env.MACKAIDMIN_TOKEN,
    source: hostname(),
    maxDepth: 4,
    dryRun: false,
    json: false,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--server") opts.server = argv[++i];
    else if (a === "--token") opts.token = argv[++i];
    else if (a === "--source") opts.source = argv[++i];
    else if (a === "--max-depth") opts.maxDepth = Number(argv[++i]);
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--json") opts.json = true;
    else if (a === "-h" || a === "--help") {
      console.log(
        readFileSync(new URL(import.meta.url), "utf8")
          .split("\n")
          .filter((l) => l.startsWith("//"))
          .map((l) => l.slice(3))
          .join("\n"),
      );
      process.exit(0);
    } else rest.push(a);
  }
  if (rest[0]) opts.dir = rest[0];
  return opts;
}

function readText(path) {
  try {
    const st = statSync(path);
    if (!st.isFile() || st.size > MAX_READ_BYTES) return null;
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function readJson(path) {
  const text = readText(path);
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function findRepos(root, maxDepth) {
  const repos = [];
  const walk = (dir, depth) => {
    if (existsSync(join(dir, ".git"))) {
      repos.push(dir);
      return;
    }
    if (depth >= maxDepth) return;
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) walk(join(dir, e.name), depth + 1);
    }
  };
  walk(root, 0);
  return repos;
}

function remoteUrl(repo) {
  let gitDir = join(repo, ".git");
  try {
    if (statSync(gitDir).isFile()) {
      // worktrees / submodules: ".git" is a file pointing to the real git dir
      const m = /gitdir:\s*(.+)/.exec(readFileSync(gitDir, "utf8"));
      if (m) gitDir = resolve(repo, m[1].trim());
    }
  } catch {
    /* ignore */
  }
  const config = readText(join(gitDir, "config")) ?? readText(join(gitDir, "..", "..", "config"));
  if (config) {
    const origin =
      /\[remote "origin"\][^[]*?url\s*=\s*(\S+)/.exec(config) ?? /\[remote "[^"]+"\][^[]*?url\s*=\s*(\S+)/.exec(config);
    if (origin) return origin[1].replace(/\/\/[^/@]+@/, "//"); // strip credentials from https remotes
  }
  return `file://${resolve(repo)}`;
}

function listFiles(repo) {
  const files = [];
  const walk = (dir) => {
    if (files.length >= MAX_FILES_PER_REPO) return;
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(full);
      } else if (e.isFile()) {
        files.push(relative(repo, full).split(sep).join("/"));
        if (files.length >= MAX_FILES_PER_REPO) return;
      }
    }
  };
  walk(repo);
  return files;
}

function mcpServers(json) {
  const servers = json?.mcpServers && typeof json.mcpServers === "object" ? json.mcpServers : {};
  // Deliberately drop env and headers – they may contain secrets.
  return Object.entries(servers).map(([name, s]) => ({
    name,
    type: s?.type ?? (s?.url ? "http" : "stdio"),
    ...(s?.url ? { url: String(s.url) } : {}),
    ...(s?.command ? { command: String(s.command), args: Array.isArray(s.args) ? s.args.map(String) : [] } : {}),
  }));
}

const SDK_PATTERNS = [
  {
    kind: "agent_sdk",
    pkg: "@anthropic-ai/claude-agent-sdk",
    re: /@anthropic-ai\/claude-agent-sdk|@anthropic-ai\/claude-code|claude_agent_sdk|claude_code_sdk/,
  },
  {
    kind: "anthropic_sdk",
    pkg: "anthropic",
    re: /@anthropic-ai\/sdk|^\s*(from|import)\s+anthropic\b|github\.com\/anthropics\/anthropic-sdk-go|com\.anthropic[.:]|Anthropic\.SDK|anthropic-sdk-ruby|anthropic-ai\/sdk-php/m,
  },
];

export function scanRepo(repo) {
  const repoUrl = remoteUrl(repo);
  const files = listFiles(repo);
  const findings = [];
  const add = (kind, path, details = {}) => findings.push({ repoUrl, path, kind, details });

  for (const f of files) {
    if (basename(f) === "CLAUDE.md") add("claude_md", f, { sizeBytes: statSync(join(repo, f)).size });
  }

  for (const f of files.filter((x) => /(^|\/)\.claude\/settings(\.local)?\.json$/.test(x))) {
    const s = readJson(join(repo, f)) ?? {};
    const allow = Array.isArray(s.permissions?.allow) ? s.permissions.allow.map(String) : [];
    add("claude_settings", f, {
      permissionsAllow: allow.slice(0, 50),
      bypassPermissions: s.permissions?.defaultMode === "bypassPermissions",
      broadShell: allow.some((r) => r === "Bash" || r === "Bash(*)" || r === "Bash(**)"),
    });
    if (s.hooks && typeof s.hooks === "object") add("claude_hooks", f, { events: Object.keys(s.hooks) });
  }

  for (const f of files.filter((x) => basename(x) === ".mcp.json")) {
    add("mcp_config", f, { servers: mcpServers(readJson(join(repo, f))) });
  }

  const agents = files.filter((x) => /(^|\/)\.claude\/agents\/[^/]+\.md$/.test(x));
  if (agents.length)
    add("claude_agents", ".claude/agents", { count: agents.length, names: agents.map((a) => basename(a, ".md")).slice(0, 50) });
  const skills = files.filter((x) => /(^|\/)\.claude\/(skills\/[^/]+\/SKILL\.md|commands\/[^/]+\.md)$/.test(x));
  if (skills.length)
    add("claude_skills", ".claude", {
      count: skills.length,
      names: skills.map((s) => s.split("/").slice(-2).join("/")).slice(0, 50),
    });

  // SDK usage: manifests first, then a light scan of source imports.
  const hits = new Map();
  const note = (kind, pkg, file) => {
    const h = hits.get(kind) ?? { pkg, files: new Set() };
    h.files.add(file);
    hits.set(kind, h);
  };
  for (const f of files) {
    const name = basename(f);
    const isManifest =
      [
        "package.json",
        "requirements.txt",
        "pyproject.toml",
        "Pipfile",
        "go.mod",
        "pom.xml",
        "build.gradle",
        "build.gradle.kts",
        "Gemfile",
        "composer.json",
      ].includes(name) ||
      /^requirements.*\.txt$/.test(name) ||
      name.endsWith(".csproj");
    if (!isManifest && !SOURCE_EXT.test(f)) continue;
    const text = readText(join(repo, f));
    if (!text) continue;
    for (const p of SDK_PATTERNS) {
      if (
        p.re.test(text) ||
        (isManifest && p.kind === "anthropic_sdk" && /(^|["'\s])anthropic(\[[\w,]+\])?\s*([=<>~!;"']|$)/m.test(text))
      ) {
        note(p.kind, p.pkg, f);
        break;
      }
    }
  }
  for (const [kind, h] of hits) {
    const list = [...h.files].sort();
    add(kind, list[0], { package: h.pkg, files: list.length, paths: list.slice(0, 20) });
  }

  for (const f of files.filter(
    (x) => /^\.github\/workflows\/.+\.ya?ml$/.test(x) || /(^|\/)\.gitlab-ci\.yml$/.test(x) || /(^|\/)Jenkinsfile$/.test(x),
  )) {
    const text = readText(join(repo, f)) ?? "";
    const action = /uses:\s*(anthropics\/claude-code[\w-]*)/.exec(text)?.[1];
    if (action || /\bclaude\s+-p\b|@anthropic-ai\/claude-code|ANTHROPIC_API_KEY/.test(text)) {
      add("ci_claude", f, { action: action ?? "claude CLI / API key in pipeline" });
    }
  }
  return findings;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const root = resolve(opts.dir);
  const repos = findRepos(root, opts.maxDepth);
  const findings = repos.flatMap(scanRepo);

  if (opts.json) console.log(JSON.stringify({ source: opts.source, findings }, null, 2));
  else {
    console.log(`${repos.length} Repositories durchsucht, ${findings.length} Funde.`);
    for (const f of findings) console.log(`  ${f.kind.padEnd(16)} ${f.repoUrl}  ${f.path}`);
  }
  if (opts.dryRun) return;
  if (!opts.server || !opts.token) {
    console.error("\n--server und --token (oder MACKAIDMIN_URL / MACKAIDMIN_TOKEN) angeben, oder --dry-run verwenden.");
    process.exit(2);
  }
  const res = await fetch(new URL("/api/discovery/reports", opts.server), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${opts.token}` },
    body: JSON.stringify({ source: opts.source, findings }),
  });
  const body = await res.text();
  if (!res.ok) {
    console.error(`Übertragung fehlgeschlagen (${res.status}): ${body}`);
    process.exit(1);
  }
  const r = JSON.parse(body);
  console.log(
    `An MackAIdmin übertragen: ${r.created} neu, ${r.updated} aktualisiert, ${r.linked} registrierten Assets zugeordnet.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
