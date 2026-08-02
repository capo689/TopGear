import { describe, it, expect } from "vitest";
import { Scheduler, TaskBudget, BudgetExhaustedError, BulkRefusedError, withBackoff } from "./scheduler.js";
import { Semaphore } from "./semaphore.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function peakTracker() {
  let active = 0;
  let peak = 0;
  const task = () => async () => {
    active += 1;
    peak = Math.max(peak, active);
    await sleep(5);
    active -= 1;
  };
  return { task, peak: () => peak };
}

describe("Semaphore", () => {
  it("bounds concurrency to its permit count", async () => {
    const sem = new Semaphore(2);
    const { task, peak } = peakTracker();
    await Promise.all(
      Array.from({ length: 20 }, () => (async () => {
        await sem.acquire();
        try {
          await task()();
        } finally {
          sem.release();
        }
      })()),
    );
    expect(peak()).toBeLessThanOrEqual(2);
  });
});

describe("Scheduler — global governor (runaway agent)", () => {
  it("holds a global ceiling even when 100 distinct origins are hammered at once", async () => {
    const sched = new Scheduler({ maxGlobalConcurrency: 6, perOriginConcurrency: 3 });
    const { task, peak } = peakTracker();
    await Promise.all(Array.from({ length: 100 }, (_, i) => sched.run(`https://o${i}.example`, task())));
    expect(peak()).toBeLessThanOrEqual(6);
    expect(peak()).toBeGreaterThan(1); // genuinely parallel, just bounded
  });
});

describe("Scheduler — per-origin governor (competing agents)", () => {
  it("caps per-origin concurrency under 10 competing tasks on one origin", async () => {
    const sched = new Scheduler({ maxGlobalConcurrency: 50, perOriginConcurrency: 3 });
    const { task, peak } = peakTracker();
    await Promise.all(Array.from({ length: 10 }, () => sched.run("https://one.example", task())));
    expect(peak()).toBeLessThanOrEqual(3);
  });
});

describe("Scheduler — profile mode", () => {
  it("clamps per-origin concurrency to <= 2 and refuses bulk", async () => {
    const sched = new Scheduler({ maxGlobalConcurrency: 50, perOriginConcurrency: 5, profileMode: true });
    const { task, peak } = peakTracker();
    await Promise.all(Array.from({ length: 8 }, () => sched.run("https://one.example", task())));
    expect(peak()).toBeLessThanOrEqual(2);
    expect(() => sched.assertBulkAllowed()).toThrow(BulkRefusedError);
  });
});

describe("TaskBudget", () => {
  it("enforces maxPages", () => {
    const budget = new TaskBudget({ maxPages: 3 });
    budget.chargePage();
    budget.chargePage();
    budget.chargePage();
    expect(() => budget.chargePage()).toThrow(BudgetExhaustedError);
    expect(budget.spent.pages).toBe(4);
  });

  it("enforces maxDownloadBytes", () => {
    const budget = new TaskBudget({ maxDownloadBytes: 100 });
    budget.chargeBytes(80);
    expect(() => budget.chargeBytes(30)).toThrow(BudgetExhaustedError);
  });
});

describe("withBackoff", () => {
  it("retries a retryable error then succeeds", async () => {
    let calls = 0;
    const result = await withBackoff(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error("503");
        return "ok";
      },
      { retries: 5, isRetryable: (e) => String(e).includes("503"), sleep: async () => {} },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("does not retry a non-retryable error", async () => {
    let calls = 0;
    await expect(
      withBackoff(
        async () => {
          calls += 1;
          throw new Error("400");
        },
        { retries: 5, isRetryable: (e) => String(e).includes("503"), sleep: async () => {} },
      ),
    ).rejects.toThrow("400");
    expect(calls).toBe(1);
  });
});
