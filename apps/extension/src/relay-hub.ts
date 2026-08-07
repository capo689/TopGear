import { serviceWorkerAcceptsCommand, serviceWorkerAcceptsResult } from "@browser-bridge/relay";

/**
 * The service worker's trust logic, extracted from the `chrome.*` closure so it can be
 * tested. `service-worker.ts` wires this to the real native port and tabs API; nothing
 * here touches a browser global.
 *
 * This is the relay's trusted hub and it re-validates at BOTH hops (plan §10): a command
 * must arrive on the native port carrying the session nonce, and a result must survive
 * validation on the way back from the content script. Content scripts are less trusted
 * than the worker, so the page can never originate a command. Those are security
 * properties, and until now they had no test at all.
 */

export interface RelayHubDeps {
  /** Post a message back down the native port (to the shim, then the daemon). */
  post(msg: unknown): void;
  /** Deliver an accepted command to the operate-granted tab; resolves with its result. */
  sendToTab(tabId: number, command: unknown): Promise<unknown>;
  /** The tab the user granted Operate on, or null if no grant has been given. */
  getOperateTabId(): number | null;
}

export interface RelayHub {
  onNativeMessage(raw: unknown): Promise<void>;
  /** Exposed for assertions; the nonce is adopted once and never rebound. */
  nonce(): string;
}

export function createRelayHub(deps: RelayHubDeps): RelayHub {
  let operateNonce = "";

  return {
    nonce: () => operateNonce,

    async onNativeMessage(raw: unknown): Promise<void> {
      // Adopt the daemon's per-session nonce from its FIRST command only. The native port
      // is reachable only by the daemon (via the signed shim), so this binds SW↔daemon for
      // the session. Adopting once matters: re-adopting on a later message would let
      // anything that reached the port rebind the session to a nonce of its choosing.
      const maybe = raw as { nonce?: string };
      if (!operateNonce && typeof maybe?.nonce === "string") operateNonce = maybe.nonce;

      const accepted = serviceWorkerAcceptsCommand("native-port", raw, operateNonce);
      if (!accepted.ok) {
        deps.post({ kind: "result", correlationId: "unknown", ok: false, error: accepted.error });
        return;
      }

      const tabId = deps.getOperateTabId();
      if (tabId === null) {
        deps.post({ kind: "result", correlationId: accepted.value.correlationId, ok: false, error: "no operate grant" });
        return;
      }

      const result = await deps.sendToTab(tabId, accepted.value);
      const checked = serviceWorkerAcceptsResult("runtime", result);

      // Shape validation is not enough. The content script is the LESS trusted side of
      // this hop, and a well-formed result carrying someone else's correlationId would be
      // forwarded verbatim and matched by the daemon against a different in-flight
      // command. The worker knows which id it dispatched, so it — not the page side —
      // decides which command a result answers.
      if (checked.ok && checked.value.correlationId !== accepted.value.correlationId) {
        deps.post({
          kind: "result",
          correlationId: accepted.value.correlationId,
          ok: false,
          error: "correlationId mismatch from content script",
        });
        return;
      }

      deps.post(
        checked.ok
          ? checked.value
          : {
              kind: "result",
              correlationId: accepted.value.correlationId,
              ok: false,
              error: "invalid result from content script",
            },
      );
    },
  };
}
