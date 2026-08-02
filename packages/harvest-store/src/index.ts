import { createHash } from "node:crypto";

/**
 * @browser-bridge/harvest-store — corpora + full-text search (plan §8). Harvested content
 * is Class A: it NEVER leaves the machine and NEVER auto-enters model context. The model
 * queries it afterward in chunks (`bridge_harvest`). Capture ≠ comprehension: one fetch,
 * many readers. Dedupe by URL + content hash.
 *
 * M3 ships the in-memory store + a simple tokenized ranker. The persistent store is
 * better-sqlite3 + FTS5 behind this SAME interface (per the site-memory decision).
 */

export interface HarvestRecord {
  url: string;
  contentHash: string;
  title?: string;
  text: string;
  harvestedAt: number;
}

export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function tokenize(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

export interface HarvestSearchResult {
  record: HarvestRecord;
  score: number;
}

export interface HarvestStore {
  add(input: { url: string; text: string; title?: string; harvestedAt: number }): { added: boolean; deduped: boolean };
  count(): number;
  list(): HarvestRecord[];
  search(query: string, limit?: number): HarvestSearchResult[];
  exportChunks(chunkSize: number): HarvestRecord[][];
  clear(): void;
}

export class InMemoryHarvestStore implements HarvestStore {
  private readonly records: HarvestRecord[] = [];
  private readonly seen = new Set<string>();

  add(input: { url: string; text: string; title?: string; harvestedAt: number }): { added: boolean; deduped: boolean } {
    const hash = contentHash(input.text);
    const key = input.url + "\n" + hash;
    if (this.seen.has(key)) return { added: false, deduped: true };
    this.seen.add(key);
    const record: HarvestRecord = { url: input.url, contentHash: hash, text: input.text, harvestedAt: input.harvestedAt };
    if (input.title !== undefined) record.title = input.title;
    this.records.push(record);
    return { added: true, deduped: false };
  }

  count(): number {
    return this.records.length;
  }

  list(): HarvestRecord[] {
    return [...this.records];
  }

  /** Tokenized term-frequency ranking (the FTS stand-in). */
  search(query: string, limit = 20): HarvestSearchResult[] {
    const terms = tokenize(query);
    if (terms.length === 0) return [];
    const results: HarvestSearchResult[] = [];
    for (const record of this.records) {
      const haystack = tokenize((record.title ?? "") + " " + record.text);
      const counts = new Map<string, number>();
      for (const t of haystack) counts.set(t, (counts.get(t) ?? 0) + 1);
      let score = 0;
      for (const term of terms) score += counts.get(term) ?? 0;
      if (score > 0) results.push({ record, score });
    }
    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /** Chunk the corpus so the model reads it in bounded pieces afterward. */
  exportChunks(chunkSize: number): HarvestRecord[][] {
    const chunks: HarvestRecord[][] = [];
    for (let i = 0; i < this.records.length; i += chunkSize) {
      chunks.push(this.records.slice(i, i + chunkSize));
    }
    return chunks;
  }

  clear(): void {
    this.records.length = 0;
    this.seen.clear();
  }
}
