import { describe, it, expect } from "vitest";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { EvalTelemetry } from "./eval-telemetry.js";

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
