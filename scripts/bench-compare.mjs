/**
 * Head-to-head: Browser Bridge vs. the generic browser-tool approach, on the same real
 * pages, measuring the three things that actually cost a model something.
 *
 *   turns    — one tool call. The unit the model spends. Counted identically both sides.
 *   payload  — bytes returned into the model's context. A 50KB page dump to answer one
 *              question is a real cost even when the turn count is low.
 *   fidelity — did the data survive? A row that silently loses a spanned cell is worse
 *              than a row that is missing, because nothing signals the loss.
 *
 * The "traditional" arm is modelled as innerText extraction, which is what a generic
 * read-the-page tool returns. That is a fair stand-in: it is the same text, from the same
 * rendered DOM, with the same information available to it.
 *
 * Usage: node scripts/bench-compare.mjs
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveArtifact } from "./lib/artifact.mjs";
import { startArtifactServer } from "./lib/mcp-client.mjs";
import { chromium } from "playwright";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const artifact = resolveArtifact([], root);
const bytes = (s) => Buffer.byteLength(typeof s === "string" ? s : JSON.stringify(s), "utf8");

const PAGE = "https://en.wikipedia.org/wiki/List_of_largest_companies_by_revenue";
const APPLE = "https://en.wikipedia.org/wiki/Apple_Inc.";
const out = { generatedAt: new Date().toISOString(), artifact: artifact.path, tasks: [] };

// ---------------------------------------------------------------- BRIDGE arm
const server = startArtifactServer(artifact, { BB_HEADLESS: "true" });
await server.handshake();
const grant = (origin, taskId) => ({
  taskId,
  allowedOrigins: [origin],
  allowedRiskTiers: ["low", "medium"],
  sensitiveDataDestinations: [origin],
  budgets: { maxPages: 10 },
  expiresAt: "2099-01-01T00:00:00.000Z",
});

let bridgeT1, bridgeT1Scoped, bridgeT2;
{
  // Well-scoped read: the caller names the section it wants. This is how you would ask
  // for a specific table, and it is the fair comparison against a targeted extraction.
  const t0 = Date.now();
  const a = await server.tool("bridge_attach", {
    url: PAGE,
    scope: { kind: "content", region: { kind: "section", heading: "List" } },
    grant: grant("https://en.wikipedia.org", "cmp1s"),
  });
  const blocks = (a.initialView?.content ?? []).filter((b) => b.kind === "table");
  const rows = blocks.filter((b) => /^Ranks?: \d+/.test(b.text));
  const withHq = rows.filter((b) => /Headquarters[^:]*: *[^|]*[A-Za-z]/.test(b.text));
  bridgeT1Scoped = {
    turns: 1,
    wallMs: Date.now() - t0,
    payloadBytes: bytes(a.initialView?.content ?? []),
    rows: rows.length,
    rowsWithCountry: withHq.length,
    labelled: true,
  };
}
{
  const t0 = Date.now();
  const a = await server.tool("bridge_attach", {
    url: PAGE,
    scope: { kind: "content" },
    grant: grant("https://en.wikipedia.org", "cmp1"),
  });
  const blocks = (a.initialView?.content ?? []).filter((b) => b.kind === "table");
  const rows = blocks.filter((b) => /^Ranks?: \d+/.test(b.text));
  // Fidelity: a row is COMPLETE if it carries a Headquarters value. Wikipedia rowspans
  // that column across runs of rows sharing a country.
  const withHq = rows.filter((b) => /Headquarters[^:]*: *[^|]*[A-Za-z]/.test(b.text));
  bridgeT1 = {
    turns: 1,
    wallMs: Date.now() - t0,
    payloadBytes: bytes(a.initialView?.content ?? []),
    rows: rows.length,
    rowsWithCountry: withHq.length,
    labelled: true,
  };
}
{
  const t0 = Date.now();
  const a = await server.tool("bridge_attach", {
    url: APPLE,
    scope: { kind: "content" },
    grant: grant("https://en.wikipedia.org", "cmp2"),
  });
  const blocks = (a.initialView?.content ?? []).filter((b) => b.kind === "table");
  const want = ["Founded", "Headquarters", "Revenue", "Founders", "Key people", "Number of employees"];
  const found = want.filter((k) => blocks.some((b) => b.text.startsWith(k + ":")));
  bridgeT2 = {
    turns: 1,
    wallMs: Date.now() - t0,
    payloadBytes: bytes(a.initialView?.content ?? []),
    factsFound: found.length,
    factsWanted: want.length,
  };
}
server.stop();

// ---------------------------------------------------------------- TRADITIONAL arm
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
let tradT1, tradT2;
{
  const t0 = Date.now();
  await p.goto(PAGE, { waitUntil: "domcontentloaded" });
  const text = await p.evaluate(() => document.querySelector("main")?.innerText ?? document.body.innerText);
  // Parse the same 50 rows out of the flat text: a row starts with its rank.
  const lines = text.split("\n");
  const rowRe = /^\s*(\d{1,2})\s+\S/;
  const rows = lines.filter((l) => rowRe.test(l) && /\d{2,3}\s/.test(l));
  const COUNTRIES = /United States|China|Saudi Arabia|Germany|Switzerland|United Kingdom|Japan|France|Netherlands|South Korea|Taiwan|Singapore/;
  const withCountry = rows.filter((l) => COUNTRIES.test(l));
  tradT1 = {
    turns: 2, // navigate + read page
    wallMs: Date.now() - t0,
    payloadBytes: bytes(text),
    rows: rows.length,
    rowsWithCountry: withCountry.length,
    labelled: false,
  };
}
{
  const t0 = Date.now();
  await p.goto(APPLE, { waitUntil: "domcontentloaded" });
  const text = await p.evaluate(() => document.querySelector("main")?.innerText ?? document.body.innerText);
  const want = ["Founded", "Headquarters", "Revenue", "Founders", "Key people", "Number of employees"];
  const found = want.filter((k) => new RegExp("(^|\\n)" + k + "\\b").test(text));
  tradT2 = {
    // navigate + read page, +1 because a ~50KB dump overflows the tool's inline output
    // limit and has to be spilled to a file and read back before it can be used.
    turns: bytes(text) > 40_000 ? 3 : 2,
    wallMs: Date.now() - t0,
    payloadBytes: bytes(text),
    factsFound: found.length,
    factsWanted: want.length,
  };
}
await b.close();

out.tasks.push(
  {
    task: "Scrape a 50-row data table (scoped to the section)",
    page: "Wikipedia: largest companies by revenue",
    bridge: bridgeT1Scoped,
    traditional: tradT1,
  },
  {
    task: "Scrape a 50-row data table (whole page, unscoped)",
    page: "Wikipedia: largest companies by revenue",
    bridge: bridgeT1,
    traditional: tradT1,
  },
  { task: "Pull 6 facts from an infobox", page: "Wikipedia: Apple Inc.", bridge: bridgeT2, traditional: tradT2 },
);

const pct = (a, b2) => (b2 === 0 ? "n/a" : `${(a / b2).toFixed(1)}x`);
for (const t of out.tasks) {
  console.log(`\n${t.task}  (${t.page})`);
  console.log(`  turns    bridge ${t.bridge.turns}   traditional ${t.traditional.turns}   -> ${pct(t.traditional.turns, t.bridge.turns)} fewer`);
  console.log(
    `  payload  bridge ${(t.bridge.payloadBytes / 1024).toFixed(1)}KB   traditional ${(t.traditional.payloadBytes / 1024).toFixed(1)}KB   -> ${pct(t.traditional.payloadBytes, t.bridge.payloadBytes)} less context`,
  );
  if (t.bridge.rows !== undefined) {
    console.log(`  rows     bridge ${t.bridge.rows}   traditional ${t.traditional.rows}`);
    console.log(
      `  fidelity bridge ${t.bridge.rowsWithCountry}/${t.bridge.rows} rows keep their country   traditional ${t.traditional.rowsWithCountry}/${t.traditional.rows}`,
    );
  } else {
    console.log(`  facts    bridge ${t.bridge.factsFound}/${t.bridge.factsWanted}   traditional ${t.traditional.factsFound}/${t.traditional.factsWanted}`);
  }
}

writeFileSync(join(root, "scripts/.bench-compare.json"), JSON.stringify(out, null, 2));
console.log("\nwritten: scripts/.bench-compare.json");
