/**
 * @browser-bridge/locators — fingerprint scoring, execution-time re-resolution, and
 * ambiguity arbitration (plan §4.3). Refs and node ids are caches, never addresses;
 * close-scored ambiguity returns candidates rather than a silent top pick (INV-11).
 */
export * from "./score.js";
export * from "./resolve.js";
