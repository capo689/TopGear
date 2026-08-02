#!/usr/bin/env node
import { existsSync } from "node:fs";
import { homedir, platform as osPlatform } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "node:net";
import { spawnSync } from "node:child_process";
import { runDoctorChecks, renderDoctor, summarize, type DoctorEnv } from "./doctor.js";

const here = dirname(fileURLToPath(import.meta.url)); // apps/cli/dist
const repoRoot = resolve(here, "..", "..", "..");

function chromiumPresent(): boolean {
  const candidates = [
    join(homedir(), "Library", "Caches", "ms-playwright"),
    join(homedir(), ".cache", "ms-playwright"),
    join(homedir(), "AppData", "Local", "ms-playwright"),
  ];
  return candidates.some((p) => existsSync(p));
}

function extensionBuilt(): boolean {
  return existsSync(join(repoRoot, "apps", "extension", "dist", "manifest.json"));
}

function nativeHostRegistered(): boolean {
  const dirs: Record<string, string> = {
    darwin: join(homedir(), "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts"),
    linux: join(homedir(), ".config", "google-chrome", "NativeMessagingHosts"),
  };
  const dir = dirs[osPlatform()];
  return dir ? existsSync(join(dir, "com.browser_bridge.shim.json")) : false;
}

function pnpmOnPath(): boolean {
  // Resolve pnpm exactly the way turbo's child processes do: as a PATH binary. A shell
  // function or `corepack pnpm` alias does NOT count — spawnSync bare-command resolution
  // mirrors what the build actually needs. ENOENT (not found) → false.
  try {
    const r = spawnSync("pnpm", ["--version"], { encoding: "utf8", timeout: 5000 });
    return r.status === 0 && !r.error;
  } catch {
    return false;
  }
}

function socketReachable(path: string): Promise<boolean> {
  return new Promise((res) => {
    const sock = connect(path);
    const done = (v: boolean) => {
      sock.destroy();
      res(v);
    };
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
    setTimeout(() => done(false), 300);
  });
}

async function doctor(): Promise<void> {
  const socketPath = process.env.BB_SOCKET ?? "/tmp/browser-bridge.sock";
  const env: DoctorEnv = {
    nodeVersion: process.version,
    platform: process.platform,
    hasChromium: chromiumPresent(),
    pnpmOnPath: pnpmOnPath(),
    socketReachable: await socketReachable(socketPath),
    extensionBuilt: extensionBuilt(),
    nativeHostRegistered: nativeHostRegistered(),
  };
  const checks = runDoctorChecks(env);
  process.stdout.write(renderDoctor(checks) + "\n");
  const { ok, failed } = summarize(checks);
  if (!ok) {
    process.stdout.write(`\nFailed: ${failed.join(", ")}\n`);
    process.exit(1);
  }
}

const command = process.argv[2];
if (command === "doctor") {
  void doctor();
} else {
  process.stdout.write("usage: browser-bridge doctor\n");
}
