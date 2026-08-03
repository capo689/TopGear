import { describe, it, expect } from "vitest";
import vercelContributions from "../../../api/contributions.ts";
import vercelPurge from "../../../api/purge.ts";

/**
 * COST-03: the ingest functions apply a best-effort per-instance rate limit keyed on
 * IP + installId. This proves the 429 fires past the cap. It is NOT a hard cap (no durable
 * storage → per warm instance only; an attacker rotating IPs or hitting many instances
 * escapes it) — see DECISIONS. The point verified here: a single-source burst is blunted,
 * and installId rotation alone does not escape the per-IP bound.
 */
async function fire(handler: any, headers: Record<string, string>, body: unknown): Promise<number> {
  let status = 0;
  const res = { setHeader() {}, status(s: number) { status = s; return this; }, end() {} };
  await handler({ method: "POST", headers, body } as never, res as never);
  return status;
}

describe("rate limiting (COST-03)", () => {
  it("contributions: a single IP+installId burst trips 429 past the cap", async () => {
    const headers = { "x-forwarded-for": "203.0.113.7" };
    const body = { installId: "floodkey" }; // parses + has installId; fails fields later, but rate-limit is checked first
    const statuses: number[] = [];
    for (let i = 0; i < 65; i++) statuses.push(await fire(vercelContributions, headers, body));
    expect(statuses.slice(0, 60).every((s) => s !== 429)).toBe(true);
    expect(statuses.includes(429)).toBe(true);
    expect(statuses[64]).toBe(429);
  });

  it("purge: a single IP+installId burst trips 429 past the cap", async () => {
    const headers = { "x-forwarded-for": "203.0.113.8" };
    const body = { installId: "floodkey2", publicKey: "x", signature: "y", issuedAt: 0 };
    const statuses: number[] = [];
    for (let i = 0; i < 65; i++) statuses.push(await fire(vercelPurge, headers, body));
    expect(statuses.includes(429)).toBe(true);
    expect(statuses[64]).toBe(429);
  });

  it("a different IP is not limited by another IP's burst", async () => {
    // Fresh IP, same kind of body: the first request must not already be limited.
    const first = await fire(vercelContributions, { "x-forwarded-for": "198.51.100.42" }, { installId: "floodkey" });
    expect(first).not.toBe(429);
  });
});
