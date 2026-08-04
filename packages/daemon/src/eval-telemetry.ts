import { appendFileSync } from "node:fs";

/**
 * One raw per-call telemetry event for the live-tier eval recorder. The daemon is the only
 * component in-process during a live model run, so it is the only thing that can ground-truth
 * turns, page-load, and accuracy. Enabled ONLY when BB_EVAL_LOG is set — off by default, never
 * on the normal path (INV-4: no user content, only structural counters).
 *
 * `runIndex` and `targetUrl` are per-RUN and supplied by the daemon at record time (it starts a
 * new run on each attach). They are NOT read from a frozen env — under an MCPB install the
 * daemon process outlives every run in a round, so a construction-time BB_EVAL_RUN would stamp
 * every event with runIndex 0 and silently merge all runs into one. `workflow` (a label) is the
 * only thing carried from env.
 */
export interface EvalEvent {
  ts: number;
  workflow: string;
  arm: string;
  runIndex: number;
  targetUrl: string;
  sessionId: string;
  tool: string; // "attach" | "view" | "act"
  wallMs: number;
  pageLoadMs: number;
  fieldsAttempted: number;
  fieldsVerified: number;
  interrupted: boolean;
  status: string;
}

/** Fields the daemon supplies per event; run identity (runIndex/targetUrl) is per-run. */
export type EvalRecordInput = Omit<EvalEvent, "ts" | "workflow" | "arm">;

/** Best-effort JSONL sink. Never throws into the run. */
export class EvalTelemetry {
  static fromEnv(env: NodeJS.ProcessEnv = process.env): EvalTelemetry | undefined {
    if (!env.BB_EVAL_LOG) return undefined;
    let workflow = "unknown";
    let arm = "bridge";
    try {
      const meta = env.BB_EVAL_RUN ? (JSON.parse(env.BB_EVAL_RUN) as { workflow?: string; arm?: string }) : {};
      if (meta.workflow) workflow = meta.workflow;
      if (meta.arm) arm = meta.arm;
    } catch {
      /* malformed metadata → defaults */
    }
    return new EvalTelemetry(env.BB_EVAL_LOG, workflow, arm);
  }

  constructor(
    private readonly path: string,
    private readonly workflow: string,
    private readonly arm: string,
  ) {}

  record(e: EvalRecordInput): void {
    const full: EvalEvent = { ts: Date.now(), workflow: this.workflow, arm: this.arm, ...e };
    try {
      appendFileSync(this.path, JSON.stringify(full) + "\n");
    } catch {
      /* telemetry must never break the run */
    }
  }
}
