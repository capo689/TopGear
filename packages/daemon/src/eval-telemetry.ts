import { appendFileSync } from "node:fs";

/**
 * One raw per-call telemetry event for the live-tier eval recorder. The daemon is the only
 * component in-process during a live model run, so it is the only thing that can ground-truth
 * turns, page-load, and accuracy. Enabled ONLY when BB_EVAL_LOG is set — off by default, never
 * on the normal path (INV-4: no user content, only structural counters).
 */
export interface EvalEvent {
  ts: number;
  workflow: string;
  arm: string;
  runIndex: number;
  targetUrl: string;
  sessionId: string;
  tool: string; // "attach" | "view" | "act"
  wallMs: number; // daemon-side processing time for this call
  pageLoadMs: number; // navigation settle within this call
  fieldsAttempted: number;
  fieldsVerified: number;
  interrupted: boolean;
  status: string;
}

type RunMeta = { workflow?: string; arm?: string; runIndex?: number; targetUrl?: string };

/** Best-effort JSONL sink. Reads run metadata from BB_EVAL_RUN. Never throws into the run. */
export class EvalTelemetry {
  static fromEnv(env: NodeJS.ProcessEnv = process.env): EvalTelemetry | undefined {
    if (!env.BB_EVAL_LOG) return undefined;
    let meta: RunMeta = {};
    try {
      meta = env.BB_EVAL_RUN ? (JSON.parse(env.BB_EVAL_RUN) as RunMeta) : {};
    } catch {
      /* malformed metadata → defaults */
    }
    return new EvalTelemetry(env.BB_EVAL_LOG, meta);
  }

  constructor(
    private readonly path: string,
    private readonly meta: RunMeta,
  ) {}

  record(e: Omit<EvalEvent, "ts" | "workflow" | "arm" | "runIndex" | "targetUrl">): void {
    const full: EvalEvent = {
      ts: Date.now(),
      workflow: this.meta.workflow ?? "unknown",
      arm: this.meta.arm ?? "bridge",
      runIndex: this.meta.runIndex ?? 0,
      targetUrl: this.meta.targetUrl ?? "",
      ...e,
    };
    try {
      appendFileSync(this.path, JSON.stringify(full) + "\n");
    } catch {
      /* telemetry must never break the run */
    }
  }
}
