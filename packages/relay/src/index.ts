/**
 * @browser-bridge/relay — the extension relay contract and per-hop validation (T5).
 * Every boundary re-validates on receipt; content scripts are less trusted than the
 * service worker; the page can never forge an authenticated command.
 */
export * from "./messages.js";
export * from "./validate.js";
