import { Semaphore } from "./semaphore.js";

export class BulkRefusedError extends Error {
  constructor() {
    super("bulk work is refused in profile mode by default (use isolated mode)");
    this.name = "BulkRefusedError";
  }
}

export class BudgetExhaustedError extends Error {
  constructor(public readonly budget: "maxPages" | "maxDownloadBytes") {
    super(`budget exhausted: ${budget}`);
    this.name = "BudgetExhaustedError";
  }
}

export interface SchedulerConfig {
  /** Global cap on concurrent tasks across ALL origins (never "unlimited"). */
  maxGlobalConcurrency: number;
  /** Per-origin concurrent loads (default 3; profile mode clamps to 1–2). */
  perOriginConcurrency: number;
  /** Profile mode (signed-in real browser): gentler pacing; bulk refused. */
  profileMode?: boolean;
}

/**
 * The two-level governor (INV-7). Every browser task runs through `run(origin, fn)`,
 * which acquires a GLOBAL permit AND a per-origin permit. Cross-origin parallelism is
 * bounded by the global governor — ten agents wanting one origin experience one queue.
 */
export class Scheduler {
  private readonly global: Semaphore;
  private readonly perOrigin = new Map<string, Semaphore>();

  constructor(private readonly config: SchedulerConfig) {
    this.global = new Semaphore(config.maxGlobalConcurrency);
  }

  private originLimit(): number {
    return this.config.profileMode ? Math.min(2, this.config.perOriginConcurrency) : this.config.perOriginConcurrency;
  }

  private originSem(origin: string): Semaphore {
    let sem = this.perOrigin.get(origin);
    if (!sem) {
      sem = new Semaphore(this.originLimit());
      this.perOrigin.set(origin, sem);
    }
    return sem;
  }

  async run<T>(origin: string, fn: () => Promise<T>): Promise<T> {
    await this.global.acquire();
    const origSem = this.originSem(origin);
    await origSem.acquire();
    try {
      return await fn();
    } finally {
      origSem.release();
      this.global.release();
    }
  }

  /** Bulk/high-volume runs default to isolated mode; refuse them in profile mode. */
  assertBulkAllowed(): void {
    if (this.config.profileMode) throw new BulkRefusedError();
  }

  snapshot(): { globalAvailable: number; globalWaiting: number } {
    return { globalAvailable: this.global.available, globalWaiting: this.global.waiting };
  }
}

/** Per-task resource budget from a TaskGrant (INV-7 / plan §8). */
export class TaskBudget {
  private pages = 0;
  private bytes = 0;

  constructor(private readonly limits: { maxPages?: number; maxDownloadBytes?: number }) {}

  chargePage(): void {
    this.pages += 1;
    if (this.limits.maxPages !== undefined && this.pages > this.limits.maxPages) {
      throw new BudgetExhaustedError("maxPages");
    }
  }

  chargeBytes(n: number): void {
    this.bytes += n;
    if (this.limits.maxDownloadBytes !== undefined && this.bytes > this.limits.maxDownloadBytes) {
      throw new BudgetExhaustedError("maxDownloadBytes");
    }
  }

  get spent(): { pages: number; bytes: number } {
    return { pages: this.pages, bytes: this.bytes };
  }
}

export interface BackoffOptions {
  retries: number;
  isRetryable: (err: unknown) => boolean;
  /** ms delay for a given zero-based attempt (default exponential, capped 1s). */
  delayMs?: (attempt: number) => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Exponential backoff for 429/503/Retry-After. Injectable sleep for deterministic tests. */
export async function withBackoff<T>(fn: () => Promise<T>, opts: BackoffOptions): Promise<T> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const delayMs = opts.delayMs ?? ((attempt: number) => Math.min(1000, 2 ** attempt * 50));
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= opts.retries || !opts.isRetryable(err)) throw err;
      await sleep(delayMs(attempt));
      attempt += 1;
    }
  }
}
