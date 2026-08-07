import type { ConfirmationCapability } from "@browser-bridge/protocol";

/**
 * The confirm UI is a RENDERER. It has nothing of its own to say about a blocked action.
 *
 * `describeConfirmation` and `ConfirmationDisplay` used to live here, which meant INV-9's
 * "the dialog shows the daemon's words, never the model's" held only by convention — a
 * UI that formats its own summary can drift from what was actually authorized, and the
 * drift is invisible until it matters. They now live in `@browser-bridge/policy`, beside
 * the store that mints the capability, and are re-exported here so the placement is a
 * fact about the code rather than a rule someone has to remember.
 */
export { describeConfirmation, type ConfirmationDisplay } from "@browser-bridge/policy";

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
