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
  if (process.env.BB_BACKEND === "extension") {
    const socketPath = process.env.BB_SOCKET ?? "/tmp/browser-bridge.sock";
    const relay = startSocketRelay(socketPath, randomUUID());
    process.stderr.write(`browser-bridge: extension relay listening on ${socketPath} — load the extension and click "Grant Operate on this tab"\n`);
    backend = new ExtensionBackend(relay.transport);
  } else {
    // Tolerant of however the MCPB host renders a boolean user_config value into the env
    // string (the spec doesn't pin it): headless UNLESS it clearly reads false. Default headless.
    const headless = !/^(false|0|no|off)$/i.test((process.env.BB_HEADLESS ?? "").trim());
    backend = await createPlaywrightBackend({ headless });
  }

  const daemon = new Daemon({ backend, harvestBackend });

  // INV-9: without this channel a high-risk action can be blocked but never approved by
  // anyone, which makes the invariant true only because the path is unreachable. Loopback
  // only, token-gated, ephemeral port. Failure to bind is reported, never swallowed --
  // running without an approval path is a fact the operator needs to know.
  try {
    const { url } = await daemon.startConfirmChannel();
    process.stderr.write(`browser-bridge: confirm channel on ${url} (loopback, token-gated)\n`);
  } catch (err) {
    process.stderr.write(
      `browser-bridge: confirm channel FAILED to start (${String(err)}). High-risk actions cannot be approved in this session.\n`,
    );
  }

  const server = createMcpServer(daemon);
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  process.stderr.write(`browser-bridge-mcp failed to start: ${String(err)}\n`);
  process.exit(1);
});
