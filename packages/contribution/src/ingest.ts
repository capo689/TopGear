import type { ContributionRecord } from "./anonymize.js";

/**
 * The ingest client contract. The local stub (`apps/commons-ingest`) and the future
 * Vercel endpoint implement the SAME interface, so the client is unchanged when the real
 * endpoint lands (§16 decision 3). `purge` powers the retroactive kill switch (§9.3).
 */
export interface IngestClient {
  submit(record: ContributionRecord): Promise<{ accepted: boolean }>;
  purge(installId: string): Promise<{ purged: number }>;
}

/** In-memory ingest for tests and dogfood, mirroring the quarantine bucket semantics. */
export class InMemoryIngest implements IngestClient {
  readonly quarantine: ContributionRecord[] = [];

  async submit(record: ContributionRecord): Promise<{ accepted: boolean }> {
    this.quarantine.push(record);
    return { accepted: true };
  }

  async purge(installId: string): Promise<{ purged: number }> {
    const before = this.quarantine.length;
    for (let i = this.quarantine.length - 1; i >= 0; i--) {
      if (this.quarantine[i]!.installId === installId) this.quarantine.splice(i, 1);
    }
    return { purged: before - this.quarantine.length };
  }
}
