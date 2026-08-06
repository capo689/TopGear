#!/usr/bin/env node
/**
 * Gate D4 — LIVE confirmation, driven through the SHIPPING ARTIFACT.
 *
 * D4 was measured on a live react-select form, so the fix is confirmed on one. Same
 * artifact, same MCP stdio surface as `gate-d4.mjs`; the only difference is the page.
 * For every real combobox found (up to `--max`), it runs the probe/recover pair the
 * proof requires:
 *
 *   teach   — select a value that cannot exist → the runtime must return the real option
 *             list (option_not_found), or say honestly that it could not look.
 *   recover — the VERY NEXT bridge_act call, same widget, no intervening action, using a
 *             value the teach step taught → must come back verified.
 *
 * READ-ONLY with respect to the site: it selects dropdown values and NEVER submits.
 *
 * Usage: node scripts/gate-d4-live.mjs <url> [--max 3] [--artifact path.mcpb]
 */
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const url = argv.find((a) => !a.startsWith("--"));
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
if (!url) {
  console.error("usage: node scripts/gate-d4-live.mjs <url> [--max 3] [--artifact path.mcpb]");
  process.exit(2);
}
const MAX = Number(flag("max", 3));

let bundle = flag("artifact");
if (!bundle) {
  bundle = join(mkdtempSync(join(tmpdir(), "bb-gate-")), "browser-bridge.mcpb");
  console.log("building the shipping artifact…");
  execFileSync("node", [join(root, "scripts/build-mcpb.mjs"), bundle], { cwd: root, stdio: "inherit" });
}
if (!existsSync(bundle)) throw new Error(`no artifact at ${bundle}`);
const sha = createHash("sha256").update(readFileSync(bundle)).digest("hex");
const built = statSync(bundle).mtime.toISOString();

const unpacked = mkdtempSync(join(tmpdir(), "bb-mcpb-run-"));
execFileSync("unzip", ["-q", "-o", bundle, "-d", unpacked]);
const serverJs = join(unpacked, "server/index.js");
const serverSrc = readFileSync(serverJs, "utf8");
const fingerprint = {
  options_not_visible: serverSrc.includes("options_not_visible"),
  listboxOpen: serverSrc.includes("listboxOpen"),
};

console.log(`\nartifact:    ${bundle}`);
console.log(`built:       ${built}`);
console.log(`sha256:      ${sha}`);
console.log(`fingerprint: ${JSON.stringify(fingerprint)}`);
console.log(`page:        ${url}\n`);

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
    const timer = setTimeout(() => rej(new Error(`timeout on ${method}`)), 180_000);
    pending.set(id, (m) => {
      clearTimeout(timer);
      m.error ? rej(new Error(`${method}: ${JSON.stringify(m.error)}`)) : res(m.result);
    });
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
const notify = (method, params) => proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
async function tool(name, args) {
  const r = await rpc("tools/call", { name, arguments: args });
  return JSON.parse(r.content[0].text);
}

const rows = [];
try {
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "gate-d4-live", version: "1" } });
  notify("notifications/initialized", {});

  const origin = new URL(url).origin;
  const grant = {
    taskId: "gate-d4-live",
    allowedOrigins: [origin],
    allowedRiskTiers: ["low", "medium"],
    sensitiveDataDestinations: [],
    budgets: { maxPages: 5, maxTabs: 2 },
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  };
  const attached = await tool("bridge_attach", { grant, url, scope: { kind: "all_forms" } });
  const sessionId = attached.sessionId;
  if (!sessionId) throw new Error(`attach failed: ${JSON.stringify(attached).slice(0, 500)}`);
  const view = attached.initialView ?? (await tool("bridge_view", { sessionId, scope: { kind: "all_forms" } }));

  const combos = (view.elements ?? []).filter(
    (e) => e.role === "combobox" && e.disabled !== true && e.visible !== false && (e.name ?? "").trim() !== "",
  );
  console.log(`found ${combos.length} combobox(es): ${combos.map((c) => `${c.name} [${c.widgetKind}]`).join(" | ")}\n`);

  const act = (actions) => tool("bridge_act", { sessionId, batch: { actions } });
  for (const combo of combos.slice(0, MAX)) {
    const target = { role: "combobox", name: combo.name };
    const teach = await act([{ op: "select", target, value: "__no_such_option_zzz__" }]);
    const tf = teach.results?.[0]?.failure ?? {};
    // Consecutive call on the SAME widget, nothing in between.
    const taught = Array.isArray(tf.availableOptions) ? tf.availableOptions.find((o) => (o ?? "").trim() !== "") : undefined;
    const recover = taught ? await act([{ op: "select", target, value: taught }]) : undefined;
    const status = recover?.results?.[0]?.status;
    rows.push({
      field: combo.name,
      widget: combo.widgetKind,
      teachReason: tf.reason,
      taughtCount: Array.isArray(tf.availableOptions) ? tf.availableOptions.length : undefined,
      widgetState: tf.widgetState,
      recoverValue: taught,
      recover: status ?? (recover ? JSON.stringify(recover.results?.[0]) : "skipped (nothing taught)"),
    });
    console.log(
      `${combo.name}\n  teach:   ${JSON.stringify(tf).slice(0, 220)}\n  recover: ${taught ? `"${taught}" → ${JSON.stringify(recover.results?.[0])}` : "skipped"}\n`,
    );
  }
} finally {
  proc.stdin.end();
  proc.kill();
  rmSync(unpacked, { recursive: true, force: true });
}

const probed = rows.filter((r) => r.teachReason === "option_not_found" && (r.taughtCount ?? 0) > 0);
const recovered = probed.filter((r) => r.recover === "verified");
console.log(`\nteach→recover on the same widget, consecutive calls: ${recovered.length}/${probed.length} verified`);
const lied = rows.filter((r) => r.teachReason === "option_not_found" && r.taughtCount === 0);
console.log(`fields reporting the ambiguous "availableOptions: []": ${lied.length} (${lied.map((r) => r.field).join(", ") || "none"})`);
process.exit(probed.length > 0 && recovered.length === probed.length ? 0 : 1);
