import { randomUUID } from "node:crypto";
import type { WaitCondition, PageCondition } from "@browser-bridge/protocol";
import type {
  BrowserBackend,
  BrowserPage,
  PrimitiveOutcome,
  PrimitiveReason,
  WaitOutcome,
  ScreenshotRoi,
  ScreenshotResult,
  ElementStateResult,
} from "@browser-bridge/backend";
import type { RawView, ExtractOptions } from "@browser-bridge/semantic-engine";
import type { RelayTransport } from "./transport.js";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function reasonOf(error: string | undefined): PrimitiveReason {
  if (error === "not_found") return "not_found";
  if (error === "disabled") return "disabled";
  if (error === "not_visible") return "not_visible";
  if (error === "not_editable") return "not_editable";
  return "error";
}

function matchState(state: ElementStateResult, want: string): boolean {
  switch (want) {
    case "visible": return state.found && state.visible;
    case "hidden": return !state.found || !state.visible;
    case "enabled": return state.found && !state.disabled;
    case "disabled": return state.found && state.disabled;
    case "attached": return state.found;
    case "detached": return !state.found;
    default: return false;
  }
}

/**
 * A page driven through the extension relay. `url()` is synchronous (the execution engine
 * needs it) so it returns the value cached from the last `captureRaw`. Screenshots are the
 * one op the extension path does not do (use hybrid/CDP) — surfaced honestly.
 */
class ExtensionPage implements BrowserPage {
  readonly pageId = randomUUID();
  private cachedUrl = "";

  constructor(private readonly transport: RelayTransport) {}

  private async data<T>(op: Parameters<RelayTransport["send"]>[0], args: Record<string, unknown>): Promise<T> {
    const r = await this.transport.send(op, args);
    if (!r.ok) throw new Error(r.error ?? "relay error");
    return r.data as T;
  }

  private async primitive(op: Parameters<RelayTransport["send"]>[0], args: Record<string, unknown>): Promise<PrimitiveOutcome> {
    const r = await this.transport.send(op, args);
    return r.ok ? { ok: true } : { ok: false, reason: reasonOf(r.error), ...(r.error ? { detail: r.error } : {}) };
  }

  async captureRaw(options: ExtractOptions): Promise<RawView> {
    const raw = await this.data<RawView>("captureRaw", options as unknown as Record<string, unknown>);
    this.cachedUrl = raw.url;
    return raw;
  }
  readState(ref: string): Promise<ElementStateResult> {
    return this.data<ElementStateResult>("readState", { ref });
  }
  fillText(ref: string, value: string): Promise<PrimitiveOutcome> {
    return this.primitive("fillText", { ref, value });
  }
  setChecked(ref: string, checked: boolean): Promise<PrimitiveOutcome> {
    return this.primitive("setChecked", { ref, checked });
  }
  selectOption(ref: string, values: string[]): Promise<PrimitiveOutcome> {
    return this.primitive("selectOption", { ref, values });
  }
  click(ref: string): Promise<PrimitiveOutcome> {
    return this.primitive("click", { ref });
  }
  press(ref: string | null, key: string): Promise<PrimitiveOutcome> {
    return this.primitive("press", { ref, key });
  }
  scroll(ref: string | null, direction: "up" | "down", amount?: number): Promise<PrimitiveOutcome> {
    return this.primitive("scroll", { ref, direction, amount });
  }

  async waitFor(condition: WaitCondition, timeoutMs: number): Promise<WaitOutcome> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.evaluateWait(condition)) return { satisfied: true, timedOut: false };
      await sleep(75);
    }
    return { satisfied: false, timedOut: true };
  }

  private async evaluateWait(condition: WaitCondition): Promise<boolean> {
    switch (condition.type) {
      case "element_state": {
        if (!condition.target.ref) return false;
        return matchState(await this.readState(condition.target.ref), condition.state);
      }
      case "network_idle":
        return true; // the extension path relies on the SW's load signals; treated as idle
      case "url_changed":
        return true;
      case "text_present": {
        const raw = await this.captureRaw({ scope: { kind: "full" }, refPrefix: "w-" });
        return (raw.content ?? []).some((c) => c.text.includes(condition.text));
      }
      case "form_valid": {
        const raw = await this.captureRaw({ scope: { kind: "all_forms" }, refPrefix: "w-" });
        return raw.forms.every((f) => f.valid !== false);
      }
      case "dialog":
      case "download_complete":
        return false;
    }
  }

  async evaluateCondition(condition: PageCondition): Promise<boolean> {
    switch (condition.type) {
      case "element_present":
        return condition.target.ref ? (await this.readState(condition.target.ref)).found : false;
      case "element_state":
        return condition.target.ref ? matchState(await this.readState(condition.target.ref), condition.state) : false;
      case "text_present": {
        const raw = await this.captureRaw({ scope: { kind: "full" }, refPrefix: "c-" });
        return (raw.content ?? []).some((c) => c.text.includes(condition.text));
      }
      case "url_matches":
        return true;
      case "form_valid": {
        const raw = await this.captureRaw({ scope: { kind: "all_forms" }, refPrefix: "c-" });
        return raw.forms.every((f) => f.valid !== false);
      }
    }
  }

  async screenshot(_roi: ScreenshotRoi): Promise<ScreenshotResult> {
    // The extension path does not capture screenshots; use hybrid/CDP for pixels.
    return { bytesBase64: "", contentType: "image/png", truncated: true };
  }

  url(): string {
    return this.cachedUrl;
  }
  origin(): string {
    try {
      return new URL(this.cachedUrl).origin;
    } catch {
      return "";
    }
  }
  async goto(url: string): Promise<void> {
    await this.transport.send("goto", { url });
    this.cachedUrl = url;
  }
  async close(): Promise<void> {
    // The signed-in tab persists; nothing to close in the extension path.
  }
}

/** A BrowserBackend over the extension relay. One attached tab (the operate-granted one). */
export class ExtensionBackend implements BrowserBackend {
  constructor(private readonly transport: RelayTransport) {}

  async attach(url?: string): Promise<BrowserPage> {
    const page = new ExtensionPage(this.transport);
    if (url) await page.goto(url);
    // Prime the url cache from the live tab.
    await page.captureRaw({ scope: { kind: "viewport" }, refPrefix: "init-" }).catch(() => undefined);
    return page;
  }

  async shutdown(): Promise<void> {
    // The socket relay owns the connection lifecycle.
  }
}
