import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
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

  it("eval telemetry: each attach starts a NEW run (runs never merge in one process)", async () => {
    // The bug this guards: a frozen construction-time runIndex would stamp every event 0 and
    // silently merge all runs. Drive attach → act → act → attach → act into ONE daemon and
    // assert the emitted events split into TWO runs with the right per-run turn counts.
    const logPath = join(tmpdir(), `bb-eval-${randomUUID()}.jsonl`);
    process.env.BB_EVAL_LOG = logPath;
    const backend = await createPlaywrightBackend({ headless: true });
    const d = new Daemon({ backend, auditSink: new MemorySink() }); // reads BB_EVAL_LOG at construction
    try {
      const a1 = await d.attach({ grant: grant(), url: farm.url + FIXTURES.nativeForm });
      await d.act(a1.sessionId, { actions: [{ op: "fill", target: { name: "Email" }, value: "a@b.com" }] });
      await d.act(a1.sessionId, { actions: [{ op: "fill", target: { name: "First name" }, value: "Ada" }] });
      const a2 = await d.attach({ grant: grant(), url: farm.url + FIXTURES.nativeForm });
      await d.act(a2.sessionId, { actions: [{ op: "fill", target: { name: "Email" }, value: "c@d.com" }] });

      const events = readFileSync(logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { runIndex: number });
      const perRun = new Map<number, number>();
      for (const e of events) perRun.set(e.runIndex, (perRun.get(e.runIndex) ?? 0) + 1);
      expect([...perRun.keys()].sort()).toEqual([0, 1]); // TWO distinct runs, not merged into one
      expect(perRun.get(0)).toBe(3); // run 0: attach + 2 acts
      expect(perRun.get(1)).toBe(2); // run 1: attach + 1 act
    } finally {
      delete process.env.BB_EVAL_LOG;
      await d.shutdown();
      rmSync(logPath, { force: true });
    }
  }, 40_000);

  it("D2: a cold navigation inside attach records pageLoadMs > 0 (and a warm attach records 0)", async () => {
    // The bug: attach recorded a HARDCODED pageLoadMs of 0, so wall-minus-page-load did not
    // exist for the call that does the most page loading.
    const logPath = join(tmpdir(), `bb-eval-${randomUUID()}.jsonl`);
    process.env.BB_EVAL_LOG = logPath;
    const backend = await createPlaywrightBackend({ headless: true });
    const d = new Daemon({ backend, auditSink: new MemorySink() });
    try {
      const cold = await d.attach({ grant: grant(), url: farm.url + FIXTURES.nativeForm });
      const warm = await d.attach({ grant: grant() }); // no url → nothing navigated
      const events = readFileSync(logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { tool: string; sessionId: string; wallMs: number; pageLoadMs: number });

      const coldEv = events.find((e) => e.tool === "attach" && e.sessionId === cold.sessionId)!;
      expect(coldEv.pageLoadMs).toBeGreaterThan(0);
      // pageLoadMs is a SUBSET of wallMs, so wall-minus-page-load can never go negative.
      expect(coldEv.wallMs).toBeGreaterThanOrEqual(coldEv.pageLoadMs);

      const warmEv = events.find((e) => e.tool === "attach" && e.sessionId === warm.sessionId)!;
      expect(warmEv.pageLoadMs).toBe(0);
    } finally {
      delete process.env.BB_EVAL_LOG;
      await d.shutdown();
      rmSync(logPath, { force: true });
    }
  }, 40_000);

  it("D3: attach + fill_record emits TWO events, with fields populated from the result", async () => {
    // The bug: a whole benchmark run left ONE event in the log (the attach) because
    // fill_record — the measured part of every run — emitted nothing at all.
    const logPath = join(tmpdir(), `bb-eval-${randomUUID()}.jsonl`);
    process.env.BB_EVAL_LOG = logPath;
    const backend = await createPlaywrightBackend({ headless: true });
    const d = new Daemon({ backend, auditSink: new MemorySink() });
    try {
      const a = await d.attach({ grant: grant(), url: farm.url + FIXTURES.nativeForm });
      const result = await d.fillRecord(a.sessionId, {
        record: { Email: "ada@example.com", "First name": "Ada", "No such field on this form": "x" },
      });
      const events = readFileSync(logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { tool: string; fieldsAttempted: number; fieldsVerified: number; status: string });
      expect(events.length).toBe(2);
      expect(events.map((e) => e.tool)).toEqual(["attach", "fill_record"]);

      const fr = events[1]!;
      // Attempted counts EVERY field the record asked for — matched AND unmatched — so a
      // record that silently skipped fields cannot report a flattering denominator.
      expect(fr.fieldsAttempted).toBe(result.matched.length + result.unmatched.length);
      expect(fr.fieldsAttempted).toBe(3);
      expect(result.unmatched.length).toBe(1);
      expect(fr.fieldsVerified).toBe(result.batch.completed);
      expect(fr.fieldsVerified).toBeGreaterThan(0);
      expect(fr.status).toBe(result.batch.status);
    } finally {
      delete process.env.BB_EVAL_LOG;
      await d.shutdown();
      rmSync(logPath, { force: true });
    }
  }, 40_000);

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
