import { describe, it, expect } from "vitest";
import { scriptAgent } from "./agent.js";
import { runScripted, turnRatio, baselineMatrix } from "./harness.js";
import { WORKFLOWS, workflowById } from "./workflows.js";

describe("scripted turn measurement", () => {
  it("measures the headline 20-field form: bridge batches, baselines loop", () => {
    const form = workflowById("fill-native-form")!;
    const screenshot = runScripted(scriptAgent("screenshot-loop", form));
    const mcp = runScripted(scriptAgent("playwright-mcp", form));
    const bridge = runScripted(scriptAgent("bridge", form));

    expect(screenshot.turns).toBe(21); // 20 screenshot+fill + 1 submit
    expect(mcp.turns).toBe(22); // 1 snapshot + 20 fills + 1 submit
    expect(bridge.turns).toBe(2); // attach + one verified batch

    // bridge folds many tool calls into few turns.
    expect(bridge.toolCalls).toBeLessThan(screenshot.toolCalls);
  });

  it("beats both baselines >= 3x on the 20-field form (the M1 turn target)", () => {
    const form = workflowById("fill-native-form")!;
    const bridge = runScripted(scriptAgent("bridge", form)).turns;
    const screenshot = runScripted(scriptAgent("screenshot-loop", form)).turns;
    const mcp = runScripted(scriptAgent("playwright-mcp", form)).turns;
    expect(turnRatio(screenshot, bridge)).toBeGreaterThanOrEqual(3);
    expect(turnRatio(mcp, bridge)).toBeGreaterThanOrEqual(3);
  });

  it("never makes the bridge worse than a baseline on any workflow", () => {
    for (const wf of WORKFLOWS) {
      const bridge = runScripted(scriptAgent("bridge", wf)).turns;
      const screenshot = runScripted(scriptAgent("screenshot-loop", wf)).turns;
      const mcp = runScripted(scriptAgent("playwright-mcp", wf)).turns;
      expect(bridge, `bridge <= screenshot on ${wf.id}`).toBeLessThanOrEqual(screenshot);
      expect(bridge, `bridge <= mcp on ${wf.id}`).toBeLessThanOrEqual(mcp);
    }
  });
});

describe("baselineMatrix", () => {
  it("covers all 8 standard workflows", () => {
    expect(baselineMatrix()).toHaveLength(8);
  });

  it("records the 20-field ratio at roughly 10x", () => {
    const row = baselineMatrix().find((r) => r.workflowId === "fill-native-form")!;
    expect(row.ratioVsScreenshotLoop).toBeGreaterThanOrEqual(10);
  });
});
