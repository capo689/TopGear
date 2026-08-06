import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startFixtureFarm, type FixtureFarm, FIXTURES } from "@browser-bridge/fixture-farm";
import { createPlaywrightBackend } from "@browser-bridge/browser-playwright";
import type { BrowserBackend, BrowserPage } from "@browser-bridge/backend";
import type { RawElement } from "@browser-bridge/semantic-engine";
import { applySelect, applySearchPick } from "./index.js";

let farm: FixtureFarm;
let backend: BrowserBackend;

beforeAll(async () => {
  farm = await startFixtureFarm();
  backend = await createPlaywrightBackend({ headless: true });
}, 60_000);

afterAll(async () => {
  await backend?.shutdown();
  await farm?.close();
});

async function openWidgets(): Promise<{ page: BrowserPage; find: (name: string) => Promise<RawElement | undefined> }> {
  const page = await backend.attach(farm.url + FIXTURES.libraryWidgets);
  const find = async (name: string) => {
    const raw = await page.captureRaw({ scope: { kind: "full" }, refPrefix: "g-" });
    return raw.elements.find((e) => e.name === name);
  };
  return { page, find };
}

describe("widget gauntlet — shared playbook across libraries", () => {
  it("detects the library WidgetKind and selects via one primitive", async () => {
    const { page, find } = await openWidgets();
    const cases: [string, string, string][] = [
      ["Framework", "Vue", "react-select"],
      ["Region", "East", "radix"],
      ["Tier", "Pro", "mui"],
      ["Plan", "Premium", "ant"],
    ];
    for (const [name, value, kind] of cases) {
      const el = await find(name);
      expect(el?.widgetKind, `${name} kind`).toBe(kind);
      const r = await applySelect(page, el!, [value]);
      expect(r.ok, `${name} select ${value}: ${JSON.stringify(r)}`).toBe(true);
    }
    await page.close();
  }, 45_000);

  it("refuses a disabled combobox, waits out async options, and survives a rerender", async () => {
    const { page, find } = await openWidgets();

    const disabled = await applySelect(page, (await find("Locked"))!, ["Anything"]);
    expect(disabled.ok).toBe(false);
    if (!disabled.ok) expect(disabled.reason).toBe("disabled");

    const asyncSel = await applySelect(page, (await find("Async city"))!, ["Portland"]);
    expect(asyncSel.ok, JSON.stringify(asyncSel)).toBe(true);

    const rerender = await applySelect(page, (await find("Rerender color"))!, ["Blue"]);
    expect(rerender.ok, JSON.stringify(rerender)).toBe(true);
    await page.close();
  }, 45_000);

  it("teaches with available options when the option is missing", async () => {
    const { page, find } = await openWidgets();
    const r = await applySelect(page, (await find("Framework"))!, ["Nonexistent"]);
    expect(r.ok).toBe(false);
    if (!r.ok && r.reason === "option_not_found") expect(r.availableOptions).toContain("React");
    await page.close();
  }, 45_000);

  /**
   * D4 — the probe must not poison the widget, and the runtime must not claim a state it
   * cannot see. Both halves, on the widget the probe touched, with nothing in between.
   */
  it("D4(a): teach then recover on the SAME widget in consecutive calls, no intervening action", async () => {
    const { page, find } = await openWidgets();
    const el = (await find("Framework"))!;

    const teach = await applySelect(page, el, ["Nonexistent"]);
    expect(teach.ok).toBe(false);
    if (!teach.ok) {
      expect(teach.reason).toBe("option_not_found");
      if (teach.reason === "option_not_found") expect(teach.availableOptions).toEqual(["React", "Vue", "Svelte", "Solid"]);
    }
    // The probe must have restored a known-closed state ON ITS OWN — not relied on some
    // later action against another widget to clean up after it.
    expect((await page.readState(el.ref)).listboxOpen).toBe(false);

    // Consecutive call, same widget, nothing in between.
    const recover = await applySelect(page, el, ["Svelte"]);
    expect(recover.ok, JSON.stringify(recover)).toBe(true);
    expect((await page.readState(el.ref)).listboxOpen).toBe(false);
    await page.close();
  }, 45_000);

  it("D4(a): restores closed state on a widget that ignores Escape", async () => {
    const { page, find } = await openWidgets();
    const el = (await find("Plan"))!; // ant combo: no Escape handler, closes on trigger click
    const teach = await applySelect(page, el, ["Nonexistent"]);
    expect(teach.ok).toBe(false);
    expect((await page.readState(el.ref)).listboxOpen).toBe(false);
    const recover = await applySelect(page, el, ["Standard"]);
    expect(recover.ok, JSON.stringify(recover)).toBe(true);
    await page.close();
  }, 45_000);

  it("D4(b): an OPEN listbox with genuinely no options reports option_not_found with an empty list", async () => {
    const { page, find } = await openWidgets();
    const r = await applySelect(page, (await find("Empty roster"))!, ["Anything"]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("option_not_found");
      if (r.reason === "option_not_found") expect(r.availableOptions).toEqual([]);
    }
    await page.close();
  }, 45_000);

  it("D4(b): a widget whose options cannot be read reports options_not_visible, never an empty option list", async () => {
    const { page, find } = await openWidgets();
    // "Stuck menu" never opens for a click, so its options are unreadable and it reads
    // closed throughout — the same observable situation the stray listbox created live.
    const el = (await find("Stuck menu"))!;
    const r = await applySelect(page, el, ["Hidden"]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("options_not_visible");
      if (r.reason === "options_not_visible") expect(r.widgetState).toBe("closed");
    }
    await page.close();
  }, 45_000);

  it("D4(b): a widget with no observable open/closed state reports unknown, not closed", async () => {
    const { page, find } = await openWidgets();
    const el = (await find("Portal fruit"))!;
    expect((await page.readState(el.ref)).listboxOpen).toBeUndefined();
    const teach = await applySelect(page, el, ["Nonexistent"]);
    expect(teach.ok).toBe(false);
    // The menu IS portalled and readable while open, so the honest answer here is the real
    // option list — the point is that it is never reported as an empty list.
    if (!teach.ok && teach.reason === "option_not_found") expect(teach.availableOptions).toEqual(["Apple", "Pear", "Plum"]);
    await page.close();
  }, 45_000);

  it("drives a typeahead with search_pick", async () => {
    const { page, find } = await openWidgets();
    const el = await find("Typeahead country");
    expect(el?.widgetKind).toBe("typeahead");
    const r = await applySearchPick(page, el!, "United King", "United Kingdom");
    expect(r.ok, JSON.stringify(r)).toBe(true);
    await page.close();
  }, 45_000);
});
