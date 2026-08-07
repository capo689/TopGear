import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startFixtureFarm, type FixtureFarm, FIXTURES } from "@browser-bridge/fixture-farm";
import { createPlaywrightBackend } from "@browser-bridge/browser-playwright";
import { CapabilityStore, systemClock } from "@browser-bridge/policy";
import { AuditLogger, MemorySink, newCorrelationId } from "@browser-bridge/audit";
import { InMemorySecretBroker } from "@browser-bridge/secrets";
import type { BrowserBackend } from "@browser-bridge/backend";
import type { TaskGrant, RiskTier } from "@browser-bridge/protocol";
import { Session } from "./session.js";

/**
 * Regression coverage for two fill_record defects found live:
 *
 *  - Typeahead routing: buildRecordAction inspected only tag/role, so every
 *    role="combobox" got a `select` op — a playbook that opens the widget and polls for
 *    ALREADY-RENDERED options and never types. An async/debounced list is therefore
 *    always empty, and the fill reported "option not found" against a list that had
 *    never loaded. applySearchPick was the correct playbook and was already tested;
 *    nothing could reach it from fill_record.
 *
 *  - Form-scope blindness: scope was hardcoded to `all_forms` with no fallback, so a
 *    page whose real fields sit outside any <form> matched nothing and reported the
 *    keys merely "unmatched" — indistinguishable from "the record did not match".
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

function grantFor(tiers: RiskTier[] = ["low", "medium"]): TaskGrant {
  return {
    taskId: "t1",
    allowedOrigins: [origin],
    allowedRiskTiers: tiers,
    sensitiveDataDestinations: [origin],
    budgets: {},
    expiresAt: "2999-01-01T00:00:00.000Z",
  };
}

async function makeSession(route: string) {
  const page = await backend.attach(farm.url + route);
  const session = new Session({
    sessionId: "s1",
    page,
    grant: grantFor(),
    capabilities: new CapabilityStore(systemClock),
    audit: new AuditLogger(new MemorySink()).child(newCorrelationId()),
    secrets: new InMemorySecretBroker(),
    clock: systemClock,
  });
  return { session, page };
}

describe("fill_record — typeahead routing", () => {
  it("drives an async typeahead in ONE call by typing first, not polling a list that never loads", async () => {
    const { session, page } = await makeSession(FIXTURES.asyncTypeahead);
    const result = await session.fillRecord({ record: { "School Name": "Springfield High School" } });

    expect(result.unmatched, JSON.stringify(result.unmatched)).toHaveLength(0);
    // Pre-fix: a `select` op opened the widget, found zero rendered options (nothing was
    // ever typed), and the batch came back partial with option_not_found + empty list.
    expect(result.batch.status, JSON.stringify(result.batch)).toBe("completed");
    expect(
      result.batch.results.every((r) => r.status === "verified"),
      JSON.stringify(result.batch.results),
    ).toBe(true);

    // Read the committed value back through the same path the verifier uses.
    const raw = await page.captureRaw({ scope: { kind: "full" }, refPrefix: "chk-" });
    const field = raw.elements.find((e) => e.name === "School Name");
    expect(field, "School Name element not found in capture").toBeDefined();
    expect((await page.readState(field!.ref)).value).toBe("Springfield High School");
    await page.close();
  }, 30_000);
});

describe("fill_record — scope fallback on pages whose fields sit outside a <form>", () => {
  it("matches and fills real fields that have no <form> ancestor", async () => {
    const { session, page } = await makeSession(FIXTURES.pseudoForm);
    const result = await session.fillRecord({
      record: { fullName: "Ada Lovelace", email: "ada@example.com", city: "Seattle" },
    });

    // Pre-fix: all_forms returned only the unrelated site-search box, so all three keys
    // reported unmatched — silently, as if the record simply did not apply.
    expect(result.unmatched, JSON.stringify(result.unmatched)).toHaveLength(0);
    expect(result.matched.map((m) => m.field).sort()).toEqual(["city", "email", "fullName"]);
    expect(
      result.batch.results.every((r) => r.status === "verified"),
      JSON.stringify(result.batch.results),
    ).toBe(true);
    await page.close();
  }, 30_000);

  it("flags the looser match, so a fallback match is not trusted like a form-scoped one", async () => {
    const { session, page } = await makeSession(FIXTURES.pseudoForm);
    const result = await session.fillRecord({ record: { fullName: "Ada Lovelace" } });

    expect(result.batch.matchedViaScopeFallback).toBe(true);
    await page.close();
  }, 30_000);

  it("does NOT flag a fallback when the normal form scope already resolved everything", async () => {
    const { session, page } = await makeSession(FIXTURES.nativeForm);
    const result = await session.fillRecord({ record: { "First name": "Ada" } });

    expect(result.unmatched).toHaveLength(0);
    expect(result.batch.matchedViaScopeFallback).toBeUndefined();
    await page.close();
  }, 30_000);

  it("still reports genuinely-absent keys as unmatched rather than inventing a match", async () => {
    const { session, page } = await makeSession(FIXTURES.pseudoForm);
    const result = await session.fillRecord({ record: { totallyAbsentField: "x" } });

    // The wider retry must not relabel a real miss as a fallback success.
    expect(result.unmatched).toEqual(["totallyAbsentField"]);
    expect(result.batch.matchedViaScopeFallback).toBeUndefined();
    await page.close();
  }, 30_000);
});
