import { classify, type CandidatePattern, type PublicOriginProbe } from "./classify.js";
import { anonymize, type ContributionRecord } from "./anonymize.js";
import type { InstallIdentity } from "./identity.js";
import type { IngestClient } from "./ingest.js";
import { Consent, ContributionViewer } from "./viewer.js";

export interface PipelineDeps {
  identity: InstallIdentity;
  ingest: IngestClient;
  consent: Consent;
  viewer: ContributionViewer;
  probe?: PublicOriginProbe;
}

export interface ContributionSummary {
  considered: number;
  contributed: number;
  discardedClassA: number;
  discardedClassB: number;
  skippedByConsent: boolean;
  queuedForRetry: number;
}

/**
 * The client-side contribution pipeline (§9.2, live at R1 per INV-10). Runs on task
 * completion: extract → classify (A/B discarded here) → anonymize → sign → upload. It
 * NEVER blocks or slows a task; ingest failures queue for retry. Only Class C leaves.
 */
export class ContributionPipeline {
  constructor(private readonly deps: PipelineDeps) {}

  async contribute(patterns: CandidatePattern[]): Promise<ContributionSummary> {
    const summary: ContributionSummary = {
      considered: patterns.length,
      contributed: 0,
      discardedClassA: 0,
      discardedClassB: 0,
      skippedByConsent: false,
      queuedForRetry: 0,
    };

    if (!this.deps.consent.enabled) {
      summary.skippedByConsent = true;
      return summary;
    }

    for (const pattern of patterns) {
      const cls = classify(pattern, this.deps.probe);
      if (cls.dataClass !== "C") {
        if (cls.dataClass === "A") summary.discardedClassA += 1;
        else summary.discardedClassB += 1;
        this.deps.viewer.discard({ origin: pattern.origin, dataClass: cls.dataClass, reason: cls.reason });
        continue;
      }
      const unsigned = anonymize(pattern, this.deps.identity.installId);
      const record: ContributionRecord = { ...unsigned, signature: this.deps.identity.sign(unsigned) };
      this.deps.viewer.record(record);
      try {
        await this.deps.ingest.submit(record);
        summary.contributed += 1;
      } catch {
        summary.queuedForRetry += 1; // never blocks the task
      }
    }
    return summary;
  }

  /** The kill switch (§9.3): off is instant AND retroactive — purge unpromoted records. */
  async killSwitch(): Promise<{ purgedLocal: number; purgedRemote: number }> {
    this.deps.consent.disable();
    const purgedLocal = this.deps.viewer.purgeAll();
    const { purged } = await this.deps.ingest.purge(this.deps.identity.installId);
    return { purgedLocal, purgedRemote: purged };
  }
}
