/**
 * @browser-bridge/browser-extension — the signed-in-profile transport. The daemon drives
 * a real tab through: daemon socket → native shim → MV3 service worker → content script.
 * `startSocketRelay` is the daemon-side listener; `ExtensionBackend` is the BrowserBackend
 * the execution engine drives over it.
 */
export * from "./transport.js";
export * from "./backend.js";
