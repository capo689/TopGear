import { createRelayHub } from "./relay-hub.js";

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

// All trust logic lives in relay-hub.ts so it is testable without a browser.
const hub = createRelayHub({
  post: (msg) => nativePort?.postMessage(msg),
  sendToTab: (tabId, command) => chrome.tabs.sendMessage(tabId, command),
  getOperateTabId: () => operateTabId,
});

function connect(): void {
  if (nativePort) return;
  nativePort = chrome.runtime.connectNative(NATIVE_HOST);
  nativePort.onMessage.addListener((raw) => void hub.onNativeMessage(raw));
  nativePort.onDisconnect.addListener(() => {
    nativePort = null;
  });
}

chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined) return;
  operateTabId = tab.id;
  // The session nonce is adopted from the daemon's first command (see onNativeMessage).
  void chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content-script.js"] });
  connect();
});
