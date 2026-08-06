import { z } from "zod";
import { RiskTier } from "./primitives.js";
import { ElementRecord } from "./element.js";
import { SemanticView } from "./view.js";
import { ConfirmationCapability } from "./grant.js";

/**
 * Typed failure reasons (plan §4.6). Failures are ALWAYS typed — never `unknown` — and
 * teach: found / expected / alternatives. Discriminated on `reason`.
 */
export const FailureDetail = z.discriminatedUnion("reason", [
  z.object({ reason: z.literal("option_not_found"), availableOptions: z.array(z.string()) }),
  /**
   * D4: the runtime could not READ this widget's options, so it does not know what it has.
   * Distinct from `option_not_found` with an empty list, which asserts the field genuinely
   * offers nothing. "I could not look" and "there is nothing there" are different facts and
   * an agent acts differently on each: `closed` → reopen the widget and retry; `unknown` →
   * the widget exposes no open/closed state, fall back to a view or screenshot.
   */
  z.object({
    reason: z.literal("options_not_visible"),
    widgetState: z.enum(["closed", "unknown"]),
    detail: z.string().optional(),
  }),
  z.object({ reason: z.literal("ambiguous_target"), candidates: z.array(ElementRecord) }),
  z.object({ reason: z.literal("stale_target"), freshView: SemanticView.optional() }),
  z.object({ reason: z.literal("widget_unrecognized"), widgetHint: z.string().optional() }),
  z.object({ reason: z.literal("not_editable") }),
  z.object({ reason: z.literal("not_visible") }),
  z.object({ reason: z.literal("disabled") }),
  z.object({
    reason: z.literal("grant_denied"),
    needed: z.object({ origin: z.string().optional(), tier: RiskTier.optional() }),
  }),
  z.object({ reason: z.literal("capability_required") }),
  z.object({ reason: z.literal("capability_invalid") }),
  z.object({ reason: z.literal("verification_mismatch"), expected: z.string(), observed: z.string() }),
  z.object({ reason: z.literal("timeout") }),
  z.object({ reason: z.literal("budget_exhausted"), budget: z.string().optional() }),
]);
export type FailureDetail = z.infer<typeof FailureDetail>;

/** Per-action outcome inside a batch result. */
export const ActionResult = z.object({
  target: z.string(),
  status: z.enum(["verified", "failed", "skipped"]),
  failure: FailureDetail.optional(),
});
export type ActionResult = z.infer<typeof ActionResult>;

/** Kinds of interruption that stop a batch and cost one model turn to handle. */
export const InterruptionKind = z.enum([
  "navigation",
  "modal",
  "origin_change",
  "confirmation_required",
  "captcha",
  "auth_wall",
  "budget_exhausted",
]);
export type InterruptionKind = z.infer<typeof InterruptionKind>;

/** Details of an interruption; carries a daemon-built pending confirmation and a view. */
export const Interruption = z.object({
  kind: InterruptionKind,
  /** Daemon-constructed, not yet minted into a usable capability. */
  pendingConfirmation: ConfirmationCapability.optional(),
  view: SemanticView.optional(),
});
export type Interruption = z.infer<typeof Interruption>;

/** The result of executing an action batch (plan §4.6). */
export const BatchResult = z.object({
  status: z.enum(["completed", "partial", "rejected", "interrupted"]),
  revision: z.number().int(),
  completed: z.number().int().nonnegative(),
  results: z.array(ActionResult),
  interruption: Interruption.optional(),
  invalidFields: z.array(ElementRecord).optional(),
  /**
   * Milliseconds the daemon spent waiting for navigation to settle during this batch (goto +
   * post-navigation re-capture). The daemon is the only component that knows when the page
   * settled, so it reports it here for the live-tier eval recorder to subtract from wall clock.
   */
  pageLoadMs: z.number().nonnegative().optional(),
});
export type BatchResult = z.infer<typeof BatchResult>;
