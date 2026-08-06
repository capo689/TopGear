#!/usr/bin/env node
/**
 * Gate D4 — driven through the SHIPPING ARTIFACT.
 *
 * Per the gate-integrity rule: a gate that claims a capability works must exercise the
 * built `.mcpb` through the MCP tool surface, not source or dist. This script unpacks the
 * bundle, spawns its `server/index.js`, speaks MCP JSON-RPC over stdio, and asserts:
 *
 *   D4(a) STATE LEAK  — teach (probe with a value that does not exist) then recover (the
 *                       taught value) in CONSECUTIVE bridge_act calls on the SAME widget,
 *                       with no intervening action. The recover must come back verified.
 *   D4(b) FALSE REPORT — `availableOptions: []` is emitted ONLY when the runtime can SEE
 *                       an open, empty listbox. When it cannot look, it must say so with
 *                       a distinct reason (`options_not_visible` + widgetState).
 *   NEGATIVE CONTROL   — a field that genuinely has no options still reports
 *                       option_not_found with an empty list, distinguishable from above.
 *
 * Usage: node scripts/gate-d4.mjs [path/to/browser-bridge.mcpb] [--ephemeral]
 *   (no argument → THE distributable at its real path; --ephemeral builds a throwaway and
 *    says so, because a throwaway proves the code compiles, not that the shipped file works)
 */
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveArtifact } from "./lib/artifact.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 34118;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const PAGE = `${ORIGIN}/widgets/library-widgets.html`;

// ---------------------------------------------------------------- the artifact
const artifact = resolveArtifact(process.argv.slice(2), root);

const unpacked = mkdtempSync(join(tmpdir(), "bb-mcpb-run-"));
execFileSync("unzip", ["-q", "-o", artifact.path, "-d", unpacked]);
const serverJs = join(unpacked, "server/index.js");
const serverSrc = readFileSync(serverJs, "utf8");
// Fingerprint the fix INSIDE the artifact, so the report cannot claim a build it did not run.
const fingerprint = {
  options_not_visible: serverSrc.includes("options_not_visible"),
  listboxOpen: serverSrc.includes("listboxOpen"),
  restoreClosed: serverSrc.includes("this widget's options could not be read"),
};

console.log(`\nartifact:    ${artifact.path}`);
console.log(`kind:        ${artifact.kind}`);
console.log(`built:       ${artifact.built}`);
console.log(`size:        ${artifact.size} bytes`);
console.log(`sha256:      ${artifact.sha256}`);
console.log(`fingerprint: ${JSON.stringify(fingerprint)}\n`);

// ---------------------------------------------------------------- fixture farm
const { startFixtureFarm } = await import(join(root, "apps/fixture-farm/dist/index.js"));
const farm = await startFixtureFarm({ port: PORT, host: "127.0.0.1" });

// ---------------------------------------------------------------- MCP over stdio
const proc = spawn("node", [serverJs], {
  cwd: unpacked,
  env: { ...process.env, BB_HEADLESS: "true" },
  stdio: ["pipe", "pipe", "inherit"],
});
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
function rpc(method, params) {
  const id = nextId++;
  return new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`timeout on ${method}`)), 120_000);
    pending.set(id, (m) => {
      clearTimeout(timer);
      m.error ? rej(new Error(`${method}: ${JSON.stringify(m.error)}`)) : res(m.result);
    });
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
function notify(method, params) {
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}
/** Call a bridge tool and parse the JSON payload it returns. */
async function tool(name, args) {
  const r = await rpc("tools/call", { name, arguments: args });
  return JSON.parse(r.content[0].text);
}

const checks = [];
const check = (label, pass, detail) => {
  checks.push({ label, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}\n      ${detail}`);
};

try {
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "gate-d4", version: "1" },
  });
  notify("notifications/initialized", {});

  const tools = (await rpc("tools/list", {})).tools.map((t) => t.name).sort();
  check("MCP surface is the 8 tools (plan §11)", tools.length === 8, tools.join(", "));

  const grant = {
    taskId: "gate-d4",
    allowedOrigins: [ORIGIN],
    allowedRiskTiers: ["low", "medium"],
    sensitiveDataDestinations: [],
    budgets: { maxPages: 5, maxTabs: 2 },
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  };
  const attached = await tool("bridge_attach", { grant, url: PAGE, scope: { kind: "full" } });
  const sessionId = attached.sessionId;
  if (!sessionId) throw new Error(`attach failed: ${JSON.stringify(attached).slice(0, 400)}`);

  const act = (actions) => tool("bridge_act", { sessionId, batch: { actions } });
  const sel = (name, value) => act([{ op: "select", target: { role: "combobox", name }, value }]);
  const fail = (r) => r.results?.[0]?.failure ?? {};

  // ---- D4(a): teach → recover, consecutive calls, same widget, nothing in between ----
  const teach = await sel("Framework", "Nonexistent");
  const tf = fail(teach);
  check(
    "D4(a) teach: probe returns the real option list",
    tf.reason === "option_not_found" && Array.isArray(tf.availableOptions) && tf.availableOptions.length === 4,
    JSON.stringify(tf),
  );

  const recover = await sel("Framework", tf.availableOptions?.[2] ?? "Svelte");
  check(
    "D4(a) recover: the VERY NEXT call on the same widget verifies",
    recover.status === "completed" && recover.results?.[0]?.status === "verified",
    JSON.stringify(recover.results?.[0] ?? recover),
  );

  // Same again on a widget that ignores Escape (closes only on a trigger activation).
  const teachAnt = await sel("Plan", "Nonexistent");
  const recoverAnt = await sel("Plan", "Standard");
  check(
    "D4(a) teach → recover on a widget that ignores Escape",
    fail(teachAnt).reason === "option_not_found" && recoverAnt.results?.[0]?.status === "verified",
    `${JSON.stringify(fail(teachAnt))} → ${JSON.stringify(recoverAnt.results?.[0] ?? recoverAnt)}`,
  );

  // ---- NEGATIVE CONTROL: genuinely no options, listbox demonstrably OPEN ----
  const empty = fail(await sel("Empty roster", "Anything"));
  check(
    "negative control: an OPEN empty listbox still reports option_not_found []",
    empty.reason === "option_not_found" && Array.isArray(empty.availableOptions) && empty.availableOptions.length === 0,
    JSON.stringify(empty),
  );

  // ---- D4(b): cannot look → a DISTINCT reason, never an empty option list ----
  const unreadable = fail(await sel("Stuck menu", "Hidden"));
  check(
    "D4(b) unreadable options report options_not_visible, not option_not_found []",
    unreadable.reason === "options_not_visible" && unreadable.widgetState === "closed",
    JSON.stringify(unreadable),
  );
  check(
    "D4(b) the two cases are distinguishable by reason alone",
    empty.reason !== unreadable.reason,
    `empty="${empty.reason}" vs unreadable="${unreadable.reason}"`,
  );

  // ---- the rest of the combobox gauntlet still works through the artifact ----
  const others = [
    ["Region", "East"],
    ["Tier", "Pro"],
    ["Async city", "Portland"],
    ["Rerender color", "Blue"],
  ];
  const results = [];
  for (const [name, value] of others) results.push((await sel(name, value)).results?.[0]?.status);
  check(
    "no regression: the other library widgets still verify",
    results.every((s) => s === "verified"),
    `${others.map(([n], i) => `${n}=${results[i]}`).join(", ")}`,
  );
} finally {
  proc.stdin.end();
  proc.kill();
  await farm.close();
  rmSync(unpacked, { recursive: true, force: true });
}

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
