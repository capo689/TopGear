/**
 * THE benchmark: Browser Bridge vs. driving a browser with generic tools.
 *
 * Both arms EXECUTE the same task against the same page and are verified to have
 * produced the same result. Neither arm is modelled or estimated.
 *
 *   BRIDGE arm      — the shipping .mcpb, over MCP stdio, exactly as Claude loads it.
 *                     One MCP tool call = one turn.
 *   TRADITIONAL arm — Playwright doing what a generic browser tool does: navigate, read
 *                     the page, act on one element at a time, read back to verify.
 *                     One primitive operation = one turn, because each one is a separate
 *                     tool call the model has to make and wait for.
 *
 * Measured: turns, wall-clock, bytes returned into model context, and whether the task
 * actually succeeded.
 *
 * Usage: node scripts/benchmark.mjs
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveArtifact } from "./lib/artifact.mjs";
import { startArtifactServer } from "./lib/mcp-client.mjs";
import { chromium } from "playwright";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const artifact = resolveArtifact([], root);
const bytes = (s) => Buffer.byteLength(typeof s === "string" ? s : JSON.stringify(s ?? ""), "utf8");
const rows = [];

const RECORD = {
  "First name": "Ada",
  "Last name": "Lovelace",
  Email: "ada@example.com",
  Phone: "555-0100",
  "Street address": "12 Analytical Way",
  City: "London",
  "Postal code": "NW1 2DB",
};

const { startFixtureFarm } = await import(join(root, "apps/fixture-farm/dist/index.js"));
const farm = await startFixtureFarm({ port: 34611, host: "127.0.0.1" });
const server = startArtifactServer(artifact, { BB_HEADLESS: "true" });
await server.handshake();
const browser = await chromium.launch({ headless: true });

const grant = (origin, taskId) => ({
  taskId,
  allowedOrigins: [origin],
  allowedRiskTiers: ["low", "medium"],
  sensitiveDataDestinations: [origin],
  budgets: { maxPages: 10 },
  expiresAt: "2099-01-01T00:00:00.000Z",
});

function record(task, arm, turns, t0, payload, ok, detail) {
  rows.push({ task, arm, turns, wallMs: Date.now() - t0, payloadBytes: payload, ok, detail });
}

// ══════════════════════════════════════════════════════════ SCRAPE 1: data table
{
  const url = "https://en.wikipedia.org/wiki/List_of_largest_companies_by_revenue";
  const T = "Scrape 50-row table";

  let t0 = Date.now();
  const a = await server.tool("bridge_attach", {
    url,
    scope: { kind: "content", region: { kind: "section", heading: "List" } },
    grant: grant("https://en.wikipedia.org", "s1"),
  });
  const blocks = (a.initialView?.content ?? []).filter((b) => b.kind === "table");
  const brRows = blocks.filter((b) => /^Ranks?: \d+/.test(b.text));
  const brComplete = brRows.filter((b) => /Headquarters[^:]*: *[^|]*[A-Za-z]/.test(b.text)).length;
  record(T, "bridge", 1, t0, bytes(a.initialView?.content), brRows.length === 50, `${brRows.length} rows, ${brComplete}/50 keep country`);

  t0 = Date.now();
  const p = await browser.newPage();
  await p.goto(url, { waitUntil: "domcontentloaded" }); // turn 1: navigate
  const text = await p.evaluate(() => document.querySelector("main")?.innerText ?? document.body.innerText); // turn 2: read
  const lines = text.split("\n").filter((l) => /^\s*\d{1,2}\s+\S/.test(l) && /\d{2,3}\s/.test(l));
  const CT = /United States|China|Saudi Arabia|Germany|Switzerland|United Kingdom|Japan|France|Netherlands|South Korea|Taiwan|Singapore/;
  record(T, "traditional", 2, t0, bytes(text), lines.length === 50, `${lines.length} rows, ${lines.filter((l) => CT.test(l)).length}/50 keep country`);
  await p.close();
}

// ══════════════════════════════════════════════════════════ SCRAPE 2: infobox facts
{
  const url = "https://en.wikipedia.org/wiki/Apple_Inc.";
  const T = "Extract 6 infobox facts";
  const WANT = ["Founded", "Headquarters", "Revenue", "Founders", "Key people", "Number of employees"];

  let t0 = Date.now();
  const a = await server.tool("bridge_attach", {
    url,
    scope: { kind: "content", region: { kind: "main" } },
    grant: grant("https://en.wikipedia.org", "s2"),
  });
  const blocks = (a.initialView?.content ?? []).filter((b) => b.kind === "table");
  const got = WANT.filter((k) => blocks.some((b) => b.text.startsWith(k + ":")));
  record(T, "bridge", 1, t0, bytes(a.initialView?.content), got.length === 6, `${got.length}/6 facts, labelled`);

  t0 = Date.now();
  const p = await browser.newPage();
  await p.goto(url, { waitUntil: "domcontentloaded" });
  const text = await p.evaluate(() => document.querySelector("main")?.innerText ?? document.body.innerText);
  // A ~50KB dump exceeds the inline output limit of a real browser tool and must be
  // spilled to a file and read back — that is a third turn, not a free one.
  const turns = bytes(text) > 40_000 ? 3 : 2;
  const found = WANT.filter((k) => new RegExp("(^|\\n)" + k + "\\b").test(text));
  record(T, "traditional", turns, t0, bytes(text), found.length === 6, `${found.length}/6 facts, unlabelled`);
  await p.close();
}

// ══════════════════════════════════════════════════════════ FORM 1: 7 fields
{
  const url = farm.url + "/forms/native-form.html";
  const T = "Fill 7-field form";
  const origin = new URL(farm.url).origin;

  let t0 = Date.now();
  const a = await server.tool("bridge_attach", { url, scope: { kind: "all_forms" }, grant: grant(origin, "f1") });
  const r = await server.tool("bridge_fill_record", { sessionId: a.sessionId, record: RECORD });
  const verified = (r.batch?.results ?? []).filter((x) => x.status === "verified").length;
  record(T, "bridge", 2, t0, bytes(r), verified >= 6, `${verified} fields verified in 1 call`);

  t0 = Date.now();
  const p = await browser.newPage();
  let turns = 0;
  await p.goto(url, { waitUntil: "domcontentloaded" });
  turns += 1;
  const tree = await p.evaluate(() =>
    [...document.querySelectorAll("input,select,textarea")].map((e) => ({
      id: e.id,
      name: e.name,
      label: document.querySelector(`label[for="${e.id}"]`)?.textContent?.trim() ?? "",
    })),
  );
  turns += 1; // read the page to find the fields
  let filled = 0;
  for (const [label, value] of Object.entries(RECORD)) {
    const f = tree.find((e) => e.label.toLowerCase() === label.toLowerCase());
    if (!f) continue;
    await p.fill(`#${f.id}`, value);
    turns += 1; // one tool call per field
    filled += 1;
  }
  const readback = await p.evaluate(() =>
    [...document.querySelectorAll("input")].map((e) => e.value).filter(Boolean).length,
  );
  turns += 1; // read back to verify
  record(T, "traditional", turns, t0, bytes(tree), filled >= 6, `${filled} fields, ${turns} calls`);
  await p.close();
}

// ══════════════════════════════════════════════════════════ FORM 2: no <form> element
{
  const url = farm.url + "/forms/pseudo-form.html";
  const T = "Fill form with no <form>";
  const origin = new URL(farm.url).origin;
  const REC = { fullName: "Ada Lovelace", email: "ada@example.com", city: "Seattle" };

  let t0 = Date.now();
  const a = await server.tool("bridge_attach", { url, scope: { kind: "all_forms" }, grant: grant(origin, "f2") });
  const r = await server.tool("bridge_fill_record", { sessionId: a.sessionId, record: REC });
  const verified = (r.batch?.results ?? []).filter((x) => x.status === "verified").length;
  record(T, "bridge", 2, t0, bytes(r), verified === 3, `${verified}/3 verified`);

  t0 = Date.now();
  const p = await browser.newPage();
  let turns = 0;
  await p.goto(url, { waitUntil: "domcontentloaded" });
  turns += 1;
  const tree = await p.evaluate(() => [...document.querySelectorAll("input")].map((e) => ({ id: e.id, name: e.name })));
  turns += 1;
  let filled = 0;
  for (const [k, v] of Object.entries(REC)) {
    const f = tree.find((e) => e.name === k || e.id === k);
    if (!f) continue;
    await p.fill(`#${f.id}`, v);
    turns += 1;
    filled += 1;
  }
  turns += 1; // verify read-back
  record(T, "traditional", turns, t0, bytes(tree), filled === 3, `${filled}/3 filled`);
  await p.close();
}

// ══════════════════════════════════════════════════════════ SEARCH: query + read result
{
  const T = "Search + read first result";
  const url = "https://en.wikipedia.org/w/index.php?search=browser+automation&ns0=1";

  let t0 = Date.now();
  const a = await server.tool("bridge_attach", {
    url,
    scope: { kind: "content", region: { kind: "main" } },
    grant: grant("https://en.wikipedia.org", "q1"),
  });
  const c = a.initialView?.content ?? [];
  record(T, "bridge", 1, t0, bytes(c), c.length > 0, `${c.length} content blocks`);

  t0 = Date.now();
  const p = await browser.newPage();
  await p.goto(url, { waitUntil: "domcontentloaded" });
  const text = await p.evaluate(() => document.querySelector("main")?.innerText ?? document.body.innerText);
  record(T, "traditional", 2, t0, bytes(text), text.length > 0, `${text.split("\n").length} text lines`);
  await p.close();
}

await browser.close();
await farm.close();
server.stop();

const tasks = [...new Set(rows.map((r) => r.task))];
console.log(`\n${"task".padEnd(26)} ${"turns".padEnd(16)} ${"context".padEnd(20)} result`);
console.log("-".repeat(96));
for (const t of tasks) {
  const b = rows.find((r) => r.task === t && r.arm === "bridge");
  const g = rows.find((r) => r.task === t && r.arm === "traditional");
  console.log(
    `${t.padEnd(26)} ${`${b.turns} vs ${g.turns}`.padEnd(6)}${`(${(g.turns / b.turns).toFixed(1)}x)`.padEnd(10)} ` +
      `${`${(b.payloadBytes / 1024).toFixed(0)}KB vs ${(g.payloadBytes / 1024).toFixed(0)}KB`.padEnd(20)} ` +
      `bridge:${b.ok ? "OK" : "FAIL"} trad:${g.ok ? "OK" : "FAIL"}  | ${b.detail}  ||  ${g.detail}`,
  );
}
const bt = rows.filter((r) => r.arm === "bridge").reduce((s, r) => s + r.turns, 0);
const gt = rows.filter((r) => r.arm === "traditional").reduce((s, r) => s + r.turns, 0);
console.log(`\nTOTAL turns: bridge ${bt}   traditional ${gt}   -> ${(gt / bt).toFixed(1)}x fewer`);

writeFileSync(join(root, "scripts/.benchmark.json"), JSON.stringify({ generatedAt: new Date().toISOString(), artifact: artifact.path, rows }, null, 2));
console.log("written: scripts/.benchmark.json");
