#!/usr/bin/env node
/**
 * Agent Prism Collector
 *
 * Runs on each developer's machine. Reads local Claude Code session data,
 * process list, and open ports, then pushes a snapshot to the central
 * Agent Prism server every --interval seconds.
 *
 * Usage:
 *   node collector.js --url https://agent-prism.onrender.com --key acp_... [--interval 30] [--developer you@company.com]
 *
 * Or with npx once published:
 *   npx agent-prism-collector --url ... --key ...
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import { join } from "node:path";

const execAsync = promisify(exec);

// ── CLI args ──────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      args[key] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    }
  }
  return args;
}

const args = parseArgs(process.argv);

const SERVER_URL = args.url || process.env.AGENT_PRISM_URL;
const API_KEY    = args.key || process.env.AGENT_PRISM_KEY;
const INTERVAL   = parseInt(args.interval || process.env.AGENT_PRISM_INTERVAL || "30") * 1000;
const DEVELOPER  = args.developer || process.env.AGENT_PRISM_DEVELOPER || os.userInfo().username;
const MACHINE_ID = args["machine-id"] || process.env.AGENT_PRISM_MACHINE_ID || `${os.hostname()}-${os.userInfo().username}`;
const VERBOSE    = args.verbose || false;

if (!SERVER_URL || !API_KEY) {
  console.error(`
Agent Prism Collector — missing required arguments.

Usage:
  node collector.js --url <server-url> --key <acp_...> [options]

Options:
  --url         Agent Prism server URL (or AGENT_PRISM_URL env var)
  --key         Tenant API key acp_... (or AGENT_PRISM_KEY env var)
  --interval    Push interval in seconds (default: 30)
  --developer   Developer identifier, e.g. email (default: OS username)
  --machine-id  Unique machine ID (default: hostname-username)
  --verbose     Log each push

Example:
  node collector.js --url https://agent-prism.onrender.com --key acp_abc123 --developer alice@acme.com
`);
  process.exit(1);
}

// ── Scanners (same logic as server.js local scan) ────────────────────────────

const MODEL_CTX = 200000;

async function scanSessions() {
  const claudeDir = join(os.homedir(), ".claude", "projects");
  const sessions = [];
  const now = Date.now();
  const cutoff = now - 48 * 60 * 60 * 1000;

  try {
    const projectDirs = await readdir(claudeDir);
    for (const projectDir of projectDirs) {
      const projectPath = join(claudeDir, projectDir);
      const pStat = await stat(projectPath).catch(() => null);
      if (!pStat?.isDirectory()) continue;

      const files = await readdir(projectPath).catch(() => []);
      for (const file of files.filter((f) => f.endsWith(".jsonl"))) {
        const filePath = join(projectPath, file);
        const fStat = await stat(filePath).catch(() => null);
        if (!fStat || fStat.mtimeMs < cutoff) continue;

        const content = await readFile(filePath, "utf-8").catch(() => "");
        const lines = content.trim().split("\n").filter(Boolean);

        const session = {
          sessionId: file.replace(".jsonl", ""),
          projectDir,
          model: null, version: null, gitBranch: null, cwd: null,
          totalInputTokens: 0, totalOutputTokens: 0,
          totalCacheRead: 0, lastContextTokens: 0,
          turnCount: 0, lastActivity: null, summary: null,
          agentType: "Claude Code", status: "idle",
          fileSizeKb: Math.round(fStat.size / 1024)
        };

        for (const line of lines) {
          try {
            const msg = JSON.parse(line);
            if (msg.cwd && !session.cwd) session.cwd = msg.cwd;
            if (msg.gitBranch && !session.gitBranch) session.gitBranch = msg.gitBranch;
            if (msg.version && !session.version) session.version = msg.version;

            if (msg.type === "assistant" && msg.message?.usage) {
              const u = msg.message.usage;
              session.totalInputTokens += u.input_tokens || 0;
              session.totalOutputTokens += u.output_tokens || 0;
              session.totalCacheRead += u.cache_read_input_tokens || 0;
              session.lastContextTokens =
                (u.cache_read_input_tokens || 0) +
                (u.input_tokens || 0) +
                (u.cache_creation_input_tokens || 0);
              if (!session.model && msg.message.model) session.model = msg.message.model;
            }

            if (msg.type === "user" && msg.message?.role === "user") {
              session.turnCount++;
              if (!session.summary) {
                const c = msg.message.content;
                const text = typeof c === "string" ? c : (Array.isArray(c) ? (c.find((x) => x.type === "text")?.text || "") : "");
                if (text.length > 3) session.summary = text.slice(0, 72);
              }
            }

            if (msg.timestamp) {
              const ts = new Date(msg.timestamp).getTime();
              if (!session.lastActivity || ts > session.lastActivity) session.lastActivity = ts;
            }
          } catch {}
        }

        if (session.lastActivity) {
          const ageMins = (now - session.lastActivity) / 60000;
          session.status = ageMins < 5 ? "active" : ageMins < 60 ? "recent" : "idle";
        }
        session.contextPct = session.lastContextTokens
          ? Math.min(100, Math.round((session.lastContextTokens / MODEL_CTX) * 100))
          : 0;

        sessions.push(session);
      }
    }
  } catch {}

  return sessions.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));
}

async function scanProcesses() {
  try {
    const { stdout } = await execAsync("ps aux | grep -E '(claude|codex|opencode|aider)' | grep -v grep 2>/dev/null", { timeout: 5000 });
    const agentPatterns = [
      { match: /\bclaude\b/i, type: "Claude Code" },
      { match: /\bcodex\b/i, type: "Codex CLI" },
      { match: /\bopencode\b/i, type: "OpenCode" },
      { match: /\baider\b/i, type: "Aider" },
    ];
    return stdout.trim().split("\n").filter(Boolean).map((line) => {
      const parts = line.trim().split(/\s+/);
      const cmd = parts.slice(10).join(" ");
      let type = "Unknown";
      for (const p of agentPatterns) { if (p.match.test(cmd)) { type = p.type; break; } }
      return { pid: parts[1], cpu: parseFloat(parts[2]), mem: parseFloat(parts[3]), cmd: cmd.slice(0, 80), type };
    });
  } catch { return []; }
}

async function scanPorts() {
  const agentProcPatterns = ["node", "claude", "codex", "opencode", "python", "python3", "deno", "bun", "ollama", "aider"];
  try {
    const { stdout } = await execAsync("lsof -i -P -n 2>/dev/null | grep LISTEN", { timeout: 5000 });
    const seen = new Set();
    return stdout.trim().split("\n").filter(Boolean).flatMap((line) => {
      const parts = line.trim().split(/\s+/);
      const portMatch = (parts[8] || "").match(/:(\d+)$/);
      if (!portMatch) return [];
      const port = parseInt(portMatch[1]);
      if (port < 1024 || seen.has(port)) return [];
      seen.add(port);
      const proc = parts[0].toLowerCase();
      const isAgentPort = agentProcPatterns.some((p) => proc.includes(p));
      return [{ port, pid: parts[1], process: parts[0], isAgentPort }];
    });
  } catch { return []; }
}

// ── Push snapshot ─────────────────────────────────────────────────────────────

async function collectAndPush() {
  const [sessions, processes, ports] = await Promise.all([
    scanSessions(),
    scanProcesses(),
    scanPorts()
  ]);

  const snapshot = {
    machineId: MACHINE_ID,
    hostname: os.hostname(),
    developer: DEVELOPER,
    platform: process.platform,
    sessions,
    processes,
    ports,
    collectorVersion: "1.0.0",
    ts: Date.now()
  };

  const res = await fetch(`${SERVER_URL}/api/fleet/ingest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY
    },
    body: JSON.stringify(snapshot)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`${res.status} ${err.message || err.error || "push failed"}`);
  }

  return { sessions: sessions.length, processes: processes.length, ports: ports.filter((p) => p.isAgentPort).length };
}

// ── Main loop ─────────────────────────────────────────────────────────────────

async function run() {
  console.log(`[agent-prism-collector] starting`);
  console.log(`  server:    ${SERVER_URL}`);
  console.log(`  machine:   ${MACHINE_ID}`);
  console.log(`  developer: ${DEVELOPER}`);
  console.log(`  interval:  ${INTERVAL / 1000}s`);
  console.log();

  const push = async () => {
    try {
      const stats = await collectAndPush();
      if (VERBOSE) {
        console.log(`[${new Date().toISOString()}] pushed — sessions:${stats.sessions} procs:${stats.processes} ports:${stats.ports}`);
      } else {
        process.stdout.write(".");
      }
    } catch (err) {
      console.error(`\n[agent-prism-collector] push failed: ${err.message}`);
    }
  };

  await push();
  setInterval(push, INTERVAL);
}

run();
