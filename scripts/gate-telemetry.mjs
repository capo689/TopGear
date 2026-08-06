#!/usr/bin/env node
/**
 * Gate D2/D3/D5 — the benchmark's measuring instruments, through the SHIPPING ARTIFACT.
 *
 * The benchmark cannot record what the daemon does not emit, so these are gated on the same
 * footing as behaviour:
 *   D2  pageLoadMs was hardcoded 0 in `attach`, so wall-minus-page-load did not exist for the
 *       call that does the most page loading. A cold navigation must now report > 0, and
 *       pageLoadMs must be a SUBSET of wallMs so active time can never go negative.
 *   D3  `fill_record` — the measured part of every benchmark run — emitted no event at all.
 *       A run must produce attach + fill_record, with fields populated from the result.
 *   D5  updating an .mcpb wipes user_config, so telemetry silently switches off. The server
 *       must SAY which state it is in at startup.
 *
 * Usage: node scripts/gate-telemetry.mjs [--artifact p.mcpb] [--ephemeral]
 */
import { readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { resolveArtifact } from "./lib/artifact.mjs";
import { startArtifactServer, grantFor } from "./lib/mcp-client.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 34119;
const ORIGIN = `http://127.0.0.1:${PORT}`;

const artifact = resolveArtifact(process.argv.slice(2), root);
console.log(`\nartifact: ${artifact.path}`);
console.log(`kind:     ${artifact.kind}`);
console.log(`built:    ${artifact.built}`);
console.log(`sha256:   ${artifact.sha256}   (bundle — a zip, so it changes every build)`);

const { startFixtureFarm, FIXTURES } = await import(join(root, "apps/fixture-farm/dist/index.js"));
const farm = await startFixtureFarm({ port: PORT, host: "127.0.0.1" });

const checks = [];
const check = (label, pass, detail) => {
  checks.push({ pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}\n      ${detail}`);
};

const logPath = join(tmpdir(), `bb-gate-tel-${randomUUID()}.jsonl`);
const on = startArtifactServer(artifact, { BB_EVAL_LOG: logPath });
console.log(`code sha: ${on.serverSha256}   (server/index.js — stable across rebuilds)\n`);
try {
  await on.handshake();
  const grant = grantFor(ORIGIN, "gate-telemetry");

  // D2 — cold navigation inside attach.
  const cold = await on.tool("bridge_attach", { grant, url: farm.url + FIXTURES.nativeForm, scope: { kind: "all_forms" } });
  if (!cold.sessionId) throw new Error(`attach failed: ${JSON.stringify(cold).slice(0, 300)}`);

  // D3 — fill_record is the measured part of a benchmark run.
  const filled = await on.tool("bridge_fill_record", {
    sessionId: cold.sessionId,
    record: { Email: "ada@example.com", "First name": "Ada", "No such field on this form": "x" },
  });

  // Give the appendFileSync-backed sink a moment; it is synchronous, so this is belt-and-braces.
  const events = readFileSync(logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const attach = events.find((e) => e.tool === "attach");
  const fr = events.find((e) => e.tool === "fill_record");

  check(
    "D2 a cold navigation inside bridge_attach reports pageLoadMs > 0",
    attach !== undefined && attach.pageLoadMs > 0,
    JSON.stringify({ wallMs: attach?.wallMs, pageLoadMs: attach?.pageLoadMs }),
  );
  check(
    "D2 pageLoadMs is a subset of wallMs (wall-minus-page-load can never go negative)",
    attach !== undefined && attach.wallMs >= attach.pageLoadMs,
    `wallMs ${attach?.wallMs} >= pageLoadMs ${attach?.pageLoadMs} → active ${(attach?.wallMs ?? 0) - (attach?.pageLoadMs ?? 0)}ms`,
  );
  check(
    "D3 attach + fill_record yields TWO events",
    events.length === 2 && events.map((e) => e.tool).join(",") === "attach,fill_record",
    `${events.length} event(s): ${events.map((e) => e.tool).join(", ")}`,
  );
  check(
    "D3 fieldsAttempted counts EVERY field the record asked for (matched + unmatched)",
    fr !== undefined && fr.fieldsAttempted === filled.matched.length + filled.unmatched.length && fr.fieldsAttempted === 3,
    `attempted ${fr?.fieldsAttempted} = matched ${filled.matched.length} + unmatched ${filled.unmatched.length}`,
  );
  check(
    "D3 fieldsVerified comes from the batch result",
    fr !== undefined && fr.fieldsVerified === filled.batch.completed && fr.fieldsVerified > 0,
    `verified ${fr?.fieldsVerified} = batch.completed ${filled.batch.completed}, status ${fr?.status}`,
  );
  check(
    "D5 the server states telemetry is ON, with the path",
    on.stderrText().includes("eval telemetry ON") && on.stderrText().includes(logPath),
    on.stderrText().split("\n").find((l) => l.includes("telemetry")) ?? "(no telemetry line)",
  );
} finally {
  on.stop();
}

// D5 — the silent-off case: no BB_EVAL_LOG at all.
const off = startArtifactServer(artifact, { BB_EVAL_LOG: "" });
try {
  await off.handshake();
  const line = off.stderrText().split("\n").find((l) => l.includes("telemetry")) ?? "";
  check(
    "D5 with BB_EVAL_LOG unset the server says OFF and names the .mcpb-update cause",
    line.includes("OFF") && line.toLowerCase().includes("update"),
    line || "(no telemetry line)",
  );
} finally {
  off.stop();
}

// D5 — the placeholder case: the host left ${user_config...} unsubstituted.
const ph = startArtifactServer(artifact, { BB_EVAL_LOG: "${user_config.eval_log_path}" });
try {
  await ph.handshake();
  const line = ph.stderrText().split("\n").find((l) => l.includes("telemetry")) ?? "";
  check(
    "D5 an unsubstituted placeholder reads as OFF, and no file by that name is created",
    line.includes("OFF") && !existsSync("${user_config.eval_log_path}"),
    line || "(no telemetry line)",
  );
} finally {
  ph.stop();
}

await farm.close();
rmSync(logPath, { force: true });

const failed = checks.filter((c) => !c.pass).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
