import type { AttachResult } from "@browser-bridge/daemon";
import type { SemanticView, BatchResult, ViewScope, ActionBatch, FillRecordRequest, FillRecordResult } from "@browser-bridge/protocol";
import type { ScreenshotResult, ScreenshotRoi } from "@browser-bridge/backend";
import type { AttachInput, ViewInput, ActInput, FillRecordInput, ScreenshotInput } from "./schemas.js";

/**
 * The subset of the daemon the MCP tools need. Kept structural so handlers can be
 * unit-tested with a fake and the SDK wiring stays a thin skin (zero logic in adapters).
 */
export interface DaemonLike {
  attach(req: { grant: AttachInput["grant"]; url?: string }): Promise<AttachResult>;
  view(sessionId: string, scope: ViewScope): Promise<SemanticView>;
  act(sessionId: string, batch: ActionBatch): Promise<BatchResult>;
  fillRecord(sessionId: string, req: FillRecordRequest): Promise<FillRecordResult>;
  screenshot(sessionId: string, roi: ScreenshotRoi): Promise<ScreenshotResult>;
}

export function handleAttach(daemon: DaemonLike, input: AttachInput): Promise<AttachResult> {
  return daemon.attach(input.url === undefined ? { grant: input.grant } : { grant: input.grant, url: input.url });
}

export function handleView(daemon: DaemonLike, input: ViewInput): Promise<SemanticView> {
  return daemon.view(input.sessionId, input.scope);
}

export function handleAct(daemon: DaemonLike, input: ActInput): Promise<BatchResult> {
  return daemon.act(input.sessionId, input.batch);
}

export function handleFillRecord(daemon: DaemonLike, input: FillRecordInput): Promise<FillRecordResult> {
  return daemon.fillRecord(
    input.sessionId,
    input.ambiguityPolicy === undefined ? { record: input.record } : { record: input.record, ambiguityPolicy: input.ambiguityPolicy },
  );
}

export function handleScreenshot(daemon: DaemonLike, input: ScreenshotInput): Promise<ScreenshotResult> {
  return daemon.screenshot(input.sessionId, input.roi);
}

/**
 * bridge_confirm only REQUESTS that the confirm UI surface a pending, daemon-built
 * confirmation. It cannot describe or create one (INV-9). The capability id already
 * travels to the model in the interrupted BatchResult; approval happens in the UI.
 */
export function handleConfirm(): { surfaced: true } {
  return { surfaced: true };
}
