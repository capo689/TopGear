import { z } from "zod";

/**
 * The relay message contract (plan §2). Commands flow daemon → shim → service worker →
 * content script; results flow back. EVERY hop re-validates with these schemas on
 * receipt — including the extension-internal boundaries. Content scripts are less
 * trusted than the service worker, and the page can never fabricate an authenticated
 * command.
 */

/** Backend operations the daemon asks the page context to perform. */
export const RelayOp = z.enum([
  "captureRaw",
  "readState",
  "fillText",
  "setChecked",
  "selectOption",
  "click",
  "press",
  "scroll",
  "waitFor",
  "evaluateCondition",
  "screenshot",
  "goto",
  "url",
]);
export type RelayOp = z.infer<typeof RelayOp>;

/**
 * A command from the daemon side. `nonce` is issued by the service worker per attached
 * tab and is unknown to the page — a page-world script cannot forge a command the
 * content script will honor.
 */
export const RelayCommand = z.object({
  kind: z.literal("command"),
  correlationId: z.string().min(1),
  nonce: z.string().min(1),
  op: RelayOp,
  args: z.record(z.unknown()).default({}),
});
export type RelayCommand = z.infer<typeof RelayCommand>;

/** A result flowing back from the page context. */
export const RelayResult = z.object({
  kind: z.literal("result"),
  correlationId: z.string().min(1),
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
});
export type RelayResult = z.infer<typeof RelayResult>;

/** Handshake the shim performs with the daemon over the authed local socket. */
export const RelayHandshake = z.object({
  kind: z.literal("handshake"),
  schemaVersion: z.string(),
  shimVersion: z.string(),
});
export type RelayHandshake = z.infer<typeof RelayHandshake>;
