import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startCommonsIngest, type CommonsIngest } from "./server.js";
import { HttpIngestClient } from "./client.js";
import { ContributionPipeline, InstallIdentity, Consent, ContributionViewer, generateAuditFixtures } from "@browser-bridge/contribution";

let ingest: CommonsIngest;

beforeAll(async () => {
  ingest = await startCommonsIngest();
});

afterAll(async () => {
  await ingest.close();
});

describe("commons-ingest (INV-10 collection live, against the stub)", () => {
  it("collects Class C contributions end-to-end into quarantine, and the kill switch purges them", async () => {
    const client = new HttpIngestClient(ingest.url);
    const pipeline = new ContributionPipeline({
      identity: new InstallIdentity(),
      ingest: client,
      consent: new Consent(true),
      viewer: new ContributionViewer(),
    });

    const summary = await pipeline.contribute(generateAuditFixtures(24));
    expect(summary.contributed).toBeGreaterThan(0);
    expect(ingest.quarantine.length).toBe(summary.contributed);
    // Nothing in quarantine carries a value or query string.
    expect(JSON.stringify(ingest.quarantine)).not.toContain("token=");
    expect(JSON.stringify(ingest.quarantine)).not.toContain("user typed value");

    const purge = await pipeline.killSwitch();
    expect(purge.purgedRemote).toBe(summary.contributed);
    expect(ingest.quarantine.length).toBe(0);
  });

  it("rejects malformed records", async () => {
    const res = await fetch(ingest.url + "/contributions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nope: true }) });
    expect(res.status).toBe(400);
  });
});
