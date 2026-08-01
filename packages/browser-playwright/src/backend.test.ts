import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startFixtureFarm, type FixtureFarm, FIXTURES } from "@browser-bridge/fixture-farm";
import { createPlaywrightBackend } from "./backend.js";
import type { BrowserBackend, BrowserPage } from "@browser-bridge/backend";

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

describe("PlaywrightBackend — primitives + verification", () => {
  it("fills, checks, and reads back native fields", async () => {
    const page: BrowserPage = await backend.attach(farm.url + FIXTURES.nativeForm);
    const raw = await page.captureRaw({ scope: { kind: "all_forms" }, refPrefix: "v-" });

    const firstName = raw.elements.find((e) => e.name === "First name")!;
    expect((await page.fillText(firstName.ref, "Ada")).ok).toBe(true);
    expect((await page.readState(firstName.ref)).value).toBe("Ada");

    const agree = raw.elements.find((e) => e.name?.includes("agree to the terms"))!;
    expect((await page.setChecked(agree.ref, true)).ok).toBe(true);
    expect((await page.readState(agree.ref)).checked).toBe(true);

    await page.close();
  }, 30_000);

  it("reports option_not_found with available options", async () => {
    const page = await backend.attach(farm.url + FIXTURES.nativeForm);
    const raw = await page.captureRaw({ scope: { kind: "all_forms" }, refPrefix: "v-" });
    const country = raw.elements.find((e) => e.name === "Country")!;
    const bad = await page.selectOption(country.ref, ["Atlantis"]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.reason).toBe("option_not_found");
      expect(bad.availableOptions).toContain("United States");
    }
    await page.close();
  }, 30_000);

  it("handles the dependent select via a real wait (the M1 embedded-wait path)", async () => {
    const page = await backend.attach(farm.url + FIXTURES.dependentSelect);
    let raw = await page.captureRaw({ scope: { kind: "all_forms" }, refPrefix: "v-" });
    const country = raw.elements.find((e) => e.name === "Country")!;
    const stateBefore = raw.elements.find((e) => e.name === "State / Province")!;
    expect(stateBefore.disabled).toBe(true);

    expect((await page.selectOption(country.ref, ["US"])).ok).toBe(true);

    const wait = await page.waitFor(
      { type: "element_state", target: { ref: stateBefore.ref }, state: "enabled" },
      5000,
    );
    expect(wait.satisfied).toBe(true);

    expect((await page.selectOption(stateBefore.ref, ["OR"])).ok).toBe(true);
    expect((await page.readState(stateBefore.ref)).value).toBe("OR");
    await page.close();
  }, 30_000);

  it("clicks submit and surfaces the resulting status alert", async () => {
    const page = await backend.attach(farm.url + FIXTURES.nativeForm);
    const raw = await page.captureRaw({ scope: { kind: "all_forms" }, refPrefix: "v-" });
    const submit = raw.elements.find((e) => e.role === "button" && e.name === "Submit application")!;
    expect((await page.click(submit.ref)).ok).toBe(true);

    const after = await page.captureRaw({ scope: { kind: "full" }, refPrefix: "v2-" });
    expect(after.alerts.some((a) => a.text.includes("Application submitted"))).toBe(true);
    await page.close();
  }, 30_000);
});
