import { describe, it, expect } from "vitest";
import { runDoctorChecks, summarize, renderDoctor, PNPM_FIX, type DoctorEnv } from "./doctor.js";

const base: DoctorEnv = {
  nodeVersion: "v24.14.1",
  platform: "darwin",
  hasChromium: true,
  pnpmOnPath: true,
  socketReachable: true,
  extensionBuilt: true,
  nativeHostRegistered: true,
};

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

  it("HARD-fails when pnpm is not on PATH and prints the --install-directory fix (finding #4)", () => {
    const checks = runDoctorChecks({ ...base, pnpmOnPath: false });
    const { ok, failed } = summarize(checks);
    expect(ok).toBe(false);
    expect(failed).toContain("pnpm");
    const pnpm = checks.find((c) => c.name === "pnpm");
    expect(pnpm?.detail).toContain("--install-directory");
    expect(PNPM_FIX).toContain('$HOME/.local/bin');
  });

  it("only WARNS when the daemon socket is unreachable (not a hard fail)", () => {
    const checks = runDoctorChecks({ ...base, socketReachable: false });
    expect(summarize(checks).ok).toBe(true);
    expect(checks.find((c) => c.name === "daemon")?.status).toBe("warn");
  });

  it("WARNS (not fails) when the extension bundle or native host is missing", () => {
    const checks = runDoctorChecks({ ...base, extensionBuilt: false, nativeHostRegistered: false });
    expect(summarize(checks).ok).toBe(true);
    expect(checks.find((c) => c.name === "extension")?.status).toBe("warn");
    expect(checks.find((c) => c.name === "native-host")?.status).toBe("warn");
  });

  it("renders a readable report", () => {
    expect(renderDoctor(runDoctorChecks(base))).toContain("node");
  });
});
