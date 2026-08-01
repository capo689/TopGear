import { chromium, type Browser, type Page, type Locator } from "playwright";
import { randomUUID } from "node:crypto";
import type { WaitCondition, PageCondition } from "@browser-bridge/protocol";
import type {
  BrowserBackend,
  BrowserPage,
  PrimitiveOutcome,
  WaitOutcome,
  ScreenshotRoi,
  ScreenshotResult,
} from "@browser-bridge/backend";

const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;
import {
  pageExtractor,
  readElementState,
  type ExtractOptions,
  type RawView,
  type ElementStateResult,
} from "@browser-bridge/semantic-engine";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp("^" + escaped + "$");
}

function matchState(state: ElementStateResult, want: string): boolean {
  switch (want) {
    case "visible":
      return state.found && state.visible;
    case "hidden":
      return !state.found || !state.visible;
    case "enabled":
      return state.found && !state.disabled;
    case "disabled":
      return state.found && state.disabled;
    case "attached":
      return state.found;
    case "detached":
      return !state.found;
    default:
      return false;
  }
}

class PlaywrightPage implements BrowserPage {
  readonly pageId = randomUUID();

  constructor(private readonly page: Page) {}

  private loc(ref: string): Locator {
    return this.page.locator(`[data-bb-ref="${ref}"]`);
  }

  captureRaw(options: ExtractOptions): Promise<RawView> {
    return this.page.evaluate(pageExtractor, options);
  }

  readState(ref: string): Promise<ElementStateResult> {
    return this.page.evaluate(readElementState, ref);
  }

  private async precheck(ref: string): Promise<PrimitiveOutcome | null> {
    const s = await this.readState(ref);
    if (!s.found) return { ok: false, reason: "not_found" };
    if (s.disabled) return { ok: false, reason: "disabled" };
    if (!s.visible) return { ok: false, reason: "not_visible" };
    return null;
  }

