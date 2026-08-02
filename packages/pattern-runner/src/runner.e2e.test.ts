import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startFixtureFarm, type FixtureFarm } from "@browser-bridge/fixture-farm";
import { createPlaywrightBackend } from "@browser-bridge/browser-playwright";
import { Scheduler, TaskBudget } from "@browser-bridge/scheduler";
import { InMemoryHarvestStore } from "@browser-bridge/harvest-store";
import type { BrowserBackend } from "@browser-bridge/backend";
import { PatternRunner, CrawlPolicy, parseRobots } from "./index.js";

let farm: FixtureFarm;
let backend: BrowserBackend;
let origin: string;
let robots: ReturnType<typeof parseRobots>;

beforeAll(async () => {
  farm = await startFixtureFarm();
  backend = await createPlaywrightBackend({ headless: true, isolated: true });
  origin = new URL(farm.url).origin;
  robots = parseRobots(await (await fetch(farm.url + "/robots.txt")).text());
}, 60_000);

afterAll(async () => {
  await backend?.shutdown();
  await farm?.close();
});

function runner(store: InMemoryHarvestStore, budget: TaskBudget, allowedOrigins = [origin]) {
  return new PatternRunner({
    backend,
    scheduler: new Scheduler({ maxGlobalConcurrency: 3, perOriginConcurrency: 3 }),
    store,
    crawl: new CrawlPolicy({ allowedOrigins, robots }),
    budget,
  });
}

describe("PatternRunner — 50-page harvest (plan §8)", () => {
  it("harvests 50 pages in one run through the scheduler, then is queryable", async () => {
    const store = new InMemoryHarvestStore();
    const urls = Array.from({ length: 50 }, (_, i) => `${farm.url}/harvest/${i + 1}`);
    const result = await runner(store, new TaskBudget({ maxPages: 200 })).run({ urls });

    expect(result.harvested).toBe(50);
    expect(result.exceptions).toHaveLength(0);
    expect(store.count()).toBe(50);
    // Capture ≠ comprehension: the corpus is queried afterward.
    expect(store.search("gadget").length).toBeGreaterThan(0);
    expect(store.exportChunks(20)).toHaveLength(3);
  }, 90_000);

  it("honors robots (skips the disallowed page) and refuses out-of-grant origins", async () => {
    const store = new InMemoryHarvestStore();
    const urls = [`${farm.url}/harvest/1`, `${farm.url}/harvest/secret`, "https://not-granted.example/x"];
    const result = await runner(store, new TaskBudget({ maxPages: 50 })).run({ urls });

    expect(result.harvested).toBe(1);
    expect(result.skipped.find((s) => s.url.endsWith("/harvest/secret"))?.reason).toBe("robots_disallow");
    expect(result.skipped.find((s) => s.url.startsWith("https://not-granted"))?.reason).toBe("origin_not_in_grant");
  }, 30_000);

  it("stops harvesting when the page budget is exhausted", async () => {
    const store = new InMemoryHarvestStore();
    const urls = Array.from({ length: 20 }, (_, i) => `${farm.url}/harvest/${i + 1}`);
    const result = await runner(store, new TaskBudget({ maxPages: 8 })).run({ urls });

    expect(result.harvested).toBeLessThanOrEqual(8);
    expect(result.skipped.some((s) => s.reason === "budget_exhausted")).toBe(true);
  }, 30_000);

  it("surfaces drift as exceptions (recoverable in one turn)", async () => {
    const store = new InMemoryHarvestStore();
    const dead = "http://127.0.0.1:1/harvest/1"; // connection refused
    const urls = [`${farm.url}/harvest/1`, dead, `${farm.url}/harvest/2`];
    const result = await runner(store, new TaskBudget({ maxPages: 50 }), [origin, "http://127.0.0.1:1"]).run({ urls });

    expect(result.harvested).toBe(2);
    expect(result.exceptions.some((e) => e.url === dead)).toBe(true);
  }, 30_000);
});
