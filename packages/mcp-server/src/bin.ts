#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Daemon, telemetryStatusMessage } from "@browser-bridge/daemon";
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
  // D5: state the telemetry condition once at startup so "silently off after an update" is
  // visible in the host's log rather than discovered later from an empty JSONL.
  process.stderr.write(telemetryStatusMessage(process.env) + "\n");
  const harvestBackend = await createPlaywrightBackend({ headless: true, isolated: true });

  let backend: BrowserBackend;
  let closeRelay: (() => Promise<void>) | undefined;
  if (process.env.BB_BACKEND === "extension") {
    const socketPath = process.env.BB_SOCKET ?? "/tmp/browser-bridge.sock";
    const relay = startSocketRelay(socketPath, randomUUID());
    closeRelay = relay.close;
    process.stderr.write(`browser-bridge: extension relay listening on ${socketPath} — load the extension and click "Grant Operate on this tab"\n`);
    backend = new ExtensionBackend(relay.transport);
  } else {
    // Tolerant of however the MCPB host renders a boolean user_config value into the env
    // string (the spec doesn't pin it): headless UNLESS it clearly reads false. Default headless.
    const headless = !/^(false|0|no|off)$/i.test((process.env.BB_HEADLESS ?? "").trim());
    backend = await createPlaywrightBackend({ headless });
  }

  const daemon = new Daemon({ backend, harvestBackend });
  const server = createMcpServer(daemon);
  await server.connect(new StdioServerTransport());

  // Exit when the MCP client goes away. Without this, the open Chromium handles keep the
  // event loop alive after the client closes stdin (or sends SIGTERM), leaving an orphaned
  // node + Chromium behind every time a client restarts.
  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    setTimeout(() => process.exit(0), 3000).unref();
    void Promise.allSettled([backend.shutdown(), harvestBackend.shutdown(), closeRelay?.()]).then(() => process.exit(0));
  };
  process.stdin.on("end", shutdown);
  process.stdin.on("close", shutdown);
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  process.stderr.write(`browser-bridge-mcp failed to start: ${String(err)}\n`);
  process.exit(1);
});
