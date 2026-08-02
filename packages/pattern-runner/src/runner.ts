import type { BrowserBackend } from "@browser-bridge/backend";
import { Scheduler, TaskBudget, BudgetExhaustedError } from "@browser-bridge/scheduler";
import type { HarvestStore } from "@browser-bridge/harvest-store";
import { CrawlPolicy } from "./crawl.js";

export interface PatternRunnerDeps {
  backend: BrowserBackend;
  scheduler: Scheduler;
  store: HarvestStore;
  crawl: CrawlPolicy;
  budget: TaskBudget;
  now?: () => number;
}

export interface RunPatternRequest {
  urls: string[];
}

export interface RunPatternResult {
  requested: number;
  harvested: number;
  deduped: number;
  /** Policy/budget refusals — surfaced, never silently dropped. */
  skipped: { url: string; reason: string }[];
  /** Drift / errors — surfaced as exceptions so the model recovers in one turn. */
  exceptions: { url: string; error: string }[];
}

/**
 * The pattern runner (plan §8). The model defines the extraction on the first page; the
 * daemon runs the loop at network speed through the scheduler (bounded parallelism).
 * Capture ≠ comprehension: harvested content goes to the store (Class A), queried later.
 * Misses surface as exceptions with the URL — one extra turn to recover.
 */
export class PatternRunner {
  constructor(private readonly deps: PatternRunnerDeps) {}

  async run(req: RunPatternRequest): Promise<RunPatternResult> {
    const result: RunPatternResult = {
      requested: req.urls.length,
      harvested: 0,
      deduped: 0,
      skipped: [],
      exceptions: [],
    };
    await Promise.all(req.urls.map((url) => this.harvestOne(url, result)));
    return result;
  }

  private async harvestOne(url: string, result: RunPatternResult): Promise<void> {
    const decision = this.deps.crawl.check(url);
    if (!decision.allowed) {
      result.skipped.push({ url, reason: decision.reason });
      return;
    }
    let origin: string;
    try {
      origin = new URL(url).origin;
    } catch {
      result.skipped.push({ url, reason: "invalid_url" });
      return;
    }
    const now = this.deps.now ?? (() => Date.now());
    try {
      await this.deps.scheduler.run(origin, async () => {
        this.deps.budget.chargePage(); // throws BudgetExhaustedError when over
        const page = await this.deps.backend.attach(url);
        try {
          const raw = await page.captureRaw({ scope: { kind: "content" }, refPrefix: "h-" });
          const text = (raw.content ?? []).map((c) => c.text).join("\n");
          const add = this.deps.store.add({ url, text, title: raw.title, harvestedAt: now() });
          if (add.deduped) result.deduped += 1;
          else result.harvested += 1;
        } finally {
          await page.close();
        }
      });
    } catch (err) {
      if (err instanceof BudgetExhaustedError) result.skipped.push({ url, reason: "budget_exhausted" });
      else result.exceptions.push({ url, error: String(err) });
    }
  }
}
