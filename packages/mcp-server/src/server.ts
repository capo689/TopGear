import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SCHEMA_VERSION } from "@browser-bridge/protocol";
import { AttachShape, ViewShape, ActShape, FillRecordShape, RunPatternShape, HarvestShape, ScreenshotShape, ConfirmShape } from "./schemas.js";
import type { AttachInput, ViewInput, ActInput, FillRecordInput, RunPatternInput, HarvestInput, ScreenshotInput } from "./schemas.js";
import { handleAttach, handleView, handleAct, handleFillRecord, handleRunPattern, handleHarvest, handleScreenshot, handleConfirm, type DaemonLike } from "./handlers.js";

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
    { description: "Attach a tab/session; binds a TaskGrant; returns capabilities + the first SemanticView (initialView). Pass `scope` to match the task (e.g. all_forms for a form, content for a read) so the initial view is usable without a follow-up bridge_view; defaults to full.", inputSchema: AttachShape as never },
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
    "bridge_fill_record",
    { description: "Fill a form from a structured record in one call — deterministic field matching, 0 mid-form turns.", inputSchema: FillRecordShape as never },
    (async (args: FillRecordInput) => jsonContent(await handleFillRecord(daemon, args))) as never,
  );
  server.registerTool(
    "bridge_run_pattern",
    { description: "Harvest many URLs in parallel under the grant + crawl policy; content goes to the local store.", inputSchema: RunPatternShape as never },
    (async (args: RunPatternInput) => jsonContent(await handleRunPattern(daemon, args))) as never,
  );
  server.registerTool(
    "bridge_harvest",
    { description: "Query the local harvested corpus: search | list | chunked export. Content stays on the machine.", inputSchema: HarvestShape as never },
    (async (args: HarvestInput) => jsonContent(handleHarvest(daemon, args))) as never,
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
