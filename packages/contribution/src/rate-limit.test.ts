import { describe, it, expect } from "vitest";
import { createRateLimiter, clientIp } from "./rate-limit.js";

describe("createRateLimiter (COST-03)", () => {
  it("(P0) bounds the map after 50k distinct keys — unconditional eviction under rotation", () => {
    const lim = createRateLimiter(60_000, 60, 10_000);
    for (let i = 0; i < 50_000; i++) lim(`rot-${i}`); // every key fresh: nothing ever "expires"
    expect(lim.size()).toBeLessThanOrEqual(10_000);
  });

  it("(P0) per-request cost does not materially degrade at cap (ratio < 10x, CI-stable)", () => {
    for (let i = 0, w = createRateLimiter(); i < 2000; i++) w(`warm-${i}`); // JIT warmup
    const fresh = createRateLimiter(60_000, 60, 10_000);
    let t = performance.now();
    for (let i = 0; i < 2000; i++) fresh(`a-${i}`);
    const base = performance.now() - t;
    const atCap = createRateLimiter(60_000, 60, 10_000);
    for (let i = 0; i < 10_000; i++) atCap(`pre-${i}`); // fill to cap
    t = performance.now();
    for (let i = 0; i < 2000; i++) atCap(`b-${i}`); // each insert now evicts
    const capped = performance.now() - t;
    const ratio = capped / Math.max(base, 0.5); // 0.5ms floor guards divide-by-tiny
    expect(ratio, `base=${base.toFixed(2)}ms capped=${capped.toFixed(2)}ms ratio=${ratio.toFixed(2)}`).toBeLessThan(10);
  });

  it("returns 0 when allowed, a positive Retry-After (seconds) when over the limit", () => {
    const lim = createRateLimiter(60_000, 3);
    const t = 1_000_000;
    expect(lim("k", t)).toBe(0);
    expect(lim("k", t)).toBe(0);
    expect(lim("k", t)).toBe(0);
    const ra = lim("k", t);
    expect(ra).toBeGreaterThan(0);
    expect(ra).toBeLessThanOrEqual(60);
  });

  it("does not grow a saturated key unboundedly, and drains after the window (not a permanent penalty box)", () => {
    const lim = createRateLimiter(1000, 2);
    expect(lim("k", 0)).toBe(0);
    expect(lim("k", 0)).toBe(0);
    expect(lim("k", 0)).toBeGreaterThan(0); // over → limited, and NOT counted
    expect(lim("k", 2000)).toBe(0); // a full window after the last accepted hit → drained
  });
});

describe("clientIp — trusted-header selection (COST-03 P0)", () => {
  const ip = (headers: Record<string, unknown>) => clientIp({ headers });
  it("takes the RIGHTMOST x-forwarded-for entry, never the client-set leftmost", () => {
    expect(ip({ "x-forwarded-for": "198.18.0.5, 203.0.113.99" })).toBe("203.0.113.99");
  });
  it("prefers x-vercel-forwarded-for over a conflicting x-forwarded-for", () => {
    expect(ip({ "x-vercel-forwarded-for": "9.9.9.9", "x-forwarded-for": "1.2.3.4" })).toBe("9.9.9.9");
  });
  it("prefers x-real-ip over a conflicting x-forwarded-for", () => {
    expect(ip({ "x-real-ip": "8.8.8.8", "x-forwarded-for": "1.2.3.4" })).toBe("8.8.8.8");
  });
  it("falls back to 'unknown' when no IP header is present", () => {
    expect(ip({})).toBe("unknown");
  });
});
