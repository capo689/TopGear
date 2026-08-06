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
  tool: string; // "attach" | "view" | "act" | "fill_record"
  wallMs: number;
  pageLoadMs: number;
  fieldsAttempted: number;
  fieldsVerified: number;
  interrupted: boolean;
  status: string;
}

/** Fields the daemon supplies per event; run identity (runIndex/targetUrl) is per-run. */
export type EvalRecordInput = Omit<EvalEvent, "ts" | "workflow" | "arm">;

/**
 * D5: a one-line startup statement of whether telemetry is on, and WHY it is off.
 *
 * Updating an .mcpb wipes `user_config`, so `eval_log_path` reverts to unset and telemetry
 * goes off with no signal at all — a whole benchmark evening was lost to that once. The state
 * is now announced at startup instead of being inferred later from an empty JSONL. Emits the
 * path only, never contents (INV-4).
 */
export function telemetryStatusMessage(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env.BB_EVAL_LOG ?? "").trim();
  if (!raw) {
    return "browser-bridge: eval telemetry OFF (BB_EVAL_LOG unset). If you set it before, an extension UPDATE clears user_config — re-enter the eval log path in the extension's settings.";
  }
  if (raw.includes("${")) {
    return `browser-bridge: eval telemetry OFF — BB_EVAL_LOG arrived unsubstituted (${raw}). The host did not fill in user_config; set the eval log path in the extension's settings.`;
  }
  return `browser-bridge: eval telemetry ON → ${raw}`;
}

/** Best-effort JSONL sink. Never throws into the run. */
export class EvalTelemetry {
  static fromEnv(env: NodeJS.ProcessEnv = process.env): EvalTelemetry | undefined {
    const logPath = (env.BB_EVAL_LOG ?? "").trim();
    // Disabled when empty. Also treat a still-literal placeholder ("${user_config...}") as
    // empty — the MCPB spec doesn't document how an unset optional string renders, so if the
    // host leaves it unsubstituted we must NOT try to write to that path.
    if (!logPath || logPath.includes("${")) return undefined;
    let workflow = "unknown";
    let arm = "bridge";
    try {
      const meta = env.BB_EVAL_RUN ? (JSON.parse(env.BB_EVAL_RUN) as { workflow?: string; arm?: string }) : {};
      if (meta.workflow) workflow = meta.workflow;
      if (meta.arm) arm = meta.arm;
    } catch {
      /* malformed metadata → defaults */
    }
    return new EvalTelemetry(logPath, workflow, arm);
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
