// These suites exercise the ingest path itself, so they run with the deployment opt-in on.
process.env.COMMONS_INGEST_ENABLED = "true";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { InstallIdentity } from "@browser-bridge/contribution";
import { startCommonsIngest, type CommonsIngest } from "./server.js";
import vercelContributions from "../../../api/contributions.ts";
import vercelPurge from "../../../api/purge.ts";

/**
 * The ingest contract exists twice: the local stub (server.ts + validate.ts) and the
 * Vercel functions (api/*.ts). This test is the real proof + drift guard: identical
 * payloads must yield identical status codes from BOTH implementations — now including the
 * ed25519 authorization path (AUTHZ-01/02, AUTH-01/02) and purge ownership proofs.
 */
let stubOn: CommonsIngest;
let stubOff: CommonsIngest;

beforeAll(async () => {
  stubOn = await startCommonsIngest({ storageConfigured: true });
  stubOff = await startCommonsIngest({ storageConfigured: false });
});

afterAll(async () => {
  await stubOn.close();
  await stubOff.close();
});

// A real device identity — so "valid" records carry a genuine key + signature.
const id = new InstallIdentity();
const unsigned = {
  origin: "https://example.com",
  kind: "widget",
  widgetKind: "native-select",
  fingerprint: { role: "combobox", name: "Country" },
  day: "2026-08-01",
  installId: id.installId,
};
const valid = { ...unsigned, publicKey: id.publicKey, signature: id.sign(unsigned) };

/**
 * A minimal in-memory Postgres stand-in for the two statements the functions issue, so the
 * INSERT ... RETURNING (PIPE-02) and DELETE ... rowCount paths execute end to end in the test.
 * `vi.mock` is hoisted, so the store lives inside the factory and is reached via the mock.
 */
vi.mock("pg", () => {
  const rows: { id: number; install_id: string }[] = [];
  let seq = 0;
  class Pool {
    async query(text: string, params: unknown[] = []): Promise<{ rows: unknown[]; rowCount: number }> {
      if (/^\s*INSERT INTO browser_bridge\.contributions/i.test(text)) {
        const row = { id: ++seq, install_id: String(params[0]) };
        rows.push(row);
        return { rows: [row], rowCount: 1 };
      }
      if (/^\s*DELETE FROM browser_bridge\.contributions/i.test(text)) {
        const id = String(params[0]);
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i--) if (rows[i]!.install_id === id) rows.splice(i, 1);
        return { rows: [], rowCount: before - rows.length };
      }
      throw new Error(`unexpected statement: ${text}`);
    }
  }
  return { Pool, default: { Pool } };
});

/** Run `fn` with SUPABASE_DB_URL present or absent — the functions' storage-configured switch. */
function withDb<T>(configured: boolean, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.SUPABASE_DB_URL;
  if (configured) process.env.SUPABASE_DB_URL = "postgres://browser_bridge_app@test/db";
  else delete process.env.SUPABASE_DB_URL;
  return fn().finally(() => {
    if (prev === undefined) delete process.env.SUPABASE_DB_URL;
    else process.env.SUPABASE_DB_URL = prev;
  });
}

