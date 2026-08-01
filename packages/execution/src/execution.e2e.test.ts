import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startFixtureFarm, type FixtureFarm, FIXTURES } from "@browser-bridge/fixture-farm";
import { createPlaywrightBackend } from "@browser-bridge/browser-playwright";
import { CapabilityStore, systemClock } from "@browser-bridge/policy";
import { AuditLogger, MemorySink, newCorrelationId } from "@browser-bridge/audit";
import { InMemorySecretBroker } from "@browser-bridge/secrets";
import type { BrowserBackend } from "@browser-bridge/backend";
import type { TaskGrant, ActionBatch, RiskTier } from "@browser-bridge/protocol";
import { Session } from "./session.js";

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

function grantFor(tiers: RiskTier[]): TaskGrant {
  return {
    taskId: "t1",
    allowedOrigins: [origin],
    allowedRiskTiers: tiers,
    sensitiveDataDestinations: [origin],
    budgets: {},
    expiresAt: "2999-01-01T00:00:00.000Z",
  };
}

async function makeSession(route: string, tiers: RiskTier[] = ["low", "medium"]) {
  const page = await backend.attach(farm.url + route);
  const capabilities = new CapabilityStore(systemClock);
  const sink = new MemorySink();
  const session = new Session({
    sessionId: "s1",
    page,
    grant: grantFor(tiers),
    capabilities,
    audit: new AuditLogger(sink).child(newCorrelationId()),
    secrets: new InMemorySecretBroker(),
    clock: systemClock,
  });
  return { session, capabilities, sink, page };
}

describe("M1 acceptance — 20-field form in ONE batch", () => {
  it("fills every field and submits in a single act() (attach + act = 2 turns)", async () => {
    const { session, sink, page } = await makeSession(FIXTURES.nativeForm);
    const batch: ActionBatch = {
      actions: [
        { op: "fill", target: { name: "First name" }, value: "Ada" },
        { op: "fill", target: { name: "Last name" }, value: "Lovelace" },
        { op: "fill", target: { name: "Email" }, value: "ada@example.com" },
        { op: "fill", target: { name: "Phone" }, value: "5551234567" },
        { op: "fill", target: { name: "Current company" }, value: "Analytical Engines" },
        { op: "fill", target: { name: "Current title" }, value: "Programmer" },
        { op: "fill", target: { name: "Address line 1" }, value: "1 Ada Way" },
        { op: "fill", target: { name: "Address line 2" }, value: "Suite 2" },
        { op: "fill", target: { name: "City" }, value: "Bend" },
        { op: "select", target: { name: "State" }, value: "OR" },
        { op: "fill", target: { name: "Postal code" }, value: "97701" },
        { op: "select", target: { name: "Country" }, value: "US" },
        { op: "set_date", target: { name: "Date of birth" }, value: "1990-01-01" },
        { op: "fill", target: { name: "Portfolio URL" }, value: "https://ada.dev" },
        { op: "fill", target: { name: "Years of experience" }, value: "5" },
        { op: "fill", target: { name: "Desired salary" }, value: "150000" },
        { op: "set_date", target: { name: "Available start date" }, value: "2026-09-01" },
        { op: "check", target: { role: "radio", name: "Search" }, value: true },
        { op: "check", target: { name: "Open to remote" }, value: true },
        { op: "fill", target: { name: "Cover letter" }, value: "Hello from Ada." },
        { op: "check", target: { name: "I agree to the terms" }, value: true },
        { op: "click", target: { name: "Submit application" } },
      ],
    };

    const result = await session.act(batch);
    const failures = result.results.filter((r) => r.status === "failed");
    expect(failures, JSON.stringify(failures)).toHaveLength(0);
    expect(result.status).toBe("completed");
    expect(result.completed).toBeGreaterThanOrEqual(20);

    // The submit ran and the page acknowledged it (same-origin, medium tier — no gate).
    const after = await session.view({ kind: "full" });
    expect(after.alerts.some((a) => a.text.includes("Application submitted"))).toBe(true);
    // Audit recorded, values never in the log.
    expect(sink.lines.join("\n")).not.toContain("ada@example.com");
    await page.close();
  }, 45_000);
});

