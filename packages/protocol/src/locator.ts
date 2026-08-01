import { z } from "zod";

/**
 * What the DAEMON records in views and site memory — the scored fingerprint
 * (plan §4.3). Never sent by models; used for execution-time re-resolution so that
 * rerenders which replace DOM nodes are survived by design.
 */
export const LocatorFingerprint = z.object({
  role: z.string().optional(),
  /** Normalized accessible name. */
  name: z.string().optional(),
  /** data-testid and friends. */
  testId: z.string().optional(),
  autocomplete: z.string().optional(),
  inputType: z.string().optional(),
  /** id/name where non-generated. */
  stableAttributes: z.record(z.string()).optional(),
  formContext: z.string().optional(),
  framePath: z.array(z.string()).optional(),
  /** Hashed ancestor/sibling shape. */
  structuralFingerprint: z.string().optional(),
  /** Localization resilience. */
  labels: z.array(z.object({ locale: z.string(), name: z.string() })).optional(),
});
export type LocatorFingerprint = z.infer<typeof LocatorFingerprint>;

/** Status of resolving a locator against the live page. */
export const ResolutionStatus = z.enum(["resolved", "ambiguous", "not_found"]);
export type ResolutionStatus = z.infer<typeof ResolutionStatus>;