async function stubStatus(path: string, storage: boolean, body: unknown): Promise<number> {
  const res = await fetch((storage ? stubOn : stubOff).url + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.status;
}

async function vercelStatus(handler: any, token: boolean, body: unknown): Promise<number> {
  return withDb(token, async () => {
    let status = 0;
    const res = { setHeader() {}, status(s: number) { status = s; return this; }, end() {} };
    await handler({ method: "POST", body } as never, res as never);
    return status;
  });
}

const contributionCases: { name: string; token: boolean; body: unknown; expect: number }[] = [
  { name: "valid signed Class C record → 202", token: true, body: valid, expect: 202 },
  { name: "missing required fields → 400", token: true, body: { kind: "widget" }, expect: 400 },
  { name: "missing publicKey → 400", token: true, body: { ...valid, publicKey: undefined }, expect: 400 },
  { name: "disallowed top-level field → 422", token: true, body: { ...valid, value: "secret" }, expect: 422 },
  { name: "disallowed fingerprint field → 422", token: true, body: { ...valid, fingerprint: { role: "combobox", leaked: "x" } }, expect: 422 },
  { name: "non-string scalar field (typed store) → 422", token: true, body: { ...valid, kind: 7 }, expect: 422 },
  { name: "non-string fingerprint value → 422", token: true, body: { ...valid, fingerprint: { role: "combobox", name: 3 } }, expect: 422 },
  { name: "origin with query string → 422", token: true, body: { ...valid, origin: "https://example.com/p?token=1" }, expect: 422 },
  { name: "origin with a path → 422", token: true, body: { ...valid, origin: "https://example.com/account" }, expect: 422 },
  { name: "oversize record → 413", token: true, body: { ...valid, kind: "x".repeat(20000) }, expect: 413 },
  { name: "forged signature → 401", token: true, body: { ...valid, signature: "AAAAAAAA" }, expect: 401 },
  { name: "installId not derived from key → 401", token: true, body: { ...valid, installId: "0000000000000000" }, expect: 401 },
  { name: "valid record but no durable storage → 503", token: false, body: valid, expect: 503 },
];

describe("contributions parity: local stub === Vercel function", () => {
  for (const c of contributionCases) {
    it(`${c.name} — both agree`, async () => {
      const stub = await stubStatus("/contributions", c.token, c.body);
      const vercel = await vercelStatus(vercelContributions, c.token, c.body);
      expect(stub, `stub: ${c.name}`).toBe(c.expect);
      expect(vercel, `vercel: ${c.name}`).toBe(c.expect);
    });
  }
});

const TEN_MIN = 10 * 60 * 1000;
const purgeCases: { name: string; token: boolean; body: unknown; expect: number }[] = [
  { name: "valid in-window ownership proof → 200", token: true, body: id.purgeProof(), expect: 200 },
  { name: "forged proof signature → 401", token: true, body: { ...id.purgeProof(), signature: "AAAAAAAA" }, expect: 401 },
  { name: "bare installId with no proof → 401", token: true, body: { installId: id.installId }, expect: 401 },
  { name: "expired proof (issuedAt 10 min ago) → 401", token: true, body: id.purgeProof(Date.now() - TEN_MIN), expect: 401 },
  { name: "future-dated proof (issuedAt 10 min ahead) → 401", token: true, body: id.purgeProof(Date.now() + TEN_MIN), expect: 401 },
  { name: "oversize purge body → 413 (P2: purge now has a size cap)", token: true, body: { ...id.purgeProof(), pad: "x".repeat(20000) }, expect: 413 },
  { name: "valid proof but no storage → 503", token: false, body: id.purgeProof(), expect: 503 },
];

describe("purge parity: local stub === Vercel function", () => {
  for (const c of purgeCases) {
    it(`${c.name} — both agree`, async () => {
      const stub = await stubStatus("/purge", c.token, c.body);
      const vercel = await vercelStatus(vercelPurge, c.token, c.body);
      expect(stub, `stub: ${c.name}`).toBe(c.expect);
      expect(vercel, `vercel: ${c.name}`).toBe(c.expect);
    });
  }
});

describe("rate-limit parity: stub === function on the 429 path (COST-03)", () => {
  it("a same-IP burst of valid records trips 429 at the same point in BOTH", async () => {
    // Fresh IP + fresh identity so neither bucket is pre-warmed by other cases.
    const idn = new InstallIdentity();
    const u = { origin: "https://ex.com", kind: "widget", day: "2026-08-01", installId: idn.installId };
    const rec = { ...u, publicKey: idn.publicKey, signature: idn.sign(u) };
    const IP = "203.0.113.200";

    const stubStatuses: number[] = [];
    for (let i = 0; i < 61; i++) {
      const r = await fetch(stubOn.url + "/contributions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": IP },
        body: JSON.stringify(rec),
      });
      stubStatuses.push(r.status);
    }

    const fnStatuses = await withDb(true, async () => {
      const out: number[] = [];
      for (let i = 0; i < 61; i++) {
        let status = 0;
        const res = { setHeader() {}, status(s: number) { status = s; return this; }, end() {} };
        await vercelContributions({ method: "POST", headers: { "x-forwarded-for": IP }, body: rec } as never, res as never);
        out.push(status);
      }
      return out;
    });

    // Both accept the first 60 (202) and 429 the 61st — identical threshold + status path.
    expect(stubStatuses.slice(0, 60).every((s) => s === 202)).toBe(true);
    expect(fnStatuses.slice(0, 60).every((s) => s === 202)).toBe(true);
    expect(stubStatuses[60]).toBe(429);
    expect(fnStatuses[60]).toBe(429);
  });
});

