/**
 * `browser-bridge doctor` — verify a dev install can run the bridge (plan §13). The
 * checks are pure functions over an injected environment snapshot so they are testable
 * without touching the real machine.
 */
export interface DoctorEnv {
  nodeVersion: string; // e.g. "v24.14.1"
  platform: string; // process.platform
  hasChromium: boolean;
  socketReachable: boolean;
  /**
   * `pnpm` resolves as a PATH binary (spawnSync('pnpm') succeeds). A HARD prerequisite:
   * turbo spawns `pnpm` in child processes, so the repo cannot build without it — and
   * `corepack pnpm build` does NOT satisfy that (pnpm must be PATH-resolvable itself).
   */
  pnpmOnPath: boolean;
  /** Extension bundled to apps/extension/dist (load-unpacked ready). */
  extensionBuilt: boolean;
  /** Native-messaging host manifest registered with Chrome. */
  nativeHostRegistered: boolean;
}

/**
 * The exact remediation when pnpm isn't on PATH — including the /usr/local Node case
 * where plain `corepack enable` fails EACCES (finding #4, first dogfood rebuild).
 */
export const PNPM_FIX =
  'corepack enable  (if it fails EACCES because Node is in /usr/local: ' +
  'corepack enable --install-directory "$HOME/.local/bin" && export PATH="$HOME/.local/bin:$PATH")';

export type CheckStatus = "ok" | "warn" | "fail";

export interface DoctorCheck {
  name: string;
  status: CheckStatus;
  detail: string;
}

function majorVersion(v: string): number {
  return Number((v.startsWith("v") ? v.slice(1) : v).split(".")[0] ?? "0");
}

export function runDoctorChecks(env: DoctorEnv): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  const major = majorVersion(env.nodeVersion);
  checks.push({
    name: "node",
    status: major >= 20 ? "ok" : "fail",
    detail: major >= 20 ? `Node ${env.nodeVersion}` : `Node ${env.nodeVersion} — need >= 20`,
  });

  checks.push({
    name: "platform",
    status: ["darwin", "linux", "win32"].includes(env.platform) ? "ok" : "warn",
    detail: env.platform,
  });

  checks.push({
    name: "pnpm",
    status: env.pnpmOnPath ? "ok" : "fail",
    detail: env.pnpmOnPath ? "pnpm resolves on PATH (turbo can build)" : `pnpm NOT on PATH — turbo cannot build. Fix: ${PNPM_FIX}`,
  });

  checks.push({
    name: "chromium",
    status: env.hasChromium ? "ok" : "fail",
    detail: env.hasChromium ? "Playwright Chromium present" : "run: pnpm exec playwright install chromium",
  });

  checks.push({
    name: "daemon",
    status: env.socketReachable ? "ok" : "warn",
    detail: env.socketReachable ? "daemon socket reachable" : "daemon not running (start it before attaching)",
  });

  checks.push({
    name: "extension",
    status: env.extensionBuilt ? "ok" : "warn",
    detail: env.extensionBuilt ? "bundled → apps/extension/dist" : "run: pnpm --filter @browser-bridge/extension build",
  });

  checks.push({
    name: "native-host",
    status: env.nativeHostRegistered ? "ok" : "warn",
    detail: env.nativeHostRegistered
      ? "com.browser_bridge.shim registered"
      : "run: node apps/shim/bin/register-native-host.mjs <EXTENSION_ID>",
  });

  return checks;
}

export function summarize(checks: DoctorCheck[]): { ok: boolean; failed: string[] } {
  const failed = checks.filter((c) => c.status === "fail").map((c) => c.name);
  return { ok: failed.length === 0, failed };
}

export function renderDoctor(checks: DoctorCheck[]): string {
  const icon = (s: CheckStatus) => (s === "ok" ? "✓" : s === "warn" ? "!" : "✗");
  return checks.map((c) => `${icon(c.status)} ${c.name.padEnd(10)} ${c.detail}`).join("\n");
}
