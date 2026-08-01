import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SCHEMA_VERSION } from "@browser-bridge/protocol";
import { AttachShape, ViewShape, ActShape, ScreenshotShape, ConfirmShape } from "./schemas.js";
import type { AttachInput, ViewInput, ActInput, ScreenshotInput } from "./schemas.js";
import { handleAttach, handleView, handleAct, handleScreenshot, handleConfirm, type DaemonLike } from "./handlers.js";

function jsonContent(obj: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj) }] };
}

/**
 * The MCP surface: the 5 M1 tools over the daemon. A THIN skin — zero logic here; all
 * behavior lives in the daemon/execution engine (plan §11). Input is re-validated at
 * the boundary by the SDK against the protocol Zod shapes.
 */
export function createMcpServer(daemon: DaemonLike): McpServer {
  const server = new McpServer({ name: "browser-bridge", version: SCHEMA_VERSION });

  server.registerTool(
    "bridge_attach",
    { description: "Attach a tab/session; binds a TaskGrant; returns capabilities + schema version.", inputSchema: AttachShape as never },
    (async (args: AttachInput) => jsonContent(await handleAttach(daemon, args))) as never,
  );
  server.registerTool(
    "bridge_view",
    { description: "Return a compact SemanticView for a scope.", inputSchema: ViewShape as never },
    (async (args: ViewInput) => jsonContent(await handleView(daemon, args))) as never,
  );
  server.registerTool(
    "bridge_act",
    { description: "Execute an Action batch and return a BatchResult (verified, exceptions-only).", inputSchema: ActShape as never },
    (async (args: ActInput) => jsonContent(await handleAct(daemon, args))) as never,
  );
  server.registerTool(
    "bridge_screenshot",
    { description: "ROI screenshot: element | form | viewport | full. The exception handler, not the default.", inputSchema: ScreenshotShape as never },
    (async (args: ScreenshotInput) => jsonContent(await handleScreenshot(daemon, args))) as never,
  );
  server.registerTool(
    "bridge_confirm",
    { description: "Request the confirm UI surface a pending, daemon-built confirmation. Cannot describe or create one.", inputSchema: ConfirmShape as never },
    (async () => jsonContent(handleConfirm())) as never,
  );

  return server;
}
