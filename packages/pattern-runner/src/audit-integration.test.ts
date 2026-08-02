import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startFixtureFarm, type FixtureFarm } from "@browser-bridge/fixture-farm";
import { createPlaywrightBackend } from "@browser-bridge/browser-playwright";
import { Scheduler, TaskBudget } from "@browser-bridge/scheduler";
import { InMemoryHarvestStore } from "@browser-bridge/harvest-store";
import type { BrowserBackend } from "@browser-bridge/backend";
import { runClassificationAudit, renderAuditReport, type CandidatePattern } from "@browser-bridge/contribution";
import { PatternRunner, CrawlPolicy, parseRobots } from "./index.js";

/**
 * R1 finding follow-through: feed REAL pattern-runner output through the classification
 * audit. The fixture farm is on 127.0.0.1 — a private origin — so its structural
 * observations must ALL classify to Class B (never contributed), and harvested CONTENT
 * (Class A) must never appear in any contribution record.
 */
let farm: FixtureFarm;
let backend: BrowserBackend;

beforeAll(async () => {
  farm = await startFixtureFarm();
  backend = await createPlaywrightBackend({ headless: true, isolated: true });
}, 60_000);

afterAll(async () => {
  await backend?.shutdown();
  await farm?.close();
});

describe("pattern-runner output → classification audit (no leakage)", () => {
  it("harvests, derives structural candidates, and leaks ZERO — private origin withheld", async () => {
    const store = new InMemoryHarvestStore();
    const origin = new URL(farm.url).origin;
    const runner = new PatternRunner({
      backend,
      scheduler: new Scheduler({ maxGlobalConcurrency: 3, perOriginConcurrency: 3 }),
      store,
      crawl: new CrawlPolicy({ allowedOrigins: [origin], robots: parseRobots("User-agent: *\n") }),
      budget: new TaskBudget({ maxPages: 20 }),
    });
    const urls = Array.from({ length: 5 }, (_, i) => `${farm.url}/harvest/${i + 1}`);
    await runner.run({ urls });
    expect(store.count()).toBe(5);

    // Structural candidates as the contribution pipeline would derive them from what was
    // visited. Even marked unauthenticated, 127.0.0.1 is non-public → Class B.
    const candidates: CandidatePattern[] = store.list().map((r) => ({
      origin: new URL(r.url).origin,
      url: r.url,
      kind: "link-graph",
      observedAt: r.harvestedAt,
      authStatus: "unauthenticated",
    }));

    const audit = runClassificationAudit(candidates);
    expect(audit.leaks, renderAuditReport(audit)).toHaveLength(0);
    // A private origin contributes NOTHING.
    expect(audit.contributed).toHaveLength(0);
    expect(audit.byClass.B).toBe(candidates.length);
    // The harvested content never appears in a contribution (there are none).
    expect(JSON.stringify(audit.contributed)).not.toContain("gadget");
  }, 60_000);
});
