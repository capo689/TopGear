/**
 * @browser-bridge/execution — the batch engine. Resolves each action at execution time,
 * runs it through the SAME policy authorize decision (INV-5), executes the primitive,
 * verifies read-back, and audits — with embedded waits, `if`, confirmation
 * interruptions, and navigation detection (plan §7).
 */
export * from "./session.js";
