import { describe, it, expect } from "vitest";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { EvalTelemetry, telemetryStatusMessage } from "./eval-telemetry.js";

describe("EvalTelemetry.fromEnv (installed-bundle control surface)", () => {
  it("is disabled when BB_EVAL_LOG is unset or empty", () => {
    expect(EvalTelemetry.fromEnv({})).toBeUndefined();
    expect(EvalTelemetry.fromEnv({ BB_EVAL_LOG: "" })).toBeUndefined();
    expect(EvalTelemetry.fromEnv({ BB_EVAL_LOG: "   " })).toBeUndefined();
  });

  it("is disabled when the host left the placeholder unsubstituted (never writes to that path)", () => {
    // The MCPB spec doesn't document how an unset optional string renders; if the host leaves
    // "${user_config.eval_log_path}" literal, we must NOT create a file named that.
    expect(EvalTelemetry.fromEnv({ BB_EVAL_LOG: "${user_config.eval_log_path}" })).toBeUndefined();
  });

  it("is enabled with a real path and writes a JSONL event", () => {
    const path = join(tmpdir(), `bb-tel-${randomUUID()}.jsonl`);
    try {
      const sink = EvalTelemetry.fromEnv({ BB_EVAL_LOG: path, BB_EVAL_RUN: JSON.stringify({ workflow: "wf" }) });
      expect(sink).toBeDefined();
      sink!.record({ runIndex: 0, targetUrl: "https://x", sessionId: "s", tool: "act", wallMs: 5, pageLoadMs: 1, fieldsAttempted: 3, fieldsVerified: 3, interrupted: false, status: "completed" });
      const line = JSON.parse(readFileSync(path, "utf8").trim());
      expect(line.workflow).toBe("wf");
      expect(line.runIndex).toBe(0);
      expect(line.fieldsVerified).toBe(3);
    } finally {
      rmSync(path, { force: true });
    }
  });
});

describe("telemetryStatusMessage (D5 — silent-off must be visible)", () => {
  it("says OFF and names the .mcpb-update cause when BB_EVAL_LOG is unset", () => {
    const msg = telemetryStatusMessage({});
    expect(msg).toContain("OFF");
    expect(msg.toLowerCase()).toContain("update"); // an extension UPDATE clears user_config — the actual cause
  });

  it("says OFF and shows the raw value when the host left the placeholder unsubstituted", () => {
    const msg = telemetryStatusMessage({ BB_EVAL_LOG: "${user_config.eval_log_path}" });
    expect(msg).toContain("OFF");
    expect(msg).toContain("${user_config.eval_log_path}");
  });

  it("says ON with the path when telemetry is configured", () => {
    expect(telemetryStatusMessage({ BB_EVAL_LOG: "/tmp/x.jsonl" })).toBe("browser-bridge: eval telemetry ON → /tmp/x.jsonl");
  });
});
