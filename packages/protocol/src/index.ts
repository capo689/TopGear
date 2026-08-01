/**
 * @browser-bridge/protocol — the single source of truth for every cross-boundary type.
 * Every boundary (content script → service worker → shim → daemon, and daemon ↔ agent)
 * re-validates with these Zod schemas on receipt. Nothing else defines wire types.
 */
export * from "./version.js";
export * from "./caps.js";
export * from "./validate.js";
export * from "./primitives.js";
export * from "./locator.js";
export * from "./element.js";
export * from "./resolution.js";
export * from "./view.js";
export * from "./action.js";
export * from "./grant.js";
export * from "./result.js";
export * from "./envelope.js";
export * from "./capabilities.js";
