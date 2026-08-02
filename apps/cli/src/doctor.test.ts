import { describe, it, expect } from "vitest";
import { runDoctorChecks, summarize, renderDoctor, type DoctorEnv } from "./doctor.js";

const base: DoctorEnv = { nodeVersion: "v24.14.1", platform: "darwin", hasChromium: true, socketReachable: true };

describe("runDoctorChecks", () => {
  it("passes a healthy environment", () => {
    const checks = runDoctorChecks(base);
    expect(summarize(checks).ok).toBe(true);
  });

  it("fails on old Node and missing Chromium", () => {
    const checks = runDoctorChecks({ ...base, nodeVersion: "v18.0.0", hasChromium: false });
    const { ok, failed } = summarize(checks);
    expect(ok).toBe(false);
    expect(failed).toContain("node");
    expect(failed).toContain("chromium");
  });

  it("only WARNS when the daemon socket is unreachable (not a hard fail)", () => {
    const checks = runDoctorChecks({ ...base, socketReachable: false });
    expect(summarize(checks).ok).toBe(true);
    expect(checks.find((c) => c.name === "daemon")?.status).toBe("warn");
  });

  it("renders a readable report", () => {
    expect(renderDoctor(runDoctorChecks(base))).toContain("node");
  });
});