  async fillText(ref: string, value: string): Promise<PrimitiveOutcome> {
    const bad = await this.precheck(ref);
    if (bad) return bad;
    try {
      await this.loc(ref).fill(value, { timeout: 5000 });
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: "error", detail: String(err) };
    }
  }

  async setChecked(ref: string, checked: boolean): Promise<PrimitiveOutcome> {
    const bad = await this.precheck(ref);
    if (bad) return bad;
    try {
      await this.loc(ref).setChecked(checked, { timeout: 5000 });
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: "error", detail: String(err) };
    }
  }

  async selectOption(ref: string, values: string[]): Promise<PrimitiveOutcome> {
    const bad = await this.precheck(ref);
    if (bad) return bad;
    let options: { value: string; label: string }[];
    try {
      options = await this.loc(ref).evaluate((el: Element) => {
        const sel = el as HTMLSelectElement;
        return Array.from(sel.options).map((o) => ({ value: o.value, label: o.label || o.text }));
      });
    } catch (err) {
      return { ok: false, reason: "error", detail: String(err) };
    }
    const mapped: { value: string }[] = [];
    for (const wanted of values) {
      const opt = options.find((o) => o.value === wanted || o.label === wanted);
      if (!opt) {
        return { ok: false, reason: "option_not_found", availableOptions: options.map((o) => o.label) };
      }
      mapped.push({ value: opt.value });
    }
    try {
      await this.loc(ref).selectOption(mapped, { timeout: 5000 });
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: "error", detail: String(err) };
    }
  }

  async click(ref: string): Promise<PrimitiveOutcome> {
    const s = await this.readState(ref);
    if (!s.found) return { ok: false, reason: "not_found" };
    if (!s.visible) return { ok: false, reason: "not_visible" };
    try {
      await this.loc(ref).click({ timeout: 5000 });
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: "error", detail: String(err) };
    }
  }

  async press(ref: string | null, key: string): Promise<PrimitiveOutcome> {
    try {
      if (ref) await this.loc(ref).press(key, { timeout: 5000 });
      else await this.page.keyboard.press(key);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: "error", detail: String(err) };
    }
  }

  async scroll(ref: string | null, direction: "up" | "down", amount?: number): Promise<PrimitiveOutcome> {
    const delta = (direction === "down" ? 1 : -1) * (amount ?? 400);
    try {
      if (ref) await this.loc(ref).scrollIntoViewIfNeeded({ timeout: 5000 });
      else await this.page.evaluate((d) => window.scrollBy(0, d), delta);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: "error", detail: String(err) };
    }
  }

  private async resolveState(target: { ref?: string; name?: string } | undefined): Promise<ElementStateResult | null> {
    if (target?.ref) return this.readState(target.ref);
    if (target?.name) {
      const raw = await this.captureRaw({ scope: { kind: "full" }, refPrefix: "wait-" });
      const el = raw.elements.find((e) => e.name === target.name);
      if (el) return this.readState(el.ref);
    }
    return null;
  }

  async waitFor(condition: WaitCondition, timeoutMs: number): Promise<WaitOutcome> {
    const deadline = Date.now() + timeoutMs;
    const poll = async (check: () => Promise<boolean>): Promise<WaitOutcome> => {
      while (Date.now() < deadline) {
        if (await check()) return { satisfied: true, timedOut: false };
        await sleep(50);
      }
      return { satisfied: false, timedOut: true };
    };

    switch (condition.type) {
      case "network_idle":
        try {
          await this.page.waitForLoadState("networkidle", { timeout: timeoutMs });
          return { satisfied: true, timedOut: false };
        } catch {
          return { satisfied: false, timedOut: true };
        }
      case "url_changed":
        return poll(async () => (condition.urlGlob ? globToRegExp(condition.urlGlob).test(this.page.url()) : true));
      case "text_present":
        return poll(async () => (await this.page.content()).includes(condition.text));
      case "element_state":
        return poll(async () => {
          const s = await this.resolveState(condition.target);
          return s !== null && matchState(s, condition.state);
        });
      case "form_valid":
        return poll(async () => {
          const raw = await this.captureRaw({ scope: { kind: "all_forms" }, refPrefix: "wait-" });
          return raw.forms.every((f) => f.valid !== false);
        });
      case "dialog":
      case "download_complete":
        // Not wired for M1; these surface as interruptions instead.
        return { satisfied: false, timedOut: true };
    }
  }

  async evaluateCondition(condition: PageCondition): Promise<boolean> {
    switch (condition.type) {
      case "element_present": {
        const s = await this.resolveState(condition.target);
        return s !== null && s.found;
      }
      case "element_state": {
        const s = await this.resolveState(condition.target);
        return s !== null && matchState(s, condition.state);
      }
      case "text_present":
        return (await this.page.content()).includes(condition.text);
      case "url_matches":
        return globToRegExp(condition.urlGlob).test(this.page.url());
      case "form_valid": {
        const raw = await this.captureRaw({ scope: { kind: "all_forms" }, refPrefix: "cond-" });
        return raw.forms.every((f) => f.valid !== false);
      }
    }
  }

  async screenshot(roi: ScreenshotRoi): Promise<ScreenshotResult> {
    let buffer: Buffer;
    if (roi.kind === "full") buffer = await this.page.screenshot({ fullPage: true });
    else if (roi.kind === "viewport") buffer = await this.page.screenshot();
    else buffer = await this.loc(roi.ref).screenshot();

    if (buffer.byteLength > MAX_SCREENSHOT_BYTES) {
      return { bytesBase64: "", contentType: "image/png", truncated: true };
    }
    return { bytesBase64: buffer.toString("base64"), contentType: "image/png" };
  }

  url(): string {
    return this.page.url();
  }

  origin(): string {
    try {
      return new URL(this.page.url()).origin;
    } catch {
      return "";
    }
  }

  async goto(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: "domcontentloaded" });
  }

  async close(): Promise<void> {
    await this.page.close();
  }
}

export interface PlaywrightBackendOptions {
  headless?: boolean;
}

class PlaywrightBackend implements BrowserBackend {
  constructor(private readonly browser: Browser) {}

  async attach(url?: string): Promise<BrowserPage> {
    const page = await this.browser.newPage();
    const wrapped = new PlaywrightPage(page);
    if (url) await wrapped.goto(url);
    return wrapped;
  }

  async shutdown(): Promise<void> {
    await this.browser.close();
  }
}

/** Launch an isolated Chromium and return a BrowserBackend over it. */
export async function createPlaywrightBackend(options: PlaywrightBackendOptions = {}): Promise<BrowserBackend> {
  const browser = await chromium.launch({ headless: options.headless ?? true });
  return new PlaywrightBackend(browser);
}
