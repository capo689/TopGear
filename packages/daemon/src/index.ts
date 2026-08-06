/**
 * @browser-bridge/daemon — the local session registry and gateway. Binds TaskGrants,
 * negotiates capabilities, and drives the execution engine over an injected backend.
 * All safety policy lives here (INV-5); no model is trusted.
 */
export * from "./daemon.js";
export { EvalTelemetry, telemetryStatusMessage, type EvalEvent, type EvalRecordInput } from "./eval-telemetry.js";