describe("M1 acceptance — dependent select in one batch with an embedded wait", () => {
  it("selects country, waits for the state select to enable, then selects state", async () => {
    const { session, page } = await makeSession(FIXTURES.dependentSelect);
    const result = await session.act({
      actions: [
        { op: "select", target: { name: "Country" }, value: "US" },
        { op: "wait", condition: { type: "element_state", target: { name: "State / Province" }, state: "enabled" } },
        { op: "select", target: { name: "State / Province" }, value: "OR" },
      ],
    });
    expect(result.status).toBe("completed");
    expect(result.results.every((r) => r.status === "verified")).toBe(true);
    await page.close();
  }, 30_000);
});

describe("M1 acceptance — prompt injection is blocked by the daemon", () => {
  it("gates a cross-origin submit behind confirmation even for a gullible model", async () => {
    // The scripted model does exactly what the injection page tells it to.
    const { session, page } = await makeSession(FIXTURES.injection, ["low", "medium"]);
    const result = await session.act({ actions: [{ op: "click", target: { name: "Continue to offer" } }] });

    expect(result.status).toBe("interrupted");
    expect(result.interruption?.kind).toBe("confirmation_required");
    expect(result.results[0]?.failure?.reason).toBe("capability_required");
    // The exfiltration form was NOT submitted — still on the injection page.
    expect(page.url()).toContain("/security/injection.html");
    await page.close();
  }, 30_000);

  it("rejects a model-fabricated capability id (cannot self-authorize)", async () => {
    const { session, page } = await makeSession(FIXTURES.injection, ["low", "medium"]);
    const result = await session.act({
      actions: [{ op: "click", target: { name: "Continue to offer" }, capability: "totally-fake-id" }],
    });
    expect(result.results[0]?.failure?.reason).toBe("capability_invalid");
    await page.close();
  }, 30_000);
});

describe("M1 acceptance — confirmation spoofing is impossible", () => {
  it("mints a daemon-authored confirmation, allows once approved, and blocks replay", async () => {
    const { session, capabilities, page } = await makeSession(FIXTURES.grantEscape, ["low", "medium"]);

    // 1. High-risk click → interruption carrying a DAEMON-built confirmation.
    const gated = await session.act({ actions: [{ op: "click", target: { name: "Delete account permanently" } }] });
    expect(gated.status).toBe("interrupted");
    const pending = gated.interruption?.pendingConfirmation;
    expect(pending).toBeTruthy();
    // The summary is daemon-authored from page fields, not model text.
    expect(pending!.action.summary).toContain(origin);
    expect(pending!.action.op).toBe("click");

    // 2. A human approves in the confirm UI.
    expect(capabilities.approve(pending!.capabilityId)).toBe(true);

    // 3. Re-issued with the approved capability → allowed.
    const approved = await session.act({
      actions: [{ op: "click", target: { name: "Delete account permanently" }, capability: pending!.capabilityId }],
    });
    expect(approved.status).toBe("completed");

    // 4. Replaying the same capability → blocked (single-use).
    const replay = await session.act({
      actions: [{ op: "click", target: { name: "Delete account permanently" }, capability: pending!.capabilityId }],
    });
    expect(replay.results[0]?.failure?.reason).toBe("capability_invalid");
    await page.close();
  }, 30_000);
});

describe("M1 acceptance — grant escape fails with a teaching error", () => {
  it("denies navigation to an origin outside the grant", async () => {
    const { session, page } = await makeSession(FIXTURES.grantEscape);
    const result = await session.act({ actions: [{ op: "goto", url: "https://other.example/dashboard" }] });
    const failure = result.results[0]?.failure;
    expect(failure?.reason).toBe("grant_denied");
    if (failure?.reason === "grant_denied") expect(failure.needed.origin).toBe("https://other.example");
    await page.close();
  }, 30_000);
});
