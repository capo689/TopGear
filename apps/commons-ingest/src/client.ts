import type { IngestClient, ContributionRecord, PurgeProof } from "@browser-bridge/contribution";

/**
 * IngestClient over HTTP. Points at the local stub today and at the Vercel endpoint at
 * R1 — the routes are identical, so nothing else changes (§16 decision 3).
 */
export class HttpIngestClient implements IngestClient {
  constructor(private readonly baseUrl: string) {}

  async submit(record: ContributionRecord): Promise<{ accepted: boolean }> {
    const res = await fetch(this.baseUrl + "/contributions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(record),
    });
    return { accepted: res.status === 202 };
  }

  async purge(proof: PurgeProof): Promise<{ purged: number }> {
    const res = await fetch(this.baseUrl + "/purge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(proof),
    });
    const body = (await res.json()) as { purged?: number };
    return { purged: body.purged ?? 0 };
  }
}
