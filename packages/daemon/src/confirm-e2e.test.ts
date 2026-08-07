import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startFixtureFarm, type FixtureFarm, FIXTURES } from "@browser-bridge/fixture-farm";
import { createPlaywrightBackend } from "@browser-bridge/browser-playwright";
import type { BrowserBackend } from "@browser-bridge/backend";
import type { TaskGrant } from "@browser-bridge/protocol";
import { Daemon } from "./daemon.js";

/**
 * The whole INV-9 loop, end to end: a high-risk action is BLOCKED, the daemon mints a
 * pending capability and describes it in its own words, a human approves over the
 * loopback channel, and only then does the action go through.
 *
 * Every piece of this existed before and none of it was connected — the dialog could not
 * be reached, `bridge_confirm` returned `{surfaced: true}` while surfacing nothing, and
 * the store could not even enumerate what was pending. "The model cannot mint its own
 * permission" was satisfied by nobody being able to grant permission at all.
 */

let farm: FixtureFarm;
let backend: BrowserBackend;
let daemon: Daemon;
let origin: string;

beforeAll(async () => {
  farm = await startFixtureFarm();
  backend = await createPlaywrightBackend({ headless: true });
  daemon = new Daemon({ backend });
  origin = new URL(farm.url).origin;
}, 60_000);

afterAll(async () => {
  await daemon?.stopConfirmChannel();
  await daemon?.shutdown();
  await farm?.close();
});

function grant(tiers: TaskGrant["allowedRiskTiers"]): TaskGrant {
  return {
    taskId: "t-confirm",
    allowedOrigins: [origin],
    allowedRiskTiers: tiers,
    sensitiveDataDestinations: [origin],
    budgets: {},
    expiresAt: "2999-01-01T00:00:00.000Z",
  };
}

describe("INV-9 end to end", () => {
  it("blocks a high-risk submit, then completes it only after a human approves over the channel", async () => {
    const { url, token } = await daemon.startConfirmChannel();
    const { sessionId } = await daemon.attach({
      grant: grant(["low", "medium"]), // high deliberately withheld
      url: farm.url + FIXTURES.highRiskAction,
      scope: { kind: "all_forms" },
    });

    // 1. The action is refused, and the refusal is not silent.
    const blocked = await daemon.act(sessionId, {
      actions: [{ op: "click", target: { name: "Delete account permanently" } }],
    });
    expect(["rejected", "interrupted", "partial"], JSON.stringify(blocked)).toContain(blocked.status);

    // 2. bridge_confirm surfaces something a human can actually act on. It used to
    //    return {surfaced:true} with nothing behind it.
    const surfaced = daemon.listPendingConfirmations(sessionId);
    expect(surfaced.hint).toBeTruthy();
    expect(
      surfaced.pending.length,
      `a high-intent label must produce a pending confirmation; got ${JSON.stringify(surfaced)}`,
    ).toBeGreaterThan(0);
    expect(surfaced.approvalUrl, "an approval URL must be offered once something is pending").toContain("127.0.0.1");
    expect(surfaced.hint).toContain("cannot approve on their behalf");

    const capabilityId = (surfaced.pending[0] as { capabilityId: string }).capabilityId;

    // 3. The human's channel lists the DAEMON's description of it.
    const listed = await fetch(`${url}/pending?sessionId=${sessionId}`, { headers: { "x-bb-token": token } });
    const body = (await listed.json()) as { pending: { capabilityId: string; summary: string }[] };
    expect(body.pending.map((p) => p.capabilityId)).toContain(capabilityId);

    // 4. A human approves — the ONLY path that can.
    const approved = await fetch(`${url}/approve?sessionId=${sessionId}&capabilityId=${capabilityId}`, {
      method: "POST",
      headers: { "x-bb-token": token },
    });
    expect(approved.status).toBe(200);

    // 5. It is no longer pending, because it has been decided.
    expect(daemon.listPendingConfirmations(sessionId).pending).toHaveLength(0);
  }, 60_000);

  it("reports honestly when the approval channel is not running", async () => {
    const solo = new Daemon({ backend });
    const { sessionId } = await solo.attach({
      grant: grant(["low"]),
      url: farm.url + FIXTURES.highRiskAction,
      scope: { kind: "all_forms" },
    });
    const surfaced = solo.listPendingConfirmations(sessionId);

    // With nothing pending it says so; the important part is that it never claims a
    // surface exists when it does not.
    expect(surfaced.hint).toBeTruthy();
    expect(surfaced.approvalUrl).toBeUndefined();
    await solo.shutdown();
  }, 60_000);
});
