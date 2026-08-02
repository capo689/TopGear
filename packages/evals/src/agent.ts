import type { WorkflowSpec } from "./workflows.js";

/**
 * Scripted agents (INV-11). CI derives turn counts from DETERMINISTIC tool-call
 * sequences — the same mechanism the adversarial suites use — rather than from a
 * frontier-model API. Each agent below is a faithful stand-in for how that class of
 * tool actually operates:
 *   - screenshot-loop: one screenshot + one action per interactive unit (coordinate agent).
 *   - playwright-mcp:  one a11y snapshot, then one un-batched action per unit.
 *   - bridge:          attach (returns the first view as `initialView`), then one
 *                      verified batch. This is the approach under test.
 * Live model-driven runs through the host CLIs (Claude Code, Codex) are captured at M1;
 * these scripted turns are the model-independent baseline. NOTE: the first live dogfood
 * run measured bridge=3 for `form` because attach did NOT return a view — a real gap this
 * scripted model masked. attach now returns `initialView` (field-fix #3), restoring the
 * 2-turn path; the live re-measure is pending Ace's next run (BASELINES.md records both).
 */
export type AgentKind = "screenshot-loop" | "playwright-mcp" | "bridge";
export type ToolName = "attach" | "view" | "act" | "screenshot" | "fill_record" | "confirm";

export interface ToolCall {
  tool: ToolName;
  note?: string;
}

/** One model turn = one round trip that may carry a batch of tool calls. */
export interface AgentStep {
  toolCalls: ToolCall[];
}

export interface ScriptedAgent {
  kind: AgentKind;
  workflowId: string;
  steps: AgentStep[];
}

function screenshotLoopSteps(wf: WorkflowSpec): AgentStep[] {
  const steps: AgentStep[] = [];
  switch (wf.shape) {
    case "form":
      for (let i = 0; i < wf.interactiveUnits; i++) {
        steps.push({ toolCalls: [{ tool: "screenshot" }, { tool: "act", note: `fill unit ${i}` }] });
      }
      steps.push({ toolCalls: [{ tool: "screenshot" }, { tool: "act", note: "submit" }] });
      break;
    case "single-widget":
      steps.push({ toolCalls: [{ tool: "screenshot" }, { tool: "act", note: "open widget" }] });
      steps.push({ toolCalls: [{ tool: "screenshot" }, { tool: "act", note: "pick option" }] });
      break;
    case "read":
      steps.push({ toolCalls: [{ tool: "screenshot", note: "read" }] });
      break;
    case "expand-read":
      steps.push({ toolCalls: [{ tool: "screenshot" }, { tool: "act", note: "expand" }] });
      steps.push({ toolCalls: [{ tool: "screenshot", note: "read" }] });
      break;
    case "blocked-action":
      steps.push({ toolCalls: [{ tool: "screenshot" }, { tool: "act", note: "attempt high-risk" }] });
      steps.push({ toolCalls: [{ tool: "screenshot", note: "observe block" }] });
      break;
  }
  return steps;
}

function playwrightMcpSteps(wf: WorkflowSpec): AgentStep[] {
  const steps: AgentStep[] = [];
  switch (wf.shape) {
    case "form":
      steps.push({ toolCalls: [{ tool: "view", note: "a11y snapshot" }] });
      for (let i = 0; i < wf.interactiveUnits; i++) {
        steps.push({ toolCalls: [{ tool: "act", note: `fill unit ${i}` }] });
      }
      steps.push({ toolCalls: [{ tool: "act", note: "submit" }] });
      break;
    case "single-widget":
      steps.push({ toolCalls: [{ tool: "view", note: "a11y snapshot" }] });
      steps.push({ toolCalls: [{ tool: "act", note: "pick option" }] });
      break;
    case "read":
      steps.push({ toolCalls: [{ tool: "view", note: "a11y snapshot" }] });
      break;
    case "expand-read":
      steps.push({ toolCalls: [{ tool: "view", note: "a11y snapshot" }] });
      steps.push({ toolCalls: [{ tool: "act", note: "expand" }] });
      steps.push({ toolCalls: [{ tool: "view", note: "re-snapshot" }] });
      break;
    case "blocked-action":
      steps.push({ toolCalls: [{ tool: "view", note: "a11y snapshot" }] });
      steps.push({ toolCalls: [{ tool: "act", note: "attempt high-risk" }] });
      break;
  }
  return steps;
}

function bridgeSteps(wf: WorkflowSpec): AgentStep[] {
  switch (wf.shape) {
    case "form":
      return [
        { toolCalls: [{ tool: "attach", note: "binds grant, returns initialView" }] },
        { toolCalls: [{ tool: "act", note: "one batch: fill every field, embedded waits, submit" }] },
      ];
    case "single-widget":
      return [
        { toolCalls: [{ tool: "attach" }] },
        { toolCalls: [{ tool: "act", note: "select primitive" }] },
      ];
    case "read":
      return [{ toolCalls: [{ tool: "attach", note: "initial view is the read (hidden-content included)" }] }];
    case "expand-read":
      return [
        { toolCalls: [{ tool: "attach" }] },
        { toolCalls: [{ tool: "act", note: "expand; batch re-capture returns the loaded content" }] },
      ];
    case "blocked-action":
      return [
        { toolCalls: [{ tool: "attach" }] },
        { toolCalls: [{ tool: "act", note: "attempt → interruption carries daemon-built confirmation" }] },
      ];
  }
}

export function scriptAgent(kind: AgentKind, wf: WorkflowSpec): ScriptedAgent {
  const steps =
    kind === "screenshot-loop"
      ? screenshotLoopSteps(wf)
      : kind === "playwright-mcp"
        ? playwrightMcpSteps(wf)
        : bridgeSteps(wf);
  return { kind, workflowId: wf.id, steps };
}

export const AGENT_KINDS: readonly AgentKind[] = ["screenshot-loop", "playwright-mcp", "bridge"];
