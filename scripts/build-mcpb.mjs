#!/usr/bin/env node
/**
 * Build browser-bridge.mcpb from a clean checkout.
 *
 * NOT byte-reproducible: the .mcpb is a zip and zips embed mtimes, so two builds of identical
 * code produce different bundle hashes (measured: c31d0b82… vs e9de3b83… with byte-identical
 * contents). The stable identity is the sha256 of server/index.js, printed below alongside the
 * bundle hash — that is the number that answers "is the fix in the thing we ship".
 *   1. esbuild the mcp-server bin (all workspace deps inlined; Playwright external)
 *   2. write manifest.json + package.json
 *   3. vendor Playwright (pinned to the workspace version; NO browser download)
 *   4. pack to a .mcpb (uses `mcpb` if on PATH, else a plain `zip` — the format is a zip)
 *
 * Prereq: `pnpm build` (so packages/mcp-server/dist/bin.js exists). Chromium is NOT bundled —
 * the installer runs `pnpm exec playwright install chromium` (same pinned version).
 *
 * Usage: node scripts/build-mcpb.mjs [outPath]   (default: ~/Desktop/scratchpad/browser-bridge.mcpb)
 */
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binJs = join(root, "packages/mcp-server/dist/bin.js");
if (!existsSync(binJs)) {
  console.error(`Build the repo first (missing ${binJs}). Run: pnpm build`);
  process.exit(1);
}
const pwVersion = JSON.parse(readFileSync(join(root, "node_modules/playwright/package.json"), "utf8")).version;

// One definition of the canonical path, shared with every gate (scripts/lib/artifact.mjs).
const { DISTRIBUTABLE } = await import("./lib/artifact.mjs");
const out = process.argv[2] || DISTRIBUTABLE;
mkdirSync(dirname(out), { recursive: true });

const work = mkdtempSync(join(tmpdir(), "bb-mcpb-"));
mkdirSync(join(work, "server"), { recursive: true });

const manifest = {
  manifest_version: "0.2",
  name: "browser-bridge",
  display_name: "Browser Bridge",
  version: "0.0.1",
  description:
    "Model-agnostic runtime that lets any AI operate a browser at machine speed. The complete 8-tool bridge surface (plan §11) over an isolated Playwright browser. Needs Chromium " +
    pwVersion +
    " in the Playwright cache (run: pnpm exec playwright install chromium).",
  author: { name: "Browser Bridge" },
  server: {
    type: "node",
    entry_point: "server/index.js",
    // user_config values are substituted into env via ${user_config.KEY} — the exact syntax
    // per the MCPB manifest spec (env substitution confirmed by the spec's own example).
    mcp_config: {
      command: "node",
      args: ["${__dirname}/server/index.js"],
      env: {
        BB_EVAL_LOG: "${user_config.eval_log_path}",
        BB_HEADLESS: "${user_config.headless}",
      },
    },
  },
  user_config: {
    eval_log_path: {
      type: "string",
      title: "Eval log path",
      description: "JSONL path for live-tier eval telemetry (BB_EVAL_LOG). Leave empty to disable.",
      required: false,
    },
    headless: {
      type: "boolean",
      title: "Headless browser",
      description: "Run the browser headless (true) or visible so you can watch it (false).",
      default: true,
    },
  },
  tools: [
    { name: "bridge_attach", description: "Attach a tab/session; binds a TaskGrant; returns capabilities + the first SemanticView." },
    { name: "bridge_view", description: "Return a compact SemanticView for a scope." },
    { name: "bridge_act", description: "Execute an Action batch; returns a verified, exceptions-only BatchResult." },
    { name: "bridge_fill_record", description: "Fill a form from a structured record in one call." },
    { name: "bridge_run_pattern", description: "Harvest many URLs in parallel under the grant + crawl policy; content stays local." },
    { name: "bridge_harvest", description: "Query the local harvested corpus: search | list | chunked export." },
    { name: "bridge_screenshot", description: "ROI screenshot: element | form | viewport | full." },
    { name: "bridge_confirm", description: "Ask the confirm UI to surface a pending, daemon-built confirmation." },
  ],
};

console.log("1/4 esbuild mcp-server (Playwright external)…");
await build({
  entryPoints: [binJs],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  external: ["playwright", "playwright-core"],
  outfile: join(work, "server/index.js"),
});

console.log("2/4 write manifest + package.json…");
writeFileSync(join(work, "manifest.json"), JSON.stringify(manifest, null, 2));
writeFileSync(
  join(work, "package.json"),
  JSON.stringify({ name: "browser-bridge-mcpb", version: "0.0.1", type: "module", private: true, dependencies: { playwright: pwVersion } }, null, 2),
);

console.log(`3/4 vendor playwright@${pwVersion} (no browser download)…`);
execFileSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], {
  cwd: work,
  stdio: "inherit",
  env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" },
});

console.log("4/4 pack → .mcpb…");
rmSync(out, { force: true });
try {
  execFileSync("mcpb", ["pack", ".", out], { cwd: work, stdio: "ignore" });
} catch {
  execFileSync("zip", ["-r", "-q", "-X", out, "."], { cwd: work }); // .mcpb IS a zip
}
const sha = createHash("sha256").update(readFileSync(out)).digest("hex");
const serverSha = createHash("sha256").update(readFileSync(join(work, "server/index.js"))).digest("hex");
rmSync(work, { recursive: true, force: true });
console.log(`\nbuilt: ${out}\nsha256 (bundle, changes every build): ${sha}\nsha256 (server/index.js, the code): ${serverSha}`);
