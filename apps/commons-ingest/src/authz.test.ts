import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { InstallIdentity } from "@browser-bridge/contribution";
import { startCommonsIngest, type CommonsIngest } from "./server.js";

/**
 * TEST-01: authorization tests for the ingest endpoints, driven over the REAL stub (HTTP
 * relay + real ed25519), with two distinct install identities. Proves the daemon-side
 * guarantees the FINISHER audit flagged: a forged contribution is refused, and one
 * install cannot purge another's records (AUTHZ-01/02, AUTH-01/02).
 */
let stub: CommonsIngest;
const A = new InstallIdentity();
const B = new InstallIdentity();

function record(id: InstallIdentity, origin = "https://a.example"): Record<string, unknown> {
  const unsigned = { origin, kind: "widget", day: "2026-08-01", installId: id.installId };
  return { ...unsigned, publicKey: id.publicKey, signature: id.sign(unsigned) };
}

async function post(path: string, body: unknown): Promise<number> {
  const res = await fetch(stub.url + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return res.status;
}

beforeAll(async () => {
  stub = await startCommonsIngest({ storageConfigured: true });
});
afterAll(async () => {
  await stub.close();
});

describe("contribution authorization", () => {
  it("accepts a genuinely signed record", async () => {
    expect(await post("/contributions", record(A))).toBe(202);
  });

  it("rejects a forged signature (401) and never stores it", async () => {
    const before = stub.quarantine.length;
    expect(await post("/contributions", { ...record(A), signature: "AAAAAAAA" })).toBe(401);
    expect(stub.quarantine.length).toBe(before);
  });

  it("rejects a record whose installId is not derived from its key (401) — cannot claim another id", async () => {
    // A signs its own record, then swaps in B's installId. The server derives the id from
    // A's key and refuses the mismatch, so A cannot poison B's namespace (plan T6).
    expect(await post("/contributions", { ...record(A), installId: B.installId })).toBe(401);
  });
});

describe("purge ownership isolation", () => {
  it("only purges the caller's own install, never another's", async () => {
    const fresh = await startCommonsIngest({ storageConfigured: true });
    try {
      // A contributes twice, B once.
      await fetch(fresh.url + "/contributions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(record(A)) });
      await fetch(fresh.url + "/contributions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(record(A, "https://a2.example")) });
      await fetch(fresh.url + "/contributions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(record(B)) });
      expect(fresh.quarantine.length).toBe(3);

      // A's signed proof purges ONLY A's two records; B's remains.
      const res = await fetch(fresh.url + "/purge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(A.purgeProof()) });
      expect(res.status).toBe(200);
      expect((await res.json()).purged).toBe(2);
      expect(fresh.quarantine.length).toBe(1);
      expect(fresh.quarantine[0]!.installId).toBe(B.installId);
    } finally {
      await fresh.close();
    }
  });

  it("rejects a bare installId with no proof (401)", async () => {
    expect(await post("/purge", { installId: B.installId })).toBe(401);
  });

  it("rejects a forged ownership proof (401)", async () => {
    expect(await post("/purge", { ...B.purgeProof(), signature: "AAAAAAAA" })).toBe(401);
  });

  it("rejects an expired proof — an observed proof is not a permanent purge capability (401)", async () => {
    const tenMinAgo = Date.now() - 10 * 60 * 1000;
    expect(await post("/purge", A.purgeProof(tenMinAgo))).toBe(401);
  });

  it("accepts bounded in-window replay of the same proof (200, by design)", async () => {
    const fresh = await startCommonsIngest({ storageConfigured: true });
    try {
      await fetch(fresh.url + "/contributions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(record(A)) });
      const proof = A.purgeProof(); // one proof, replayed within the window
      const first = await fetch(fresh.url + "/purge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(proof) });
      const second = await fetch(fresh.url + "/purge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(proof) });
      expect(first.status).toBe(200);
      expect((await first.json()).purged).toBe(1);
      expect(second.status).toBe(200); // in-window replay is accepted…
      expect((await second.json()).purged).toBe(0); // …but idempotent — nothing left to purge
    } finally {
      await fresh.close();
    }
  });
});
