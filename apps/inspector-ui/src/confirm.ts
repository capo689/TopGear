import type { ConfirmationCapability } from "@browser-bridge/protocol";

/**
 * The confirm UI's display model. CRITICAL (INV-9): every field here comes from the
 * DAEMON-built ConfirmationCapability — the normalized summary, the origin, the
 * destination, the sensitive fields. The model's words are never rendered. The user
 * approves what the daemon describes, not what the model claims.
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

export interface ConfirmCallbacks {
  /** Approve → the daemon mints/approves the capability. Only the UI can call this. */
  approve(capabilityId: string): void | Promise<void>;
  deny(capabilityId: string): void | Promise<void>;
}

export class ConfirmController {
  constructor(private readonly callbacks: ConfirmCallbacks) {}

  approve(cap: ConfirmationCapability): void | Promise<void> {
    return this.callbacks.approve(cap.capabilityId);
  }

  deny(cap: ConfirmationCapability): void | Promise<void> {
    return this.callbacks.deny(cap.capabilityId);
  }
}
