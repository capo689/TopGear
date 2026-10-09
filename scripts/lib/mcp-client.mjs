/**
 * A minimal MCP stdio client for gates: unpack the artifact, spawn ITS server, speak JSON-RPC.
 *
 * Gates must exercise the shipped artifact through the MCP tool surface (docs/engineering/STANDING_LAW.md), so this is
 * deliberately a client of the bundle's own `server/index.js` — not an import of workspace code.
 */
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Unpack `artifact.path` and start its server. `env` is merged over the current process env. */
export function startArtifactServer(artifact, env = {}) {
  const unpacked = mkdtempSync(join(tmpdir(), "bb-mcpb-run-"));
  execFileSync("unzip", ["-q", "-o", artifact.path, "-d", unpacked]);
  const serverJs = join(unpacked, "server/index.js");
  const source = readFileSync(serverJs, "utf8");
  /**
   * The .mcpb is a zip and zips embed mtimes, so the BUNDLE sha changes on every rebuild even
   * when nothing changed. The stable identity of "what code is in there" is the hash of the
   * server bundle itself — report both: the .mcpb sha says WHICH FILE, this says WHICH CODE.
   */
  const serverSha256 = createHash("sha256").update(source).digest("hex");

  const stderr = [];
  const proc = spawn("node", [serverJs], {
    cwd: unpacked,
    env: { ...process.env, BB_HEADLESS: "true", ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  proc.stderr.on("data", (c) => stderr.push(c.toString()));

  let buf = "";
  const pending = new Map();
  proc.stdout.on("data", (chunk) => {
    buf += chunk.toString();
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      const r = pending.get(msg.id);
      if (r) {
        pending.delete(msg.id);
        r(msg);
      }
    }
  });

  let nextId = 1;
  const rpc = (method, params) => {
    const id = nextId++;
    return new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error(`timeout on ${method}`)), 180_000);
      pending.set(id, (m) => {
        clearTimeout(timer);
        m.error ? rej(new Error(`${method}: ${JSON.stringify(m.error)}`)) : res(m.result);
      });
      proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  };
  const notify = (method, params) => proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");

  return {
    /** Source of the bundle's server, for fingerprinting the fix INSIDE the artifact. */
    source,
    /** sha256 of the bundle's server/index.js — stable across rebuilds of identical code. */
    serverSha256,
    /** Everything the server wrote to stderr (D5's startup line lands here). */
    stderrText: () => stderr.join(""),
    rpc,
    notify,
    /** Call a bridge tool and parse the JSON payload it returns. */
    async tool(name, args) {
      const r = await rpc("tools/call", { name, arguments: args });
      return JSON.parse(r.content[0].text);
    },
    async handshake() {
      await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "bb-gate", version: "1" } });
      notify("notifications/initialized", {});
    },
    stop() {
      proc.stdin.end();
      proc.kill();
      rmSync(unpacked, { recursive: true, force: true });
    },
  };
}

/** A TaskGrant scoped to one origin — what every gate binds. */
export function grantFor(origin, taskId) {
  return {
    taskId,
    allowedOrigins: [origin],
    allowedRiskTiers: ["low", "medium"],
    sensitiveDataDestinations: [],
    budgets: { maxPages: 5, maxTabs: 2 },
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  };
}
