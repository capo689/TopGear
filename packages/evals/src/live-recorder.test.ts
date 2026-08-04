import { describe, it, expect } from "vitest";
import { parseEventsJsonl, aggregateRuns, summarizeRuns, type LiveRunEvent } from "./live-recorder.js";

function ev(p: Partial<LiveRunEvent>): LiveRunEvent {
  return {
    ts: 0, workflow: "wf", arm: "bridge", runIndex: 0, targetUrl: "https://x", sessionId: "s",
    tool: "act", wallMs: 0, pageLoadMs: 0, fieldsAttempted: 0, fieldsVerified: 0, interrupted: false, status: "completed",
    ...p,
  };
}

describe("live-recorder", () => {
  it("aggregates per-call events into one record per (workflow, arm, runIndex)", () => {
    const events = [
      ev({ tool: "attach", ts: 1, wallMs: 100, pageLoadMs: 80, status: "attached" }),
      ev({ tool: "act", ts: 2, wallMs: 300, pageLoadMs: 20, fieldsAttempted: 30, fieldsVerified: 30 }),
      ev({ tool: "act", ts: 3, wallMs: 90, pageLoadMs: 40, fieldsAttempted: 4, fieldsVerified: 4, status: "completed" }),
    ];
    const [r] = aggregateRuns(events);
    expect(r!.modelTurns).toBe(3); // attach + 2 acts
    expect(r!.wallClockMs).toBe(490);
    expect(r!.pageLoadMs).toBe(140);
    expect(r!.wallMinusPageLoadMs).toBe(350);
    expect(r!.fieldsAttempted).toBe(34);
    expect(r!.fieldsVerified).toBe(34);
    expect(r!.gatesFired).toBe(0);
    expect(r!.terminalStatus).toBe("completed");
  });

  it("counts gates/interruptions and reports the terminal status", () => {
    const [r] = aggregateRuns([
      ev({ tool: "attach", ts: 1 }),
      ev({ tool: "act", ts: 2, interrupted: true, status: "interrupted" }),
    ]);
    expect(r!.gatesFired).toBe(1);
    expect(r!.terminalStatus).toBe("interrupted");
  });

  it("separates arms and runs, and the summary shows a turn ratio vs baseline", () => {
    const events = [
      // baseline arm: 22 turns worth (one event per turn), bridge arm: 2 turns
      ...Array.from({ length: 22 }, (_, i) => ev({ arm: "baseline", runIndex: 0, ts: i, tool: "act", fieldsVerified: 1, fieldsAttempted: 1 })),
      ev({ arm: "bridge", runIndex: 0, ts: 0, tool: "attach", fieldsVerified: 0 }),
      ev({ arm: "bridge", runIndex: 0, ts: 1, tool: "act", fieldsAttempted: 22, fieldsVerified: 22 }),
    ];
    const runs = aggregateRuns(events);
    expect(runs.find((r) => r.arm === "baseline")!.modelTurns).toBe(22);
    expect(runs.find((r) => r.arm === "bridge")!.modelTurns).toBe(2);
    const table = summarizeRuns(runs);
    expect(table).toContain("| wf | baseline |");
    expect(table).toContain("| wf | bridge |");
    expect(table).toContain("11.0×"); // 22 baseline / 2 bridge
  });

  it("parses JSONL and skips garbled lines", () => {
    const text = JSON.stringify(ev({})) + "\n\n{not json\n" + JSON.stringify(ev({ tool: "view" }));
    expect(parseEventsJsonl(text)).toHaveLength(2);
  });
});
