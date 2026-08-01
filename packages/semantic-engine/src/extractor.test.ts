import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { startFixtureFarm, type FixtureFarm, FIXTURES } from "@browser-bridge/fixture-farm";
import { pageExtractor } from "./extractor.js";
import type { ExtractOptions, RawView } from "./types.js";
import { toSemanticView } from "./extract.js";
import { diffViews } from "./revision.js";

let farm: FixtureFarm;
let browser: Browser;

const opts = (scope: ExtractOptions["scope"], refPrefix = "v-"): ExtractOptions => ({ scope, refPrefix });

async function extract(page: Page, o: ExtractOptions): Promise<RawView> {
  return page.evaluate(pageExtractor, o);
}

beforeAll(async () => {
  farm = await startFixtureFarm();
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await farm?.close();
});

describe("pageExtractor — native form", () => {
  it("extracts the 20-field form with names, roles, options, and refs", async () => {
    const page = await browser.newPage();
    await page.goto(farm.url + FIXTURES.nativeForm);
    const raw = await extract(page, opts({ kind: "all_forms" }));

    expect(raw.elements.length).toBeGreaterThanOrEqual(20);

    const email = raw.elements.find((e) => e.name === "Email");
    expect(email?.role).toBe("textbox");
    expect(email?.editable).toBe(true);

    const country = raw.elements.find((e) => e.name === "Country");
    expect(country?.widgetKind).toBe("native-select");
    expect(country?.options).toContain("United States");

    const submit = raw.elements.find((e) => e.role === "button" && e.name === "Submit application");
    expect(submit).toBeTruthy();

    // Every extracted element carries a ref and a fingerprint for re-resolution.
    expect(raw.elements.every((e) => e.ref && e.fingerprint)).toBe(true);
    await page.close();
  }, 30_000);

  it("maps to a model-facing SemanticView: untrusted framing, no fingerprints", async () => {
    const page = await browser.newPage();
    await page.goto(farm.url + FIXTURES.nativeForm);
    const raw = await extract(page, opts({ kind: "all_forms" }));
    const { view, fingerprints } = toSemanticView(raw, {
      sessionId: "s1",
      pageId: "p1",
      revision: 0,
      scope: { kind: "all_forms" },
    });

    expect(view.trust.pageContent).toBe("untrusted");
    expect(view.elements.every((e) => !("fingerprint" in e))).toBe(true);
    expect(fingerprints.size).toBe(raw.elements.length);
    // The form's action is surfaced for exfiltration policy.
    expect(view.forms[0]?.action).toContain("/forms/submit");
    await page.close();
  }, 30_000);

  it("redacts password-type field values (INV-4)", async () => {
    const page = await browser.newPage();
    await page.setContent('<form><input id="pw" type="password" value="hunter2" aria-label="Password"></form>');
    const raw = await extract(page, opts({ kind: "all_forms" }));
    const pw = raw.elements.find((e) => e.name === "Password");
    expect(pw?.valueRedacted).toBe(true);
    expect(pw?.value).toBeUndefined();
    await page.close();
  }, 30_000);
});

describe("pageExtractor — hidden-content reading", () => {
  it("reads collapsed-but-present content without expanding, and flags lazy content", async () => {
    const page = await browser.newPage();
    await page.goto(farm.url + FIXTURES.accordion);
    const raw = await extract(page, opts({ kind: "full" }));

    // Collapsed-but-present: the shipping copy is in the DOM though visually hidden.
    const contentText = (raw.content ?? []).map((c) => c.text).join(" ");
    expect(contentText).toContain("Ships in 2 business days");

    // Lazy-on-expand: the warranty header is flagged, its body is not yet present.
    const lazyHeader = raw.elements.find((e) => e.name.includes("Warranty"));
    expect(lazyHeader?.requiresExpand).toBe(true);
    expect(contentText).not.toContain("Two-year limited warranty");
    await page.close();
  }, 30_000);
});

describe("pageExtractor — dependent selects", () => {
  it("reports the state select as disabled before a country is chosen", async () => {
    const page = await browser.newPage();
    await page.goto(farm.url + FIXTURES.dependentSelect);
    const raw = await extract(page, opts({ kind: "all_forms" }));
    const state = raw.elements.find((e) => e.name === "State / Province");
    expect(state?.disabled).toBe(true);
    await page.close();
  }, 30_000);
});

describe("scoped staleness (revision)", () => {
  it("classifies a target's own change as target-relevant and unrelated changes as noise", async () => {
    const page = await browser.newPage();
    await page.goto(farm.url + FIXTURES.nativeForm);
    const before = await extract(page, opts({ kind: "all_forms" }));
    const firstName = before.elements.find((e) => e.name === "First name")!;

    await page.fill("#firstName", "Ada");
    const after = await extract(page, opts({ kind: "all_forms" }));

    // Targeting the changed field: target-relevant.
    expect(diffViews(before, after, [firstName.ref]).classification).toBe("target-relevant");

    // Targeting an unrelated field: the first-name edit is noise to it.
    const email = before.elements.find((e) => e.name === "Email")!;
    expect(diffViews(before, after, [email.ref]).classification).toBe("noise");
    await page.close();
  }, 30_000);
});
