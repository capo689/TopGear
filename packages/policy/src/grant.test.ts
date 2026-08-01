import { describe, it, expect } from "vitest";
import { authorize, type ActionExecContext } from "./grant.js";
import { CapabilityStore } from "./capability.js";
import { fakeClock } from "./clock.js";
import { sequentialNonce } from "./nonce.js";
import type { Action, TaskGrant } from "@browser-bridge/protocol";

const grant: TaskGrant = {
  taskId: "t1",
  allowedOrigins: ["https://example.com"],
  allowedRiskTiers: ["low", "medium"],
  sensitiveDataDestinations: ["https://example.com"],
  budgets: {},
  expiresAt: "2999-01-01T00:00:00.000Z",
};

function caps() {
  return new CapabilityStore(fakeClock(0), sequentialNonce());
}

const baseCtx: ActionExecContext = {
  origin: "https://example.com",
  now: 0,
  pageRevision: 7,
};

describe("authorize — grant gating", () => {
  it("allows a low structural action within the grant", () => {
    const action: Action = { op: "scroll", direction: "down" };
    const r = authorize({ action, grant, ctx: baseCtx, capabilities: caps() });
    expect(r.decision).toBe("allow");
    expect(r.tier).toBe("low");
  });

  it("denies an action on an origin outside the grant (grant-escape)", () => {
    const action: Action = { op: "click", target: { name: "Next" } };
    const r = authorize({
      action,
      grant,
      ctx: { ...baseCtx, origin: "https://evil.example", risk: { click: { origin: "https://evil.example" } } },
      capabilities: caps(),
    });
    expect(r.decision).toBe("deny");
    if (r.decision === "deny") {
      expect(r.failure.reason).toBe("grant_denied");
      if (r.failure.reason === "grant_denied") expect(r.failure.needed.origin).toBe("https://evil.example");
    }
  });

  it("denies a medium action when the grant ceiling excludes it (tier-escape)", () => {
    const lowOnly: TaskGrant = { ...grant, allowedRiskTiers: ["low"] };
    const action: Action = { op: "upload", target: { name: "Resume" }, fileToken: "f1" };
    const r = authorize({ action, grant: lowOnly, ctx: baseCtx, capabilities: caps() });
    expect(r.decision).toBe("deny");
    if (r.decision === "deny" && r.failure.reason === "grant_denied") {
      expect(r.failure.needed.tier).toBe("medium");
    }
  });

  it("denies sensitive transmission to a destination outside the grant (exfiltration)", () => {
    const action: Action = { op: "fill", target: { name: "SSN" }, value: { secretRef: "kc:ssn" } };
    const r = authorize({
      action,
      grant,
      ctx: { ...baseCtx, transmitsSensitive: true, sensitiveDestination: "https://tracker.evil" },
      capabilities: caps(),
    });
    expect(r.decision).toBe("deny");
    if (r.decision === "deny" && r.failure.reason === "grant_denied") {
      expect(r.failure.needed.origin).toBe("https://tracker.evil");
    }
  });

  it("denies everything once the grant has expired", () => {
    const expired: TaskGrant = { ...grant, expiresAt: "2000-01-01T00:00:00.000Z" };
    const action: Action = { op: "scroll", direction: "down" };
    const r = authorize({ action, grant: expired, ctx: { ...baseCtx, now: Date.parse("2026-01-01") }, capabilities: caps() });
    expect(r.decision).toBe("deny");
    if (r.decision === "deny") expect(r.audit.code).toBe("grant_expired");
  });
});

describe("authorize — high-risk confirmation flow (INV-9)", () => {
  const submit: Action = { op: "click", target: { name: "Submit application" } };
  // High risk here comes from a THIRD-PARTY submit (form posts cross-origin), not the
  // word "submit" — a same-origin submit is only medium (see risk.test.ts).
  const highCtx: ActionExecContext = {
    ...baseCtx,
    risk: { click: { origin: "https://example.com", buttonSemantics: "submit", sameOriginForm: false } },
    normalize: { origin: "https://example.com", targetLabel: "Submit application", formAction: "https://third-party.example/collect" },
  };

  it("requires confirmation and returns a daemon-authored normalized action", () => {
    const r = authorize({ action: submit, grant, ctx: highCtx, capabilities: caps() });
    expect(r.decision).toBe("needs_confirmation");
    if (r.decision === "needs_confirmation") {
      expect(r.failure.reason).toBe("capability_required");
      // Daemon-authored summary — derived from page fields, not model text.
      expect(r.normalized.summary).toContain("Submit application");
      expect(r.normalized.origin).toBe("https://example.com");
    }
  });

  it("allows the action once a matching capability is minted and provided, then blocks replay", () => {
    const store = caps();
    const gate = authorize({ action: submit, grant, ctx: highCtx, capabilities: store });
    expect(gate.decision).toBe("needs_confirmation");
    if (gate.decision !== "needs_confirmation") return;

    // The daemon mints from ITS normalized action — never model text.
    const cap = store.mint({
      action: gate.normalized,
      origin: "https://example.com",
      pageRevision: 7,
      sensitiveFields: [],
      ttlMs: 60_000,
    });

    const ok = authorize({ action: submit, grant, ctx: highCtx, capabilities: store, providedCapabilityId: cap.capabilityId });
    expect(ok.decision).toBe("allow");
    if (ok.decision === "allow") expect(ok.audit.code).toBe("capability_consumed");

    // Re-issuing the same capability must fail — no prior confirmation authorizes a replay.
    const replay = authorize({ action: submit, grant, ctx: highCtx, capabilities: store, providedCapabilityId: cap.capabilityId });
    expect(replay.decision).toBe("deny");
    if (replay.decision === "deny") expect(replay.failure.reason).toBe("capability_invalid");
  });

  it("rejects a capability once the page revision has moved", () => {
    const store = caps();
    const gate = authorize({ action: submit, grant, ctx: highCtx, capabilities: store });
    if (gate.decision !== "needs_confirmation") throw new Error("expected confirmation");
    const cap = store.mint({ action: gate.normalized, origin: "https://example.com", pageRevision: 7, sensitiveFields: [], ttlMs: 60_000 });
    const moved = authorize({
      action: submit,
      grant,
      ctx: { ...highCtx, pageRevision: 8 },
      capabilities: store,
      providedCapabilityId: cap.capabilityId,
    });
    expect(moved.decision).toBe("deny");
    if (moved.decision === "deny") {
      expect(moved.failure.reason).toBe("capability_invalid");
      expect(moved.audit.code).toBe("capability_revision_mismatch");
    }
  });
});
