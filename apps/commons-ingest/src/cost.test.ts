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

/** The five cases the brief requires, named a)-e). Real handler, no mocks. */
describe("COST-03 required cases (a)-(e)", () => {
  const validRecord = (id: InstallIdentity, origin = "https://ex.com") => {
    const unsigned = { origin, kind: "widget", day: "2026-08-01", installId: id.installId };
    return { ...unsigned, publicKey: id.publicKey, signature: id.sign(unsigned) };
  };

  it("(a) same IP, ROTATING installId every request → still rate limited by IP", async () => {
    const ip = { "x-forwarded-for": "172.16.1.1" };
    const s: number[] = [];
    for (let i = 0; i < 200; i++) s.push(await fire(vercelContributions, ip, { installId: `rot-${i}` }));
    expect(s.slice(0, 60).every((x) => x !== 429)).toBe(true);
    expect(s[60]).toBe(429);
    expect(s.filter((x) => x === 429).length).toBeGreaterThan(130);
  });

  it("(b) same IP, same installId → limited by whichever bound trips first", async () => {
    const ip = { "x-forwarded-for": "172.16.2.1" };
    const s: number[] = [];
    for (let i = 0; i < 65; i++) s.push(await fire(vercelContributions, ip, { installId: "fixed" }));
    expect(s[64]).toBe(429);
  });

  it("(c) different IPs, same VERIFIED installId → installId bound trips, IP bound does not", async () => {
    const id = new InstallIdentity();
    const rec = validRecord(id);
    const s: number[] = [];
    for (let i = 0; i < 65; i++) s.push(await fire(vercelContributions, { "x-forwarded-for": `172.17.${i}.9` }, rec));
    // Each IP is fresh (bucket=1), so only the installId bucket can trip. 503 = passed verify
    // + id-bucket, then no storage; 61st trips the installId bound.
    expect(s.slice(0, 60).every((x) => x === 503)).toBe(true);
    expect(s[64]).toBe(429);
  });

  it("(d) INVALID signatures consume the IP bucket but leave the installId bucket untouched", async () => {
    const q = new InstallIdentity();
    const bad = { ...validRecord(q), signature: "not-a-valid-signature" }; // reaches verify, fails there (401)
    const ipd = { "x-forwarded-for": "172.18.5.5" };
    const s: number[] = [];
    for (let i = 0; i < 60; i++) s.push(await fire(vercelContributions, ipd, bad));
    expect(s.every((x) => x === 401)).toBe(true); // all failed verify, none rate-limited yet
    // IP bucket IS consumed by the invalids → the 61st from this IP is 429…
    expect(await fire(vercelContributions, ipd, bad)).toBe(429);
    // …but installId q's bucket was NOT touched (verify failed before it), so a VALID q record
    // from a fresh IP still passes (503 no storage, not 429).
    expect(await fire(vercelContributions, { "x-forwarded-for": "172.18.6.6" }, validRecord(q))).toBe(503);
  });

  it("(e) a valid request from a fresh IP and fresh verified installId passes (not rate limited)", async () => {
    const status = await fire(vercelContributions, { "x-forwarded-for": "172.19.7.7" }, validRecord(new InstallIdentity()));
    expect(status).toBe(503); // passes IP + verify + installId buckets; 503 only because no storage token
    expect(status).not.toBe(429);
  });
});

/** P0 (wave2c): the IP bound must survive a client that forges x-forwarded-for. */
describe("COST-03 P0 — trusted-IP bound (spoofed headers)", () => {
  it("a caller PREPENDING a rotating x-forwarded-for entry is STILL rate limited", async () => {
    // Rightmost entry (203.0.113.99, the closest-proxy hop) is constant → one bucket.
    const s: number[] = [];
    for (let i = 0; i < 200; i++) {
      s.push(await fire(vercelContributions, { "x-forwarded-for": `198.18.0.${i % 250}, 203.0.113.99` }, { installId: "x" }));
    }
    expect(s.includes(429), "spoofed XFF was never rate limited — the primary bound does not exist").toBe(true);
    expect(s[60]).toBe(429);
  });

  it("x-real-ip is preferred over a conflicting client-supplied x-forwarded-for", async () => {
    const s: number[] = [];
    for (let i = 0; i < 65; i++) {
      s.push(await fire(vercelContributions, { "x-real-ip": "10.9.9.9", "x-forwarded-for": `spoof-${i}` }, { installId: "x" }));
    }
    expect(s[64]).toBe(429); // keyed on the constant x-real-ip, not the rotating x-forwarded-for
  });

  it("x-vercel-forwarded-for is preferred over a conflicting client-supplied x-forwarded-for", async () => {
    const s: number[] = [];
    for (let i = 0; i < 65; i++) {
      s.push(await fire(vercelContributions, { "x-vercel-forwarded-for": "10.8.8.8", "x-forwarded-for": `spoof-${i}` }, { installId: "x" }));
    }
    expect(s[64]).toBe(429);
  });
});
