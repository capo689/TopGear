import { describe, it, expect } from "vitest";
import { AuditLogger, MemorySink, newCorrelationId, type AuditLogInput } from "./audit.js";

function loggerWithClock(ts = 1_000) {
  const sink = new MemorySink();
  const logger = new AuditLogger(sink, { now: () => ts });
  return { sink, logger };
}

describe("AuditLogger", () => {
  it("writes a structured record with a timestamp and correlation id", () => {
    const { sink, logger } = loggerWithClock(1234);
    logger.log({ correlationId: "corr-1", kind: "action", op: "click", targetLabel: "Submit", outcome: "verified" });
    expect(sink.events).toHaveLength(1);
    const e = sink.events[0]!;
    expect(e.ts).toBe(1234);
    expect(e.correlationId).toBe("corr-1");
    expect(e.op).toBe("click");
    expect(e.outcome).toBe("verified");
  });

  it("STRIPS any stray value field so a secret can never reach the sink", () => {
    const { sink, logger } = loggerWithClock();
    const leaky = {
      correlationId: "corr-2",
      kind: "action",
      op: "fill",
      value: "hunter2-super-secret", // not on the allowlist
    } as unknown as AuditLogInput;
    logger.log(leaky);
    const line = sink.lines[0]!;
    expect(line).not.toContain("hunter2-super-secret");
    expect(JSON.parse(line)).not.toHaveProperty("value");
  });

  it("scrubs secret-shaped free text in the note field", () => {
    const { sink, logger } = loggerWithClock();
    logger.log({
      correlationId: "corr-3",
      kind: "system",
      note: "retrying with password=hunter2 and token=A1b2C3d4E5f6G7h8I9j0K1l2",
    });
    const line = sink.lines[0]!;
    expect(line).not.toContain("hunter2");
    expect(line).not.toContain("A1b2C3d4E5f6G7h8I9j0K1l2");
  });

  it("preserves daemon reason codes for the confirm UI / audit trail", () => {
    const { sink, logger } = loggerWithClock();
    logger.log({
      correlationId: "corr-4",
      kind: "decision",
      op: "click",
      outcome: "deny",
      code: "capability_revision_mismatch",
      reasons: ["third_party_submit"],
      failureReason: "capability_invalid",
    });
    const e = sink.events[0]!;
    expect(e.code).toBe("capability_revision_mismatch");
    expect(e.reasons).toEqual(["third_party_submit"]);
    expect(e.failureReason).toBe("capability_invalid");
  });

  it("threads a correlation id through a bound child logger", () => {
    const { sink, logger } = loggerWithClock();
    const cid = newCorrelationId();
    const child = logger.child(cid);
    child.log({ kind: "action", op: "scroll", outcome: "verified" });
    child.log({ kind: "action", op: "click", outcome: "verified" });
    expect(sink.events.every((e) => e.correlationId === cid)).toBe(true);
    expect(sink.events).toHaveLength(2);
  });
});
