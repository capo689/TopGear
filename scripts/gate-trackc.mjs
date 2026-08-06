#!/usr/bin/env node
/**
 * Track C — two-vendor reality check, driven through the SHIPPING ARTIFACT.
 *
 * v0.1 scope is deliberately two vendors: **Lever** (a second real ATS, so the widget work is
 * not Greenhouse-shaped) and a **plain HTML5-native form** (so it is not react-select-shaped).
 * The four-vendor matrix, Workday, submit-truth loopback and the extension live-load are v0.2.
 *
 * The gate is **C3 teach-and-recover** — the production loop, and the thing D4 broke:
 *   teach   — ask for a value that cannot exist. The runtime must return the field's REAL
 *             options, or say honestly that it could not read them (options_not_visible).
 *   recover — the VERY NEXT call on the SAME field, using a value the teach step taught,
 *             with no intervening action, must come back verified.
 *
 * READ-ONLY with respect to every site: it selects values and NEVER submits.
 *
 * Usage: node scripts/gate-trackc.mjs [--artifact p.mcpb] [--ephemeral] [--only lever|native]
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveArtifact } from "./lib/artifact.mjs";
import { startArtifactServer, grantFor } from "./lib/mcp-client.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const only = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : undefined;

/**
 * Vendors. Every case traces to a real page we observed live — never hand-authored
 * (fixture-provenance rule). `note` records what the page actually is.
 */
const VENDORS = [
  {
    key: "lever",
    vendor: "Lever (ATS #2)",
    url: "https://jobs.lever.co/apolloresearch/421c9d78-2ca3-4b9e-9e4a-22044d837571/apply",
    note: "live Lever application form",
  },
  {
    key: "native",
    vendor: "Plain HTML5 native",
    url: "https://www.selenium.dev/selenium/web/web-form.html",
    note: "real hosted plain-HTML form (native select, no widget library)",
  },
];

const artifact = resolveArtifact(argv, root);
console.log(`\nartifact: ${artifact.path}`);
console.log(`kind:     ${artifact.kind}`);
console.log(`built:    ${artifact.built}`);
console.log(`sha256:   ${artifact.sha256}\n`);

const rows = [];
for (const v of VENDORS) {
  if (only && only !== v.key) continue;
  const client = startArtifactServer(artifact);
  try {
    await client.handshake();
    const origin = new URL(v.url).origin;
    const attached = await client.tool("bridge_attach", {
      grant: grantFor(origin, `trackc-${v.key}`),
      url: v.url,
      scope: { kind: "all_forms" },
    });
    if (!attached.sessionId) throw new Error(`attach failed: ${JSON.stringify(attached).slice(0, 300)}`);
    const view = attached.initialView ?? (await client.tool("bridge_view", { sessionId: attached.sessionId, scope: { kind: "all_forms" } }));

    // Native <select> and custom comboboxes both surface as role "combobox" — one contract.
    // Unnamed fields are INCLUDED: Lever ships selects with no accessible name, and hiding
    // them behind a name filter would have quietly excluded the hardest real case.
    const fields = (view.elements ?? []).filter((e) => e.role === "combobox" && e.disabled !== true && e.visible !== false);
    console.log(`${v.vendor} — ${v.url}`);
    console.log(`  ${fields.length} selectable field(s): ${fields.map((f) => `${f.name || "(unnamed)"} [${f.widgetKind}]`).join(" | ") || "none"}`);

    for (const f of fields) {
      // Name-addressed when the page gives us a name; ref-addressed otherwise. Which one was
      // needed is itself a Track C result, so it goes in the table.
      const named = (f.name ?? "").trim() !== "";
      const target = named ? { role: "combobox", name: f.name } : { ref: f.ref };
      const teach = await client.tool("bridge_act", {
        sessionId: attached.sessionId,
        batch: { actions: [{ op: "select", target, value: "__no_such_option_zzz__" }] },
      });
      const tf = teach.results?.[0]?.failure ?? {};
      const taught = Array.isArray(tf.availableOptions) ? tf.availableOptions.find((o) => (o ?? "").trim() !== "") : undefined;
      const recover = taught
        ? await client.tool("bridge_act", { sessionId: attached.sessionId, batch: { actions: [{ op: "select", target, value: taught }] } })
        : undefined;
      const status = recover?.results?.[0]?.status ?? "skipped";
      rows.push({
        vendor: v.vendor,
        field: named ? f.name : "(no accessible name)",
        addressedBy: named ? "name" : "ref",
        widgetKind: f.widgetKind ?? "unknown",
        teachReason: tf.reason ?? "(none)",
        taught: Array.isArray(tf.availableOptions) ? tf.availableOptions.length : 0,
        recoverValue: taught,
        recover: status,
        failure: recover?.results?.[0]?.failure,
      });
      console.log(
        `    ${named ? f.name : "(unnamed → by ref)"}: teach=${tf.reason}(${Array.isArray(tf.availableOptions) ? tf.availableOptions.length : 0} opts) → recover=${status}` +
          (status !== "verified" && recover ? ` ${JSON.stringify(recover.results?.[0]?.failure ?? {})}` : ""),
      );
    }
    console.log("");
  } catch (err) {
    console.log(`  ERROR: ${String(err).slice(0, 300)}\n`);
    rows.push({ vendor: v.vendor, field: "(attach)", widgetKind: "-", teachReason: "error", taught: 0, recover: String(err).slice(0, 120) });
  } finally {
    client.stop();
  }
}

console.log("\n| vendor | field | addressed by | widgetKind | teach | options taught | recover |");
console.log("|---|---|---|---|---|---:|---|");
for (const r of rows) {
  console.log(`| ${r.vendor} | ${(r.field ?? "").slice(0, 60)} | ${r.addressedBy ?? "-"} | ${r.widgetKind} | ${r.teachReason} | ${r.taught} | ${r.recover} |`);
}
const unnamed = rows.filter((r) => r.addressedBy === "ref").length;
if (unnamed) console.log(`\n${unnamed} field(s) had NO accessible name and could only be addressed by ref — a real-vendor gap, recorded not hidden.`);

const attempted = rows.filter((r) => r.teachReason === "option_not_found" && r.taught > 0);
const ok = attempted.filter((r) => r.recover === "verified");
console.log(`\nC3 teach-and-recover: ${ok.length}/${attempted.length} verified`);
const lied = rows.filter((r) => r.teachReason === "option_not_found" && r.taught === 0);
console.log(`fields reporting the ambiguous "availableOptions: []": ${lied.length}`);
process.exit(attempted.length > 0 && ok.length === attempted.length ? 0 : 1);
