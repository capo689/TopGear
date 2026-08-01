import type { Action, NormalizedAction } from "@browser-bridge/protocol";

/**
 * Daemon-supplied, page-derived context for normalization. Every field here comes from
 * the DAEMON's observation of the page — never from model-supplied strings (INV-9).
 */
export interface NormalizeContext {
  origin: string;
  /** Daemon-derived accessible name of the target control. */
  targetLabel?: string;
  /** Resolved destination (form action URL) when the action transmits. */
  formAction?: string;
}

function verbFor(op: Action["op"]): string {
  switch (op) {
    case "click":
      return "Activate";
    case "upload":
      return "Upload a file via";
    case "goto":
      return "Navigate to";
    case "select":
      return "Choose an option in";
    case "set_date":
      return "Set the date in";
    case "search_pick":
      return "Pick a result in";
    case "fill":
      return "Enter a value in";
    default:
      return "Act on";
  }
}

/**
 * Build a normalized, human-readable description of an action FROM DAEMON-OBSERVED
 * FIELDS ONLY. This text is what the confirm UI renders — the model never authors what
 * the user approves (INV-9). Note it deliberately never includes the action's `value`,
 * which could carry model- or page-derived text.
 */
export function normalizeAction(action: Action, ctx: NormalizeContext): NormalizedAction {
  const target = ctx.targetLabel ? `"${ctx.targetLabel}"` : "a control";
  const destination = ctx.formAction ?? ctx.origin;
  const summary = `${verbFor(action.op)} ${target} on ${ctx.origin}${
    ctx.formAction ? ` (transmits to ${destination})` : ""
  }.`;

  return {
    op: action.op,
    summary,
    origin: ctx.origin,
    ...(ctx.targetLabel ? { targetLabel: ctx.targetLabel } : {}),
    ...(ctx.formAction ? { formAction: ctx.formAction } : {}),
  };
}
