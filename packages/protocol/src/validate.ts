import type { Action } from "./action.js";
import { PROTOCOL_CAPS, type CapViolationCode } from "./caps.js";

export interface CapCheckOk {
  ok: true;
  /** Total actions after expanding every `if.then` / `if.else`. */
  expandedCount: number;
  /** Deepest `if` nesting in the batch (0 = no conditionals). */
  maxIfDepth: number;
}

export interface CapCheckErr {
  ok: false;
  code: CapViolationCode;
  /** A teaching error message: what was found, what the limit is. */
  message: string;
  found: number;
  limit: number;
}

export type CapCheckResult = CapCheckOk | CapCheckErr;

function walk(actions: Action[]): { count: number; depth: number } {
  let count = 0;
  let depth = 0;
  for (const action of actions) {
    count += 1;
    if (action.op === "if") {
      const thenWalk = walk(action.then);
      const elseWalk = action.else ? walk(action.else) : { count: 0, depth: 0 };
      count += thenWalk.count + elseWalk.count;
      depth = Math.max(depth, 1 + Math.max(thenWalk.depth, elseWalk.depth));
    }
  }
  return { count, depth };
}

/**
 * Enforce the protocol batch caps (plan §4.1) with teaching errors. The daemon calls
 * this before executing any batch; caps are rejected, never silently truncated.
 */
export function checkBatchCaps(actions: Action[]): CapCheckResult {
  if (actions.length > PROTOCOL_CAPS.maxActionsPerBatch) {
    return {
      ok: false,
      code: "too_many_actions",
      message: `Batch has ${actions.length} top-level actions; the limit is ${PROTOCOL_CAPS.maxActionsPerBatch}. Split it into multiple batches.`,
      found: actions.length,
      limit: PROTOCOL_CAPS.maxActionsPerBatch,
    };
  }

  const { count, depth } = walk(actions);

  if (depth > PROTOCOL_CAPS.maxIfDepth) {
    return {
      ok: false,
      code: "if_depth_exceeded",
      message: `\`if\` nesting is ${depth} deep; the limit is ${PROTOCOL_CAPS.maxIfDepth}. \`if\` is a conditional, not a scripting language — flatten the logic.`,
      found: depth,
      limit: PROTOCOL_CAPS.maxIfDepth,
    };
  }

  if (count > PROTOCOL_CAPS.maxExpandedActions) {
    return {
      ok: false,
      code: "too_many_expanded_actions",
      message: `Batch expands to ${count} actions; the limit is ${PROTOCOL_CAPS.maxExpandedActions}. Reduce the number of branched actions.`,
      found: count,
      limit: PROTOCOL_CAPS.maxExpandedActions,
    };
  }

  return { ok: true, expandedCount: count, maxIfDepth: depth };
}

/** Byte-size cap check for responses/payloads (plan §4.1). */
export function checkByteCap(
  kind: "payload" | "screenshot" | "view",
  bytes: number,
): CapCheckResult {
  const limit =
    kind === "payload"
      ? PROTOCOL_CAPS.maxRequestPayloadBytes
      : kind === "screenshot"
        ? PROTOCOL_CAPS.maxScreenshotResponseBytes
        : PROTOCOL_CAPS.maxViewResponseBytes;
  const code: CapViolationCode =
    kind === "payload" ? "payload_too_large" : kind === "screenshot" ? "screenshot_too_large" : "view_too_large";
  if (bytes > limit) {
    return {
      ok: false,
      code,
      message: `${kind} is ${bytes} bytes; the limit is ${limit}.`,
      found: bytes,
      limit,
    };
  }
  return { ok: true, expandedCount: 0, maxIfDepth: 0 };
}
