import { RelayCommand, RelayResult, RelayHandshake } from "./messages.js";

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

/** Where a message arrived from. The trust boundary is enforced against this. */
export type MessageSource = "socket" | "native-port" | "runtime" | "page";

export function validateCommand(raw: unknown): Validated<RelayCommand> {
  const parsed = RelayCommand.safeParse(raw);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: parsed.error.message };
}

export function validateResult(raw: unknown): Validated<RelayResult> {
  const parsed = RelayResult.safeParse(raw);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: parsed.error.message };
}

export function validateHandshake(raw: unknown): Validated<RelayHandshake> {
  const parsed = RelayHandshake.safeParse(raw);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: parsed.error.message };
}

/**
 * Content-script receipt (LEAST trusted context). It honors commands ONLY from the
 * extension runtime (the service worker) — never from the page (`window.postMessage`).
 * This is the concrete guard behind "the page can never fabricate an authenticated
 * command" (T5).
 */
export function contentScriptAccepts(source: MessageSource, raw: unknown): Validated<RelayCommand> {
  if (source !== "runtime") return { ok: false, error: `content script ignores commands from ${source}` };
  return validateCommand(raw);
}

/**
 * Service-worker receipt of a COMMAND. Commands may only come from the native port (the
 * daemon side), and must carry the per-tab nonce the SW issued. A page or content script
 * cannot originate an authenticated command.
 */
export function serviceWorkerAcceptsCommand(source: MessageSource, raw: unknown, expectedNonce: string): Validated<RelayCommand> {
  if (source !== "native-port") return { ok: false, error: `service worker ignores commands from ${source}` };
  const v = validateCommand(raw);
  if (!v.ok) return v;
  if (v.value.nonce !== expectedNonce) return { ok: false, error: "nonce mismatch" };
  return v;
}

/** Service-worker receipt of a RESULT — only from the content script (runtime). */
export function serviceWorkerAcceptsResult(source: MessageSource, raw: unknown): Validated<RelayResult> {
  if (source !== "runtime") return { ok: false, error: `service worker ignores results from ${source}` };
  return validateResult(raw);
}

/** Daemon-side receipt from the shim — only over the authed local socket. */
export function daemonAcceptsResult(source: MessageSource, raw: unknown): Validated<RelayResult> {
  if (source !== "socket") return { ok: false, error: `daemon ignores results from ${source}` };
  return validateResult(raw);
}
