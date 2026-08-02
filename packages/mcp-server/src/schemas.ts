import { z } from "zod";
import { TaskGrant, ViewScope, ActionBatch, FieldValue, AmbiguityPolicy } from "@browser-bridge/protocol";

/** ROI for bridge_screenshot. */
export const ScreenshotRoiSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("viewport") }),
  z.object({ kind: z.literal("full") }),
  z.object({ kind: z.literal("element"), ref: z.string() }),
  z.object({ kind: z.literal("form"), ref: z.string() }),
]);

// Raw shapes (ZodRawShape) for MCP tool registration — flat and simple (INV-8).
export const AttachShape = { grant: TaskGrant, url: z.string().optional() } as const;
export const ViewShape = { sessionId: z.string(), scope: ViewScope } as const;
export const ActShape = { sessionId: z.string(), batch: ActionBatch } as const;
export const FillRecordShape = {
  sessionId: z.string(),
  record: z.record(FieldValue),
  ambiguityPolicy: AmbiguityPolicy.optional(),
} as const;
export const ScreenshotShape = { sessionId: z.string(), roi: ScreenshotRoiSchema } as const;
export const ConfirmShape = { sessionId: z.string() } as const;

export const AttachInput = z.object(AttachShape);
export const ViewInput = z.object(ViewShape);
export const ActInput = z.object(ActShape);
export const FillRecordInput = z.object(FillRecordShape);
export const ScreenshotInput = z.object(ScreenshotShape);
export const ConfirmInput = z.object(ConfirmShape);

export type AttachInput = z.infer<typeof AttachInput>;
export type ViewInput = z.infer<typeof ViewInput>;
export type ActInput = z.infer<typeof ActInput>;
export type FillRecordInput = z.infer<typeof FillRecordInput>;
export type ScreenshotInput = z.infer<typeof ScreenshotInput>;
export type ConfirmInput = z.infer<typeof ConfirmInput>;

/** The tool surface (plan §11). M1 shipped 5; M2 adds bridge_fill_record. run_pattern /
 * bridge_harvest arrive at M3 to complete the 8. No ninth tool without an amendment. */
export const TOOL_NAMES = ["bridge_attach", "bridge_view", "bridge_act", "bridge_fill_record", "bridge_screenshot", "bridge_confirm"] as const;
