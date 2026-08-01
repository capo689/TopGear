#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Daemon } from "@browser-bridge/daemon";
import { createPlaywrightBackend } from "@browser-bridge/browser-playwright";
import { createMcpServer } from "./server.js";

/**
 * Dev-channel MCP server over stdio (plan §13 phase 1). Registers with a host CLI via a
 * one-line MCP config. Uses the isolated Playwright backend; the extension relay (real
 * signed-in profile) attaches through the same daemon.
 */
async function main(): Promise<void> {
  const backend = await createPlaywrightBackend({ headless: process.env.BB_HEADLESS !== "false" });
  const daemon = new Daemon({ backend });
  const server = createMcpServer(daemon);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`browser-bridge-mcp failed to start: ${String(err)}\n`);
  process.exit(1);
});
