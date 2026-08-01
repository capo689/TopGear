import { z } from "zod";
import { ResolutionStatus } from "./locator.js";
import { ElementRecord } from "./element.js";

/**
 * Result of resolving a locator against the live page (plan §4.3). On `ambiguous`,
 * candidates are returned for the calling agent to arbitrate — the daemon NEVER
 * silently picks the top candidate when scores are close (INV-11: no internal
 * Arbiter). The closeness threshold lives in policy config.
 */
export const ResolutionResult = z.object({
  status: ResolutionStatus,
  /** 0–1, scored across fingerprint signals. */
  confidence: z.number().min(0).max(1),
  candidates: z.array(ElementRecord).optional(),
});
export type ResolutionResult = z.infer<typeof ResolutionResult>;
