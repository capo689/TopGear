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

  it("drives a typeahead with search_pick", async () => {
    const { page, find } = await openWidgets();
    const el = await find("Typeahead country");
    expect(el?.widgetKind).toBe("typeahead");
    const r = await applySearchPick(page, el!, "United King", "United Kingdom");
    expect(r.ok, JSON.stringify(r)).toBe(true);
    await page.close();
  }, 45_000);
});
