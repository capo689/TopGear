import { z } from "zod";
import { randomUUID } from "node:crypto";
import { scrubText } from "./redact.js";

/** The category of an audit record. */
export const AuditKind = z.enum(["action", "decision", "reflex", "interruption", "system"]);
export type AuditKind = z.infer<typeof AuditKind>;

/** The outcome recorded for an event. */
export const AuditOutcome = z.enum([
  "verified",
  "failed",
  "skipped",
  "allow",
  "deny",
  "needs_confirmation",
  "surface",
  "dismiss",
]);
export type AuditOutcome = z.infer<typeof AuditOutcome>;

/**
 * The complete, closed shape of an audit record (T7). Notably absent: any `value`,
 * secret, cookie, URL query string, or raw page content. Unknown keys are STRIPPED on
 * parse — a stray value field can never reach the sink.
 */
export const AuditEvent = z.object({
  ts: z.number().int(),
  correlationId: z.string().min(1),
  kind: AuditKind,
  op: z.string().optional(),
  targetLabel: z.string().optional(),
  origin: z.string().optional(),
  outcome: AuditOutcome.optional(),
  code: z.string().optional(),
  reasons: z.array(z.string()).optional(),
  failureReason: z.string().optional(),
  note: z.string().optional(),
});
export type AuditEvent = z.infer<typeof AuditEvent>;

export interface AuditClock {
  now(): number;
}
const systemClock: AuditClock = { now: () => Date.now() };

/** Correlation id threads a request → audit → telemetry (plan §4.1). */
export function newCorrelationId(): string {
  return randomUUID();
}

export interface AuditSink {
  write(line: string): void;
}

/** In-memory sink for tests and the inspector-ui. */
export class MemorySink implements AuditSink {
  readonly lines: string[] = [];
  write(line: string): void {
    this.lines.push(line);
  }
  get events(): AuditEvent[] {
    return this.lines.map((l) => JSON.parse(l) as AuditEvent);
  }
}

export const stdoutSink: AuditSink = {
  write: (line) => {
    process.stdout.write(line + "\n");
  },
};

export interface AuditLogInput {
  correlationId: string;
  kind: AuditKind;
  op?: string;
  targetLabel?: string;
  origin?: string;
  outcome?: AuditOutcome;
  code?: string;
  reasons?: string[];
  failureReason?: string;
  note?: string;
  ts?: number;
}

function sanitize(input: AuditLogInput & { ts: number }): Record<string, unknown> {
  const out: Record<string, unknown> = { ...input };
  if (typeof out.note === "string") out.note = scrubText(out.note);
  if (typeof out.targetLabel === "string") out.targetLabel = scrubText(out.targetLabel);
  return out;
}

/**
 * Emits redacted, structured audit records. Two layers of protection: free text is
 * scrubbed for secret shapes, then the whole record is parsed through the closed
 * `AuditEvent` schema which strips any field not on the allowlist.
 */
export class AuditLogger {
  constructor(
    private readonly sink: AuditSink,
    private readonly clock: AuditClock = systemClock,
  ) {}

  log(input: AuditLogInput): AuditEvent {
    const withTs = { ...input, ts: input.ts ?? this.clock.now() };
    const event = AuditEvent.parse(sanitize(withTs));
    this.sink.write(JSON.stringify(event));
    return event;
  }

  /** Bind a correlation id so a run of related events share one thread. */
  child(correlationId: string): BoundAuditLogger {
    return new BoundAuditLogger(this, correlationId);
  }
}

export class BoundAuditLogger {
  constructor(
    private readonly parent: AuditLogger,
    private readonly correlationId: string,
  ) {}

  log(input: Omit<AuditLogInput, "correlationId">): AuditEvent {
    return this.parent.log({ ...input, correlationId: this.correlationId });
  }
}
