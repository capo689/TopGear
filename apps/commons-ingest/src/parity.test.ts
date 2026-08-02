import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { startCommonsIngest, type CommonsIngest } from "./server.js";
import vercelContributions from "../../../api/contributions.ts";

/**
 * The ingest contract now exists twice: the local stub (server.ts) and the Vercel
 * function (api/contributions.ts). Fable code-reviewed the Vercel handler's validation
 * but could not exercise POST bodies live. This test is the real proof + the drift guard:
 * identical payloads must yield identical status codes from BOTH implementations.
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

async function stubStatus(storage: boolean, body: unknown): Promise<number> {
  const res = await fetch((storage ? stubOn : stubOff).url + "/contributions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.status;
}

async function vercelStatus(token: boolean, body: unknown): Promise<number> {
  const prev = process.env.BLOB_READ_WRITE_TOKEN;
  if (token) process.env.BLOB_READ_WRITE_TOKEN = "test-token";
  else delete process.env.BLOB_READ_WRITE_TOKEN;
  const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, status: 200 } as Response);
  let status = 0;
  const res = {
    setHeader() {},
    status(s: number) {
      status = s;
      return this;
    },
    end() {},
  };
  await vercelContributions({ method: "POST", body } as never, res as never);
  spy.mockRestore();
  if (prev === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN = prev;
  return status;
}

const valid = {
  origin: "https://example.com",
  kind: "widget",
  widgetKind: "native-select",
  fingerprint: { role: "combobox", name: "Country" },
  day: "2026-08-01",
  installId: "abc123",
  signature: "sig",
};

const cases: { name: string; token: boolean; body: unknown; expect: number }[] = [
  { name: "valid Class C record → 202", token: true, body: valid, expect: 202 },
  { name: "missing required fields → 400", token: true, body: { kind: "widget" }, expect: 400 },
  { name: "disallowed top-level field → 422", token: true, body: { ...valid, value: "secret" }, expect: 422 },
  { name: "disallowed fingerprint field → 422", token: true, body: { ...valid, fingerprint: { role: "combobox", leaked: "x" } }, expect: 422 },
  { name: "origin with query string → 422", token: true, body: { ...valid, origin: "https://example.com/p?token=1" }, expect: 422 },
  { name: "origin with a path → 422", token: true, body: { ...valid, origin: "https://example.com/account" }, expect: 422 },
  { name: "oversize record → 413", token: true, body: { ...valid, kind: "x".repeat(20000) }, expect: 413 },
  { name: "no durable storage → 503", token: false, body: valid, expect: 503 },
];

describe("ingest parity: local stub === Vercel function", () => {
  for (const c of cases) {
    it(`${c.name} — both implementations agree`, async () => {
      const stub = await stubStatus(c.token, c.body);
      const vercel = await vercelStatus(c.token, c.body);
      expect(stub, `stub: ${c.name}`).toBe(c.expect);
      expect(vercel, `vercel: ${c.name}`).toBe(c.expect);
    });
  }
});