describe("rate-limit parity: crossing a SATURATED IP bucket (COST-03 P1 ordering)", () => {
  // Raw senders that let us set arbitrary headers and send non-JSON bodies.
  const stubRaw = async (path: string, headers: Record<string, string>, body: string): Promise<number> => {
    const r = await fetch(stubOn.url + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
    return r.status;
  };
  const fnRaw = (headers: Record<string, string>, body: unknown): Promise<number> =>
    withDb(true, async () => {
      let status = 0;
      const res = { setHeader() {}, status(s: number) { status = s; return this; }, end() {} };
      await vercelContributions({ method: "POST", headers, body } as never, res as never);
      return status;
    });

  it("oversize/malformed/missing/forged from a saturated IP: stub === function on each", async () => {
    const IP = "203.0.113.210";
    const idn = new InstallIdentity();
    const u = { origin: "https://ex.com", kind: "widget", day: "2026-08-01", installId: idn.installId };
    const validStr = JSON.stringify({ ...u, publicKey: idn.publicKey, signature: idn.sign(u) });

    // Saturate the IP bucket on BOTH (60 accepted requests each).
    for (let i = 0; i < 60; i++) await stubRaw("/contributions", { "x-forwarded-for": IP }, validStr);
    await withDb(true, async () => {
      for (let i = 0; i < 60; i++) {
        const res = { setHeader() {}, status() { return this; }, end() {} };
        await vercelContributions({ method: "POST", headers: { "x-forwarded-for": IP }, body: JSON.parse(validStr) } as never, res as never);
      }
    });

    const big = "x".repeat(20000);
    const cases: { name: string; stub: number; fn: number }[] = [
      { name: "oversize (limiter precedes size cap)", stub: await stubRaw("/contributions", { "x-forwarded-for": IP }, big), fn: await fnRaw({ "x-forwarded-for": IP }, big) },
      { name: "malformed JSON (limiter precedes parse)", stub: await stubRaw("/contributions", { "x-forwarded-for": IP }, "{not json"), fn: await fnRaw({ "x-forwarded-for": IP }, "{not json") },
      { name: "missing fields (limiter precedes fields)", stub: await stubRaw("/contributions", { "x-forwarded-for": IP }, JSON.stringify({ kind: "widget" })), fn: await fnRaw({ "x-forwarded-for": IP }, { kind: "widget" }) },
      { name: "forged signature (limiter precedes verify)", stub: await stubRaw("/contributions", { "x-forwarded-for": IP }, JSON.stringify({ ...u, publicKey: idn.publicKey, signature: "bad" })), fn: await fnRaw({ "x-forwarded-for": IP }, { ...u, publicKey: idn.publicKey, signature: "bad" }) },
    ];
    for (const c of cases) expect(c.stub, `${c.name}: stub=${c.stub} fn=${c.fn}`).toBe(c.fn);
    // wave2d: the IP bucket runs FIRST, so from a saturated IP ALL of these are 429 in both —
    // including oversize + malformed (previously 413/400; inverted here per the P1 fix).
    expect(cases[0]!.fn).toBe(429);
    expect(cases[1]!.fn).toBe(429);
    expect(cases[2]!.fn).toBe(429);
    expect(cases[3]!.fn).toBe(429);
  });
});
