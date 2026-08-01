import type { ScriptedAgent, AgentKind } from "./agent.js";
import { scriptAgent, AGENT_KINDS } from "./agent.js";
import { WORKFLOWS, type WorkflowSpec } from "./workflows.js";

export interface RunResult {
  kind: AgentKind;
  workflowId: string;
  /** model_turns_per_task, measured as the number of steps the agent takes. */
  turns: number;
  /** Total tool calls across all turns (batching folds many calls into few turns). */
  toolCalls: number;
}

/** Run a scripted agent and measure its turns and tool calls. */
export function runScripted(agent: ScriptedAgent): RunResult {
  return {
    kind: agent.kind,
    workflowId: agent.workflowId,
    turns: agent.steps.length,
    toolCalls: agent.steps.reduce((n, s) => n + s.toolCalls.length, 0),
  };
}

/** Turn-reduction ratio of a candidate against a baseline (higher is better). */
export function turnRatio(baselineTurns: number, candidateTurns: number): number {
  return baselineTurns / candidateTurns;
}

export interface WorkflowBaseline {
  workflowId: string;
  title: string;
  shape: WorkflowSpec["shape"];
  interactiveUnits: number;
  turns: Record<AgentKind, number>;
  /** bridge turn-reduction vs each baseline agent. */
  ratioVsScreenshotLoop: number;
  ratioVsPlaywrightMcp: number;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Compute the full baseline matrix across all workflows and agents. */
export function baselineMatrix(): WorkflowBaseline[] {
  return WORKFLOWS.map((wf) => {
    const turns = Object.fromEntries(
      AGENT_KINDS.map((k) => [k, runScripted(scriptAgent(k, wf)).turns]),
    ) as Record<AgentKind, number>;
    return {
      workflowId: wf.id,
      title: wf.title,
      shape: wf.shape,
      interactiveUnits: wf.interactiveUnits,
      turns,
      ratioVsScreenshotLoop: round(turnRatio(turns["screenshot-loop"], turns.bridge)),
      ratioVsPlaywrightMcp: round(turnRatio(turns["playwright-mcp"], turns.bridge)),
    };
  });
}
