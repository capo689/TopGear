import { describe, it, expect } from "vitest";
import { classify, heuristicProbe, type CandidatePattern } from "./classify.js";

function pattern(over: Partial<CandidatePattern>): CandidatePattern {
  return { origin: "https://example.com", kind: "widget", observedAt: 1_700_000_000_000, ...over };
}

describe("classify (INV-6)", () => {
  it("classifies EXPLICITLY unauthenticated public-origin structure as Class C", () => {
    expect(classify(pattern({ origin: "https://example.com", authStatus: "unauthenticated" })).dataClass).toBe("C");
    expect(classify(pattern({ origin: "https://shop.io", authStatus: "unauthenticated" })).dataClass).toBe("C");
  });

  it("classifies a public origin with UNKNOWN/absent auth DOWN to Class B (R1 finding)", () => {
    expect(classify(pattern({ origin: "https://example.com", authStatus: "unknown" })).dataClass).toBe("B");
    // absent authStatus === unknown → B, never contributed.
    expect(classify(pattern({ origin: "https://example.com" })).dataClass).toBe("B");
  });

  it("classifies intranet / non-public origins as Class B", () => {
    for (const origin of ["http://intranet.local", "http://10.0.0.5", "https://admin.internal", "http://localhost:3000", "http://build-server"]) {
      expect(classify(pattern({ origin, authStatus: "unauthenticated" })).dataClass, origin).toBe("B");
    }
  });

  it("classifies authenticated origins as Class B even on a public TLD", () => {
    expect(classify(pattern({ origin: "https://bank.com", authStatus: "authenticated" })).dataClass).toBe("B");
  });

  it("classifies anything carrying a user value as Class A", () => {
    expect(classify(pattern({ origin: "https://example.com", authStatus: "unauthenticated", value: "hunter2" })).dataClass).toBe("A");
  });

  it("classifies DOWN to B when public status is unknown", () => {
    expect(heuristicProbe.isPublic("https://thing.zzq")).toBe("unknown");
    expect(classify(pattern({ origin: "https://thing.zzq", authStatus: "unauthenticated" })).dataClass).toBe("B");
  });
});
