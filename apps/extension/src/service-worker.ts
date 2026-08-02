import { serviceWorkerAcceptsCommand, serviceWorkerAcceptsResult } from "@browser-bridge/relay";

/**
 * MV3 service worker — the relay's trusted hub. It talks to the native shim over a
 * native-messaging port (the daemon side) and to the content script over the runtime
 * channel. It re-validates at BOTH hops: commands must arrive from the native port with
 * the per-tab nonce, and results must arrive from the content script. Content scripts
 * are less trusted than the worker; the page cannot originate a command.
 *
 * Permission ladder (plan §10): no all-sites content script. The user clicks the
 * toolbar action to grant Operate on the active tab, which injects the content script.
 */
const NATIVE_HOST = "com.browser_bridge.shim";

type NativePort = ReturnType<typeof chrome.runtime.connectNative>;
let nativePort: NativePort | null = null;
let operateTabId: number | null = null;
let operateNonce = "";

function connect(): void {
  if (nativePort) return;
  nativePort = chrome.runtime.connectNative(NATIVE_HOST);
  nativePort.onMessage.addListener((raw) => void onNativeMessage(raw));
  nativePort.onDisconnect.addListener(() => {
    nativePort = null;
  });
}

async function onNativeMessage(raw: unknown): Promise<void> {
  // Adopt the daemon's per-session nonce from its first command. The native port is only
  // reachable by the daemon (via the signed shim), so this binds SW↔daemon for the
  // session; the page can never originate a native-port command.
  const maybe = raw as { nonce?: string };
  if (!operateNonce && typeof maybe?.nonce === "string") operateNonce = maybe.nonce;
  const accepted = serviceWorkerAcceptsCommand("native-port", raw, operateNonce);
  if (!accepted.ok) {
    nativePort?.postMessage({ kind: "result", correlationId: "unknown", ok: false, error: accepted.error });
    return;
  }
  if (operateTabId === null) {
    nativePort?.postMessage({ kind: "result", correlationId: accepted.value.correlationId, ok: false, error: "no operate grant" });
    return;
  }
  const result = await chrome.tabs.sendMessage(operateTabId, accepted.value);
  const checked = serviceWorkerAcceptsResult("runtime", result);
  nativePort?.postMessage(
    checked.ok
      ? checked.value
      : { kind: "result", correlationId: accepted.value.correlationId, ok: false, error: "invalid result from content script" },
  );
}

chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined) return;
  operateTabId = tab.id;
  // The session nonce is adopted from the daemon's first command (see onNativeMessage).
  void chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content-script.js"] });
  connect();
});
