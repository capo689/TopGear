import { z } from "zod";

/**
 * Operating modes (plan §2 mode routing). `semantic` is pure structured data;
 * `hybrid` adds targeted screenshots; `visual` hands off to the agent's own computer
 * use for browser-internal pages / broken semantics.
 */
export const AgentMode = z.enum(["semantic", "hybrid", "visual"]);
export type AgentMode = z.infer<typeof AgentMode>;

/**
 * Returned at attach so any model, any vendor, negotiates a common contract (INV-8).
 * Text-only models get pure-semantic mode; `vision` advertises screenshot support.
 */
export const Capabilities = z.object({
  schemaVersion: z.string(),
  vision: z.boolean(),
  modes: z.array(AgentMode),
  /** Raw CSS selectors — off by default; granted per-integration only (plan §4.2). */
  advancedCssSelectors: z.boolean(),
});
export type Capabilities = z.infer<typeof Capabilities>;
