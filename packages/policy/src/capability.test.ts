import { describe, it, expect } from "vitest";
import { CapabilityStore } from "./capability.js";
import { fakeClock } from "./clock.js";
import { sequentialNonce } from "./nonce.js";
import type { NormalizedAction } from "@browser-bridge/protocol";

const action: NormalizedAction = {
  op: "click",
  summary: "Activate \"Submit\" on https://example.com.",
  origin: "https://example.com",
};

function store(startMs = 0) {
  return new CapabilityStore(fakeClock(startMs), sequentialNonce());
}

const mintArgs = {
  action,
  origin: "https://example.com",
  pageRevision: 7,
  sensitiveFields: [],
  ttlMs: 60_000,
};

describe("CapabilityStore", () => {
  it("mints a capability with the injected nonce and a bound revision/origin", () => {
    const s = store();
    const cap = s.mint(mintArgs);
    expect(cap.capabilityId).toBe("cap-0");
    expect(cap.origin).toBe("https://example.com");
    expect(cap.pageRevision).toBe(7);
  });

  it("consumes a valid capability exactly once (single-use)", () => {
    const s = store();
    const cap = s.mint(mintArgs);
    const first = s.consume(cap.capabilityId, { origin: "https://example.com", pageRevision: 7 });
    expect(first.ok).toBe(true);
    const second = s.consume(cap.capabilityId, { origin: "https://example.com", pageRevision: 7 });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("already_consumed");
    expect(s.isConsumed(cap.capabilityId)).toBe(true);
  });

  it("rejects a capability after its TTL expires", () => {
    const clock = fakeClock(0);
    const s = new CapabilityStore(clock, sequentialNonce());
    const cap = s.mint({ ...mintArgs, ttlMs: 5_000 });
    clock.advance(5_001);
    const r = s.consume(cap.capabilityId, { origin: "https://example.com", pageRevision: 7 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("expired");
  });

  it("rejects a capability used against a moved page revision", () => {
    const s = store();
    const cap = s.mint(mintArgs);
    const r = s.consume(cap.capabilityId, { origin: "https://example.com", pageRevision: 8 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("revision_mismatch");
    // Failed consume must NOT burn the capability.
    expect(s.isConsumed(cap.capabilityId)).toBe(false);
  });

  it("rejects a capability used against a different origin", () => {
    const s = store();
    const cap = s.mint(mintArgs);
    const r = s.consume(cap.capabilityId, { origin: "https://evil.example", pageRevision: 7 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("origin_mismatch");
  });

  it("rejects an unknown capability id", () => {
    const s = store();
    const r = s.consume("nope", { origin: "https://example.com", pageRevision: 7 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown");
  });

  it("will not consume a pending capability until a human approves it (INV-9)", () => {
    const s = store();
    const cap = s.mintPending(mintArgs);
    const before = s.consume(cap.capabilityId, { origin: "https://example.com", pageRevision: 7 });
    expect(before.ok).toBe(false);
    if (!before.ok) expect(before.reason).toBe("not_approved");

    expect(s.approve(cap.capabilityId)).toBe(true);
    const after = s.consume(cap.capabilityId, { origin: "https://example.com", pageRevision: 7 });
    expect(after.ok).toBe(true);
  });
});
