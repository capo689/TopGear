import { describe, it, expect } from "vitest";
import { ContributionPipeline } from "./pipeline.js";
import { InMemoryIngest, type IngestClient } from "./ingest.js";
import { InstallIdentity } from "./identity.js";
import { Consent, ContributionViewer } from "./viewer.js";
import type { CandidatePattern } from "./classify.js";
import type { ContributionRecord } from "./anonymize.js";

function deps(ingest: IngestClient = new InMemoryIngest()) {
  return { identity: new InstallIdentity(), ingest, consent: new Consent(true), viewer: new ContributionViewer() };
}

const patterns: CandidatePattern[] = [
  { origin: "https://example.com", url: "https://example.com/a?token=x", kind: "widget", widgetKind: "react-select", fingerprint: { role: "combobox", name: "Country" }, observedAt: 1_700_000_000_000, authStatus: "unauthenticated" }, // Class C
  { origin: "http://intranet.local", kind: "widget", observedAt: 1_700_000_000_000, authStatus: "unauthenticated" }, // Class B (non-public)
  { origin: "https://example.com", kind: "form-field-map", value: "secret", observedAt: 1_700_000_000_000, authStatus: "unauthenticated" }, // Class A (value)
];

describe("ContributionPipeline", () => {
  it("contributes only Class C, discards A/B, and strips values + query strings", async () => {
    const d = deps();
    const summary = await new ContributionPipeline(d).contribute(patterns);
    expect(summary.contributed).toBe(1);
    expect(summary.discardedClassA).toBe(1);
    expect(summary.discardedClassB).toBe(1);

    const ingest = d.ingest as InMemoryIngest;
    expect(ingest.quarantine).toHaveLength(1);
    const rec = ingest.quarantine[0]!;
    expect(rec.origin).toBe("https://example.com");
    expect(JSON.stringify(rec)).not.toContain("token=");
    expect(JSON.stringify(rec)).not.toContain("secret");
    expect(rec.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(rec.signature.length).toBeGreaterThan(0);
  });

  it("skips entirely when consent is off", async () => {
    const d = deps();
    d.consent.disable();
    const summary = await new ContributionPipeline(d).contribute(patterns);
    expect(summary.skippedByConsent).toBe(true);
    expect(summary.contributed).toBe(0);
  });

  it("never throws on ingest failure — it queues for retry", async () => {
    const failing: IngestClient = {
      submit: async () => {
        throw new Error("network down");
      },
      purge: async () => ({ purged: 0 }),
    };
    const summary = await new ContributionPipeline(deps(failing)).contribute([patterns[0]!]);
    expect(summary.queuedForRetry).toBe(1);
    expect(summary.contributed).toBe(0);
  });

  it("kill switch turns consent off AND purges quarantined records", async () => {
    const d = deps();
    const pipeline = new ContributionPipeline(d);
    await pipeline.contribute(patterns);
    expect((d.ingest as InMemoryIngest).quarantine.length).toBe(1);

    const purged = await pipeline.killSwitch();
    expect(d.consent.enabled).toBe(false);
    expect(purged.purgedRemote).toBe(1);
    expect((d.ingest as InMemoryIngest).quarantine.length).toBe(0);
    expect(d.viewer.listSent()).toHaveLength(0);
  });
});
