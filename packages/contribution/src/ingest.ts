import type { ContributionRecord } from "./anonymize.js";
import type { PurgeProof } from "./identity.js";

/**
 * The ingest client contract. The local stub (`apps/commons-ingest`) and the Vercel
 * endpoint implement the SAME interface, so the client is unchanged (§16 decision 3).
 * `purge` powers the retroactive kill switch (§9.3) and now carries a signed ownership
 * proof (AUTHZ-02) rather than a bare installId anyone could name.
 */
export interface IngestClient {
  submit(record: ContributionRecord): Promise<{ accepted: boolean }>;
  purge(proof: PurgeProof): Promise<{ purged: number }>;
}

/** In-memory ingest for tests and dogfood, mirroring the quarantine bucket semantics. */
export class InMemoryIngest implements IngestClient {
  readonly quarantine: ContributionRecord[] = [];

  async submit(record: ContributionRecord): Promise<{ accepted: boolean }> {
    this.quarantine.push(record);
    return { accepted: true };
  }

  async purge(proof: PurgeProof): Promise<{ purged: number }> {
    // Local, same-process trust domain: the proof's installId (already the keyholder's
    // own) selects the records. The signature check that matters is the remote endpoint's.
    const before = this.quarantine.length;
    for (let i = this.quarantine.length - 1; i >= 0; i--) {
      if (this.quarantine[i]!.installId === proof.installId) this.quarantine.splice(i, 1);
    }
    return { purged: before - this.quarantine.length };
  }
}
