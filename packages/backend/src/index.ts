import type { WaitCondition, PageCondition } from "@browser-bridge/protocol";
import type { RawView, ExtractOptions, ElementStateResult } from "@browser-bridge/semantic-engine";

/**
 * @browser-bridge/backend — the contract the execution engine drives, implemented by
 * the CDP/Playwright backend (bulk/attach) and the extension relay chain (signed-in
 * profile). Primitives operate by `ref` (a data-bb-ref the extractor assigns); the
 * execution engine handles re-resolution when a ref goes stale.
 */

export type PrimitiveReason =
  | "not_found"
  | "not_editable"
  | "not_visible"
  | "disabled"
  | "option_not_found"
  | "error";

export type PrimitiveOutcome =
  | { ok: true }
  | { ok: false; reason: PrimitiveReason; detail?: string; availableOptions?: string[] };

export interface WaitOutcome {
  satisfied: boolean;
  timedOut: boolean;
}

export type ScreenshotRoi =
  | { kind: "viewport" }
  | { kind: "full" }
  | { kind: "element"; ref: string }
  | { kind: "form"; ref: string };

export interface ScreenshotResult {
  bytesBase64: string;
  contentType: "image/png";
  width?: number;
  height?: number;
  /** True if the image exceeded the protocol cap and was omitted/downscaled. */
  truncated?: boolean;
}

export type { ElementStateResult };

/** A single attached page/tab. */
export interface BrowserPage {
  readonly pageId: string;

  /** Extract a raw view at a scope (the host maps it to the protocol SemanticView). */
  captureRaw(options: ExtractOptions): Promise<RawView>;
  /** Targeted read-back of one element for post-action verification. */
  readState(ref: string): Promise<ElementStateResult>;

  fillText(ref: string, value: string): Promise<PrimitiveOutcome>;
  setChecked(ref: string, checked: boolean): Promise<PrimitiveOutcome>;
  selectOption(ref: string, values: string[]): Promise<PrimitiveOutcome>;
  click(ref: string): Promise<PrimitiveOutcome>;
  press(ref: string | null, key: string): Promise<PrimitiveOutcome>;
  scroll(ref: string | null, direction: "up" | "down", amount?: number): Promise<PrimitiveOutcome>;

  waitFor(condition: WaitCondition, timeoutMs: number): Promise<WaitOutcome>;
  /** Evaluate a page condition for an `if` action. */
  evaluateCondition(condition: PageCondition): Promise<boolean>;

  /** ROI screenshot — the exception handler, not the default path. */
  screenshot(roi: ScreenshotRoi): Promise<ScreenshotResult>;

  url(): string;
  origin(): string;
  goto(url: string): Promise<void>;
  close(): Promise<void>;
}

/** A backend that can attach pages. */
export interface BrowserBackend {
  attach(url?: string): Promise<BrowserPage>;
  shutdown(): Promise<void>;
}
