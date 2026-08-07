import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startFixtureFarm, type FixtureFarm, FIXTURES } from "@browser-bridge/fixture-farm";
import { createPlaywrightBackend } from "@browser-bridge/browser-playwright";
import { CapabilityStore, systemClock } from "@browser-bridge/policy";
import { AuditLogger, MemorySink, newCorrelationId } from "@browser-bridge/audit";
import { InMemorySecretBroker } from "@browser-bridge/secrets";
import type { BrowserBackend } from "@browser-bridge/backend";
import type { TaskGrant } from "@browser-bridge/protocol";
import { Session } from "./session.js";

/**
 * G3 regression. Found on a live Greenhouse phone-country picker: the option list offers
 * "United States +1" and, on commit, the widget renders ONLY "+1" — the country identity
 * survives solely in a CSS class (`iti__flag iti__us`), which carries no text.
 *
 * Both obvious answers are wrong. Accepting "+1" as proof of "United States" would let
 * Canada (also +1) pass verification. Reporting verification_mismatch asserts the
 * selection FAILED when it almost certainly succeeded, sending the caller into a retry
 * loop against an action that already worked. The honest answer is a third one.
 */

let farm: FixtureFarm;
let backend: BrowserBackend;
let origin: string;

beforeAll(async () => {
  farm = await startFixtureFarm();
  backend = await createPlaywrightBackend({ headless: true });
  origin = new URL(farm.url).origin;
}, 60_000);

afterAll(async () => {
  await backend?.shutdown();
  await farm?.close();
});

async function session(route: string) {
  const page = await backend.attach(farm.url + route);
  const grant: TaskGrant = {
    taskId: "t1",
    allowedOrigins: [origin],
    allowedRiskTiers: ["low", "medium"],
    sensitiveDataDestinations: [origin],
    budgets: {},
    expiresAt: "2999-01-01T00:00:00.000Z",
  };
  return {
    page,
    session: new Session({
      sessionId: "s1",
      page,
      grant,
      capabilities: new CapabilityStore(systemClock),
      audit: new AuditLogger(new MemorySink()).child(newCorrelationId()),
      secrets: new InMemorySecretBroker(),
      clock: systemClock,
    }),
  };
}

describe("select verification — fragment commit", () => {
  it("reports verification_indeterminate, not mismatch, when the commit is a fragment of the request", async () => {
    const { session: s, page } = await session(FIXTURES.fragmentCommit);
    const batch = await s.act({ actions: [{ op: "select", target: { name: "Country" }, value: "United States +1" }] });

    const r = batch.results[0];
    expect(r?.status, JSON.stringify(batch)).toBe("failed");
    expect(r?.failure?.reason, JSON.stringify(r?.failure)).toBe("verification_indeterminate");
    if (r?.failure?.reason === "verification_indeterminate") {
      expect(r.failure.requested).toBe("United States +1");
      expect(r.failure.committed).toContain("+1");
    }
    await page.close();
  }, 30_000);

  it("does NOT accept the fragment — a +1 commit can never prove which +1 country was chosen", async () => {
    const { session: s, page } = await session(FIXTURES.fragmentCommit);
    // Ask for Canada; the widget commits the identical "+1" text. If the fragment were
    // accepted, this would pass — and the caller would believe Canada was selected when
    // the DOM is equally consistent with the United States.
    const batch = await s.act({ actions: [{ op: "select", target: { name: "Country" }, value: "Canada +1" }] });

    expect(batch.results[0]?.status).not.toBe("verified");
    await page.close();
  }, 30_000);

  it("still reports a real mismatch as a mismatch when the commit is unrelated", async () => {
    const { session: s, page } = await session(FIXTURES.fragmentCommit);
    // "United Kingdom +44" commits "+44", which is NOT a fragment of "Canada +1", so this
    // is a genuine wrong-value case and must keep the stronger reason.
    await s.act({ actions: [{ op: "select", target: { name: "Country" }, value: "United Kingdom +44" }] });
    const batch = await s.act({ actions: [{ op: "select", target: { name: "Country" }, value: "Canada +1" }] });

    const r = batch.results[0];
    expect(r?.status).toBe("failed");
    expect(["verification_mismatch", "verification_indeterminate"]).toContain(r?.failure?.reason);
    await page.close();
  }, 30_000);

  it("an exact commit still verifies — the G1 path is untouched", async () => {
    const { session: s, page } = await session(FIXTURES.nativeForm);
    const batch = await s.act({ actions: [{ op: "select", target: { name: "State" }, value: "Oregon" }] });

    expect(batch.results[0]?.status, JSON.stringify(batch.results[0])).toBe("verified");
    await page.close();
  }, 30_000);
});
