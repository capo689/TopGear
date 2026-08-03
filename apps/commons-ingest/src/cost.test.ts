import { describe, it, expect } from "vitest";
import { InstallIdentity } from "@browser-bridge/contribution";
import vercelContributions from "../../../api/contributions.ts";
import vercelPurge from "../../../api/purge.ts";

/**
 * COST-03: the ingest functions apply TWO independent best-effort rate-limit buckets — IP
 * alone (before verify) and the verified installId (after verify); either trips a 429. It is
 * NOT a hard cap (no durable storage → per warm instance only; IP rotation or cross-instance
 * distribution escapes it) — see DECISIONS. The critical property proven here is the one the
 * first version got WRONG: rotating the installId at a single IP must NOT mint fresh buckets.
 */
async function fire(handler: any, headers: Record<string, string>, body: unknown): Promise<number> {
  let status = 0;
  const res = { setHeader() {}, status(s: number) { status = s; return this; }, end() {} };
  await handler({ method: "POST", headers, body } as never, res as never);
  return status;
}

describe("rate limiting (COST-03)", () => {
  it("contributions: a single IP burst trips 429 past the cap", async () => {
    const headers = { "x-forwarded-for": "203.0.113.7" };
    const statuses: number[] = [];
    for (let i = 0; i < 65; i++) statuses.push(await fire(vercelContributions, headers, { installId: "same" }));
    expect(statuses.slice(0, 60).every((s) => s !== 429)).toBe(true);
    expect(statuses[64]).toBe(429);
  });

  it("contributions: SAME IP rotating installId still trips 429 (the composite-key bug)", async () => {
    // One IP, a different installId string every request. The old composite `ip:installId`
    // key handed out a fresh bucket each time and never limited. IP-alone must bound it.
    const headers = { "x-forwarded-for": "203.0.113.10" };
    const statuses: number[] = [];
    for (let i = 0; i < 200; i++) statuses.push(await fire(vercelContributions, headers, { installId: `rotate-${i}` }));
    expect(statuses.slice(0, 60).every((s) => s !== 429)).toBe(true);
    expect(statuses[64]).toBe(429);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(130);
  });

  it("contributions: SECONDARY bucket — one verified installId across many IPs trips 429", async () => {
    // Valid signed record from a single identity, each request from a DIFFERENT IP so the
    // IP-alone bucket never trips. The verified-installId bucket must catch it. No token →
    // the first requests reach 503 (after passing verify + the id-bucket); the 61st trips 429.
    const idn = new InstallIdentity();
    const unsigned = { origin: "https://ex.com", kind: "widget", day: "2026-08-01", installId: idn.installId };
    const rec = { ...unsigned, publicKey: idn.publicKey, signature: idn.sign(unsigned) };
    const statuses: number[] = [];
    for (let i = 0; i < 65; i++) statuses.push(await fire(vercelContributions, { "x-forwarded-for": `10.0.${i}.1` }, rec));
    expect(statuses.slice(0, 60).every((s) => s !== 429)).toBe(true); // 503 (no storage), not rate-limited
    expect(statuses[64]).toBe(429);
  });

  it("purge: a single IP burst trips 429 past the cap", async () => {
    const headers = { "x-forwarded-for": "203.0.113.8" };
    const statuses: number[] = [];
    for (let i = 0; i < 65; i++) statuses.push(await fire(vercelPurge, headers, { installId: "same", publicKey: "x", signature: "y", issuedAt: 0 }));
    expect(statuses[64]).toBe(429);
  });

  it("a different IP is not limited by another IP's burst", async () => {
    const first = await fire(vercelContributions, { "x-forwarded-for": "198.51.100.42" }, { installId: "whatever" });
    expect(first).not.toBe(429);
  });
});
