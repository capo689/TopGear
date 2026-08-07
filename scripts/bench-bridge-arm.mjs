/**
 * Benchmark, BRIDGE arm — driven through the SHIPPING ARTIFACT over MCP stdio, exactly
 * as Claude would drive it.
 *
 * This measures the thing the product exists for: how many model turns and how much wall
 * clock it takes to complete a real web task, versus doing the same task with generic
 * browser tools. Unit tests cannot answer that — they test the tool against its own
 * fixtures. This drives real public pages.
 *
 * What counts as a "turn": one MCP tool call. That is the unit the model spends, and it
 * is counted identically in both arms. Wall clock is recorded too but is the weaker
 * number — this arm's timing excludes model thinking time, so only the turn count is a
 * fair head-to-head.
 *
 * Usage: node scripts/bench-bridge-arm.mjs [pathToMcpb]
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveArtifact } from "./lib/artifact.mjs";
import { startArtifactServer } from "./lib/mcp-client.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const artifact = resolveArtifact(process.argv.slice(2), root);

const server = startArtifactServer(artifact, { BB_HEADLESS: "true" });

let calls = 0;
async function tool(name, args) {
  calls += 1; // one MCP tool call = one model turn; counted identically in both arms
  return server.tool(name, args);
}

const grant = (origin, taskId) => ({
  taskId,
  allowedOrigins: [origin],
  allowedRiskTiers: ["low", "medium"],
  sensitiveDataDestinations: [origin],
  budgets: { maxPages: 10 },
  expiresAt: "2099-01-01T00:00:00.000Z",
});

const results = [];
async function task(name, target, fn) {
  calls = 0;
  const t0 = Date.now();
  let outcome;
  try {
    outcome = await fn();
  } catch (e) {
    outcome = { error: String(e).slice(0, 200) };
  }
  const row = { arm: "bridge", task: name, target, calls, wallMs: Date.now() - t0, ...outcome };
  results.push(row);
  console.log(
    `${name.padEnd(34)} calls=${String(row.calls).padEnd(3)} ${String(row.wallMs).padStart(6)}ms  ${row.summary ?? row.error ?? ""}`,
  );
}

await server.handshake();

// ---------------------------------------------------------------- T1: table scrape
// The task that scored 0% before the fix: pull structured rows out of a real data table.
await task("T1 Wikipedia revenue table", "en.wikipedia.org", async () => {
  const a = await tool("bridge_attach", {
    url: "https://en.wikipedia.org/wiki/List_of_largest_companies_by_revenue",
    scope: { kind: "content" },
    grant: grant("https://en.wikipedia.org", "t1"),
  });
  const blocks = (a.initialView?.content ?? []).filter((b) => b.kind === "table");
  const rows = blocks.filter((b) => /^Ranks?: \d+/.test(b.text));
  return {
    tableBlocks: blocks.length,
    dataRows: rows.length,
    sample: rows[1]?.text?.slice(0, 90),
    summary: `${rows.length} data rows, ${blocks.length} table blocks`,
  };
});

// ---------------------------------------------------------------- T2: infobox facts
await task("T2 Apple infobox facts", "en.wikipedia.org", async () => {
  const a = await tool("bridge_attach", {
    url: "https://en.wikipedia.org/wiki/Apple_Inc.",
    scope: { kind: "content" },
    grant: grant("https://en.wikipedia.org", "t2"),
  });
  const blocks = (a.initialView?.content ?? []).filter((b) => b.kind === "table");
  const want = ["Founded", "Headquarters", "Revenue", "Founders", "Key people"];
  const found = want.filter((k) => blocks.some((b) => b.text.startsWith(k + ":")));
  return { factsFound: found.length, factsWanted: want.length, summary: `${found.length}/${want.length} facts` };
});

// ---------------------------------------------------------------- T3: form fill
// A real 20-field form, filled from a record in ONE call.
const { startFixtureFarm } = await import(join(root, "apps/fixture-farm/dist/index.js"));
const farm = await startFixtureFarm({ port: 34599, host: "127.0.0.1" });
await task("T3 20-field form fill", "fixture-farm", async () => {
  const a = await tool("bridge_attach", {
    url: farm.url + "/forms/native-form.html",
    scope: { kind: "all_forms" },
    grant: grant(new URL(farm.url).origin, "t3"),
  });
  const r = await tool("bridge_fill_record", {
    sessionId: a.sessionId,
    record: {
      "First name": "Ada",
      "Last name": "Lovelace",
      Email: "ada@example.com",
      Phone: "555-0100",
      "Street address": "12 Analytical Way",
      City: "London",
      "Postal code": "NW1 2DB",
    },
  });
  const verified = (r.batch?.results ?? []).filter((x) => x.status === "verified").length;
  return { matched: r.matched?.length ?? 0, verified, summary: `${verified} fields verified` };
});

await task("T4 form with no <form> element", "fixture-farm", async () => {
  const a = await tool("bridge_attach", {
    url: farm.url + "/forms/pseudo-form.html",
    scope: { kind: "all_forms" },
    grant: grant(new URL(farm.url).origin, "t4"),
  });
  const r = await tool("bridge_fill_record", {
    sessionId: a.sessionId,
    record: { fullName: "Ada Lovelace", email: "ada@example.com", city: "Seattle" },
  });
  const verified = (r.batch?.results ?? []).filter((x) => x.status === "verified").length;
  return { verified, unmatched: r.unmatched?.length ?? 0, summary: `${verified} verified, ${r.unmatched?.length ?? 0} unmatched` };
});

await farm.close();
server.stop();

writeFileSync(join(root, "scripts/.bench-bridge.json"), JSON.stringify({ artifact: artifact.path, results }, null, 2));
console.log(`\ntotal bridge calls: ${results.reduce((s, r) => s + r.calls, 0)}`);
console.log("written: scripts/.bench-bridge.json");
