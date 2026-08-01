/**
 * Protocol hard caps (plan §4.1). Enforced by the daemon and rejected with teaching
 * errors — never silently truncated. Kept as data so both the daemon and the tests
 * reference one source of truth.
 */
export const PROTOCOL_CAPS = {
  /** Max actions in a single batch, before `if` expansion. */
  maxActionsPerBatch: 30,
  /** Max nesting depth of `if` actions. */
  maxIfDepth: 2,
  /** Max total actions after fully expanding every `if.then` / `if.else`. */
  maxExpandedActions: 60,
  /** Max request payload size in bytes. */
  maxRequestPayloadBytes: 256 * 1024,
  /** Max screenshot response size in bytes. */
  maxScreenshotResponseBytes: 2 * 1024 * 1024,
  /** Max semantic-view response size in bytes. */
  maxViewResponseBytes: 64 * 1024,
} as const;

export type ProtocolCaps = typeof PROTOCOL_CAPS;

/** Stable machine-readable codes for cap violations (teaching errors carry these). */
export type CapViolationCode =
  | "too_many_actions"
  | "if_depth_exceeded"
  | "too_many_expanded_actions"
  | "payload_too_large"
  | "screenshot_too_large"
  | "view_too_large";
