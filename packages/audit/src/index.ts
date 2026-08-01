/**
 * @browser-bridge/audit — redacted structured logging with correlation IDs (T7).
 * Records action names, target labels, origins, and outcomes only. Never raw values,
 * secrets, cookies, history, or URL query strings.
 */
export * from "./redact.js";
export * from "./audit.js";
