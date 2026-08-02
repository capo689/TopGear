import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startFixtureFarm, type FixtureFarm, FIXTURES } from "@browser-bridge/fixture-farm";
import { createPlaywrightBackend } from "@browser-bridge/browser-playwright";
import { MemorySink } from "@browser-bridge/audit";
import { SCHEMA_VERSION, type TaskGrant } from "@browser-bridge/protocol";
import { Daemon } from "./daemon.js";

let farm: FixtureFarm;
let daemon: Daemon;
let origin: string;
const sink = new MemorySink();

beforeAll(async () => {
  farm = await startFixtureFarm();
  const backend = await createPlaywrightBackend({ headless: true });
  const harvestBackend = await createPlaywrightBackend({ headless: true, isolated: true });
  daemon = new Daemon({ backend, harvestBackend, auditSink: sink });
  origin = new URL(farm.url).origin;
}, 60_000);

afterAll(async () => {
  await daemon?.shutdown();
  await farm?.close();
});

function grant(tiers: TaskGrant["allowedRiskTiers"] = ["low", "medium"]): TaskGrant {
  return { taskId: "t", allowedOrigins: [origin], allowedRiskTiers: tiers, sensitiveDataDestinations: [origin], budgets: {}, expiresAt: "2999-01-01T00:00:00.000Z" };
}

describe("Daemon", () => {
  it("attaches with a capability handshake and returns a schema version", async () => {
    const { sessionId, capabilities } = await daemon.attach({ grant: grant(), url: farm.url + FIXTURES.nativeForm });
    expect(sessionId).toBeTruthy();
    expect(capabilities.schemaVersion).toBe(SCHEMA_VERSION);
    expect(capabilities.modes).toContain("semantic");
    await daemon.detach(sessionId);
  }, 30_000);

  it("attach returns the initial view, so the first read is not a separate turn (fix #3)", async () => {
    // Dogfood run measured 3 turns (attach → view → act) because attach returned no view.
    // attach now returns initialView (full scope by default), restoring the 2-turn path.
    const attach = await daemon.attach({ grant: grant(), url: farm.url + FIXTURES.nativeForm });
    expect(attach.initialView.trust.pageContent).toBe("untrusted");
    expect(attach.initialView.elements.length).toBeGreaterThanOrEqual(20);
    // A caller-supplied scope narrows that same first view.
    const scoped = await daemon.attach({ grant: grant(), url: farm.url + FIXTURES.nativeForm, scope: { kind: "all_forms" } });
    expect(scoped.initialView.elements.length).toBeGreaterThanOrEqual(20);
    await daemon.detach(attach.sessionId);
    await daemon.detach(scoped.sessionId);
  }, 30_000);

  it("views and acts through the session, enforcing the grant", async () => {
    const { sessionId } = await daemon.attach({ grant: grant(), url: farm.url + FIXTURES.nativeForm });
    const view = await daemon.view(sessionId, { kind: "all_forms" });
    expect(view.trust.pageContent).toBe("untrusted");
    expect(view.elements.length).toBeGreaterThanOrEqual(20);

    const result = await daemon.act(sessionId, {
      actions: [
        { op: "fill", target: { name: "Email" }, value: "ada@example.com" },
        { op: "check", target: { name: "I agree to the terms" }, value: true },
      ],
    });
    expect(result.status).toBe("completed");
    expect(result.completed).toBe(2);
    await daemon.detach(sessionId);
  }, 30_000);

  it("captures a screenshot within the protocol cap", async () => {
    const { sessionId } = await daemon.attach({ grant: grant(), url: farm.url + FIXTURES.nativeForm });
    const shot = await daemon.screenshot(sessionId, { kind: "viewport" });
    expect(shot.contentType).toBe("image/png");
    expect(shot.bytesBase64.length).toBeGreaterThan(100);
    await daemon.detach(sessionId);
  }, 30_000);

  it("runs the full confirmation flow: gate → human approve → allow", async () => {
    const { sessionId } = await daemon.attach({ grant: grant(), url: farm.url + FIXTURES.grantEscape });
    const gated = await daemon.act(sessionId, { actions: [{ op: "click", target: { name: "Delete account permanently" } }] });
    expect(gated.status).toBe("interrupted");
    const cap = gated.interruption?.pendingConfirmation;
    expect(cap).toBeTruthy();

    // Only the confirm UI can approve — the model cannot.
    expect(daemon.approveConfirmation(sessionId, cap!.capabilityId)).toBe(true);

    const approved = await daemon.act(sessionId, {
      actions: [{ op: "click", target: { name: "Delete account permanently" }, capability: cap!.capabilityId }],
    });
    expect(approved.status).toBe("completed");
    await daemon.detach(sessionId);
  }, 30_000);

  it("never writes raw field values to the audit sink", () => {
    expect(sink.lines.join("\n")).not.toContain("ada@example.com");
  });

  it("resolves goto_intent from the recorded link graph, re-checking the origin", async () => {
    const { sessionId } = await daemon.attach({ grant: grant(), url: farm.url + FIXTURES.nativeForm });
    daemon.recordLink(sessionId, "form2", farm.url + FIXTURES.dependentSelect);
    const result = await daemon.act(sessionId, { actions: [{ op: "goto_intent", intent: "form2" }] });
    expect(result.results[0]?.status).toBe("verified");
    await daemon.detach(sessionId);
  }, 30_000);

  it("runs a harvest pattern and serves the corpus back via bridge_harvest (§8)", async () => {
    const { sessionId } = await daemon.attach({ grant: grant(), url: farm.url + FIXTURES.nativeForm });
    const urls = Array.from({ length: 12 }, (_, i) => `${farm.url}/harvest/${i + 1}`);
    const run = await daemon.runPattern(sessionId, { urls });
    expect(run.harvested).toBe(12);
    expect(run.exceptions).toHaveLength(0);

    const search = daemon.harvest(sessionId, { mode: "search", query: "gadget" });
    expect(search.count).toBeGreaterThan(0);
    expect(search.records?.[0]?.text).toBeDefined();

    const list = daemon.harvest(sessionId, { mode: "list" });
    expect(list.count).toBe(12);
    // list is metadata-only — no full text.
    expect(list.records?.[0]?.text).toBeUndefined();
    await daemon.detach(sessionId);
  }, 45_000);
});
