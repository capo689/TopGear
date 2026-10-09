#!/usr/bin/env node
/**
 * End-to-end smoke test of an installed checkout: starts the MCP server exactly the way an
 * MCP client would (stdio), lists the tools, attaches to a tiny local page in the isolated
 * Chromium, reads it, fills a field, and checks the value. No network, no extension.
 *
 * Usage: pnpm smoke [path/to/server.js]   (default: the built packages/mcp-server/dist/bin.js; after `pnpm setup` or `pnpm install && pnpm build && pnpm exec playwright install chromium`)
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const bin = process.argv[2] ? resolve(process.argv[2]) : join(root, "packages/mcp-server/dist/bin.js");
if (!existsSync(bin)) {
  console.error(`✗ ${bin} is missing. Run: pnpm setup`);
  process.exit(1);
}

const page =
  "data:text/html," +
  encodeURIComponent(
    `<title>Smoke</title><h1>Hello from the smoke test</h1>
     <form><label for="n">Name</label><input id="n" name="name"></form>`,
  );

const transport = new StdioClientTransport({ command: process.execPath, args: [bin], stderr: "ignore" });
const client = new Client({ name: "browser-bridge-smoke", version: "0.0.0" });

const step = (msg) => process.stdout.write(`✓ ${msg}\n`);
const call = async (name, args) => {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.[0]?.text ?? "";
  if (res.isError) throw new Error(`${name} returned an error: ${text.slice(0, 500)}`);
  return JSON.parse(text);
};

const timer = setTimeout(() => {
  console.error("✗ timed out after 60s");
  process.exit(1);
}, 60_000);

try {
  await client.connect(transport);
  step("MCP server started over stdio");

  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  if (names.length !== 8) throw new Error(`expected 8 tools, got ${names.join(", ")}`);
  step(`8 tools listed: ${names.join(", ")}`);

  const attach = await call("bridge_attach", {
    url: page,
    scope: { kind: "full" },
    grant: {
      taskId: "smoke",
      allowedOrigins: ["null"],
      allowedRiskTiers: ["low"],
      sensitiveDataDestinations: [],
      budgets: {},
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    },
  });
  const sessionId = attach.sessionId ?? attach.session?.sessionId;
  if (!sessionId) throw new Error(`bridge_attach returned no sessionId: ${JSON.stringify(attach).slice(0, 500)}`);
  step(`bridge_attach opened a session in isolated Chromium (${sessionId})`);

  const fill = await call("bridge_fill_record", { sessionId, record: { name: "Ada Lovelace" } });
  step(`bridge_fill_record: ${JSON.stringify(fill).slice(0, 160)}`);

  const view = await call("bridge_view", { sessionId, scope: { kind: "all_forms" } });
  const json = JSON.stringify(view);
  if (!json.includes("Ada Lovelace")) throw new Error(`filled value not visible in view: ${json.slice(0, 500)}`);
  step("bridge_view shows the filled value (verified read-back)");

  console.log("\nSmoke test passed. The MCP server works; register it with your client (see README).");
  clearTimeout(timer);
  await client.close();
  process.exit(0);
} catch (err) {
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  clearTimeout(timer);
  await client.close().catch(() => {});
  process.exit(1);
}
