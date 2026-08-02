#!/usr/bin/env node
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
import { runDoctorChecks, renderDoctor, summarize, type DoctorEnv } from "./doctor.js";

function chromiumPresent(): boolean {
  const candidates = [
    join(homedir(), "Library", "Caches", "ms-playwright"),
    join(homedir(), ".cache", "ms-playwright"),
    join(homedir(), "AppData", "Local", "ms-playwright"),
  ];
  return candidates.some((p) => existsSync(p));
}

function socketReachable(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = connect(path);
    const done = (v: boolean) => {
      sock.destroy();
      resolve(v);
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
    socketReachable: await socketReachable(socketPath),
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
