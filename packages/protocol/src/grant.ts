import { z } from "zod";
import { RiskTier } from "./primitives.js";

/** Per-task resource ceilings enforced by the scheduler (plan §4.5, §8). */
export const TaskBudgets = z.object({
  maxPages: z.number().int().nonnegative().optional(),
  maxDownloads: z.number().int().nonnegative().optional(),
  maxTabs: z.number().int().nonnegative().optional(),
  maxUploadBytes: z.number().int().nonnegative().optional(),
});
export type TaskBudgets = z.infer<typeof TaskBudgets>;

/**
 * The authorization object every session and batch binds to (INV-9, plan §4.5).
 * Actions outside the grant fail with a teaching error naming the needed extension;
 * a model can never widen its own grant — that is a user decision.
 */
export const TaskGrant = z.object({
  taskId: z.string().min(1),
  /** Exact origins; no wildcards below eTLD+1. */
  allowedOrigins: z.array(z.string()),
  /** Ceiling for ungated execution. */
  allowedRiskTiers: z.array(RiskTier),
  /** Origins permitted to receive sensitive-tagged values (T4 exfiltration). */
  sensitiveDataDestinations: z.array(z.string()),
  budgets: TaskBudgets,
  /** ISO 8601 timestamp. */
  expiresAt: z.string(),
});
export type TaskGrant = z.infer<typeof TaskGrant>;

/**
 * A normalized, daemon-authored description of a blocked action. Constructed BY THE
 * DAEMON from the action it observed — NEVER from model-supplied text (INV-9). The
 * confirm UI renders this, not the model's words.
 */
export const NormalizedAction = z.object({
  op: z.string(),
  /** Daemon-authored human summary shown in the confirm UI. */
  summary: z.string(),
  targetLabel: z.string().optional(),
  origin: z.string(),
  /** Destination the action would transmit to, when applicable. */
  formAction: z.string().optional(),
});
export type NormalizedAction = z.infer<typeof NormalizedAction>;

/**
 * A single-use authorization to run one high-risk action (INV-9, plan §4.5). Bound to
 * action + origin + page revision + TTL + nonce. Consumed on use; invalid if the page
 * revision moved or the TTL expired. No prior confirmation authorizes a later replay.
 */
export const ConfirmationCapability = z.object({
  capabilityId: z.string().min(1),
  action: NormalizedAction,
  origin: z.string(),
  pageRevision: z.number().int(),
  /** Which sensitive-tagged values this action would transmit. */
  sensitiveFields: z.array(z.string()),
  /** ISO 8601 timestamp; short TTL. */
  expiresAt: z.string(),
});
export type ConfirmationCapability = z.infer<typeof ConfirmationCapability>;
