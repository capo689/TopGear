import type { ConfirmationCapability } from "@browser-bridge/protocol";

/**
 * The human-facing description of a blocked action (INV-9).
 *
 * This lives in `policy`, beside the CapabilityStore that mints the capability, and NOT
 * in the confirm UI. That placement is the invariant: "the dialog renders the daemon's
 * words, never the model's" has to be structural, not a convention someone remembers.
 * With the function here, the daemon produces the exact strings a human approves and the
 * UI is a renderer with nothing of its own to say. A UI that formatted its own summary
 * could drift from what was actually authorized, and nobody would notice until it
 * mattered.
 *
 * Every field is taken from the DAEMON-built capability. Nothing model-supplied reaches
 * it, because nothing model-supplied is in `ConfirmationCapability` in the first place.
 */
export interface ConfirmationDisplay {
  title: string;
  summary: string;
  origin: string;
  destination?: string;
  sensitiveFields: string[];
  expiresAt: string;
  capabilityId: string;
}

export function describeConfirmation(cap: ConfirmationCapability): ConfirmationDisplay {
  return {
    title: "Confirm a high-risk action",
    summary: cap.action.summary,
    origin: cap.origin,
    ...(cap.action.formAction ? { destination: cap.action.formAction } : {}),
    sensitiveFields: cap.sensitiveFields,
    expiresAt: cap.expiresAt,
    capabilityId: cap.capabilityId,
  };
}
