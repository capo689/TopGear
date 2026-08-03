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

/** A minimal in-memory Vercel Blob simulator so the PUT + PIPE-02 readback path completes. */
function withBlobMock<T>(token: boolean, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.BLOB_READ_WRITE_TOKEN;
  if (token) process.env.BLOB_READ_WRITE_TOKEN = "test-token";
  else delete process.env.BLOB_READ_WRITE_TOKEN;
  const store = new Map<string, string>();
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init: any) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "PUT") {
      store.set(url, String(init?.body ?? ""));
      return { ok: true, status: 200, json: async () => ({ url }) } as Response;
    }
    if (method === "POST" && url.endsWith("/delete")) return { ok: true, status: 200, json: async () => ({}) } as Response;
    if (url.includes("?prefix=")) return { ok: true, status: 200, json: async () => ({ blobs: [] }) } as Response;
    if (store.has(url)) return { ok: true, status: 200, json: async () => JSON.parse(store.get(url)!) } as Response;
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  });
  return fn().finally(() => {
    spy.mockRestore();
    if (prev === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = prev;
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
  return withBlobMock(token, async () => {
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
