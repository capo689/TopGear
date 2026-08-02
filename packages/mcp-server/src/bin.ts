#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Daemon } from "@browser-bridge/daemon";
import { createPlaywrightBackend } from "@browser-bridge/browser-playwright";
import { startSocketRelay, ExtensionBackend } from "@browser-bridge/browser-extension";
import type { BrowserBackend } from "@browser-bridge/backend";
import { createMcpServer } from "./server.js";

/**
 * Dev-channel MCP server over stdio (plan §13 phase 1). Registers with a host CLI via a
 * one-line MCP config.
 *
 * BB_BACKEND=extension  → drive the user's signed-in Chrome via the relay chain: this
 *   starts the daemon-side socket listener; load the extension and click "Grant Operate"
 *   so the shim connects. Otherwise the isolated Playwright backend is used.
 * Harvest (bridge_run_pattern) always uses an isolated Playwright browser.
 */
async function main(): Promise<void> {
  const harvestBackend = await createPlaywrightBackend({ headless: true, isolated: true });

  let backend: BrowserBackend;
  if (process.env.BB_BACKEND === "extension") {
    const socketPath = process.env.BB_SOCKET ?? "/tmp/browser-bridge.sock";
    const relay = startSocketRelay(socketPath, randomUUID());
    process.stderr.write(`browser-bridge: extension relay listening on ${socketPath} — load the extension and click "Grant Operate on this tab"\n`);
    backend = new ExtensionBackend(relay.transport);
  } else {
    backend = await createPlaywrightBackend({ headless: process.env.BB_HEADLESS !== "false" });
  }

  const daemon = new Daemon({ backend, harvestBackend });
  const server = createMcpServer(daemon);
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  process.stderr.write(`browser-bridge-mcp failed to start: ${String(err)}\n`);
  process.exit(1);
});
