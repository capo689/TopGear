/**
 * @browser-bridge/scheduler — the two-level governor (INV-7). Global governor protects
 * the machine and catches runaway agents; per-origin governors protect websites. All
 * traffic flows through it; cross-origin parallelism is bounded, never "unlimited".
 */
export * from "./semaphore.js";
export * from "./scheduler.js";
