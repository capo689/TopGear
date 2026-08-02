import { describe, it, expect } from "vitest";
import { classify, heuristicProbe, type CandidatePattern } from "./classify.js";

function pattern(over: Partial<CandidatePattern>): CandidatePattern {
  return { origin: "https://example.com", kind: "widget", observedAt: 1_700_000_000_000, ...over };
}

describe("classify (INV-6)", () => {
  it("classifies public-origin structure as Class C", () => {
    expect(classify(pattern({ origin: "https://example.com" })).dataClass).toBe("C");
    expect(classify(pattern({ origin: "https://shop.io" })).dataClass).toBe("C");
  });

  it("classifies intranet / non-public origins as Class B", () => {
    for (const origin of ["http://intranet.local", "http://10.0.0.5", "https://admin.internal", "http://localhost:3000", "http://build-server"]) {
      expect(classify(pattern({ origin })).dataClass, origin).toBe("B");
    }
  });

  it("classifies authenticated origins as Class B even on a public TLD", () => {
    expect(classify(pattern({ origin: "https://bank.com", authenticated: true })).dataClass).toBe("B");
  });

  it("classifies anything carrying a user value as Class A", () => {
    expect(classify(pattern({ origin: "https://example.com", value: "hunter2" })).dataClass).toBe("A");
  });

  it("classifies DOWN to B when public status is unknown", () => {
    // An unrecognized TLD is not proven public → do not contribute.
    expect(heuristicProbe.isPublic("https://thing.zzq")).toBe("unknown");
    expect(classify(pattern({ origin: "https://thing.zzq" })).dataClass).toBe("B");
  });
});
