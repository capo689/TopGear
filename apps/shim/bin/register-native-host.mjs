#!/usr/bin/env node
/**
 * Register the Browser Bridge native-messaging host with Chrome. RUN THIS YOURSELF — it
 * writes to Chrome's NativeMessagingHosts directory (outside the repo). It generates a
 * launcher for the dev shim and a host manifest scoped to your unpacked extension's ID.
 *
 * Usage:  node apps/shim/bin/register-native-host.mjs <EXTENSION_ID>
 * Find <EXTENSION_ID> on chrome://extensions after loading the unpacked extension.
 */
import { writeFileSync, mkdirSync, chmodSync, existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const extId = process.argv[2];
if (!extId || !/^[a-p]{32}$/.test(extId)) {
  process.stderr.write("usage: register-native-host.mjs <EXTENSION_ID>  (32 lowercase a-p chars from chrome://extensions)\n");
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url)); // apps/shim/bin
const shimJs = resolve(here, "..", "dist", "shim.js");
if (!existsSync(shimJs)) {
  process.stderr.write(`shim not built: ${shimJs}\nrun: pnpm --filter @browser-bridge/shim build\n`);
  process.exit(1);
}

const launcher = resolve(here, "..", "dist", "shim-launcher.sh");
writeFileSync(launcher, `#!/bin/sh\nexec node "${shimJs}" "$@"\n`);
chmodSync(launcher, 0o755);

const manifest = {
  name: "com.browser_bridge.shim",
  description: "Browser Bridge native messaging shim (dev)",
  path: launcher,
  type: "stdio",
  allowed_origins: [`chrome-extension://${extId}/`],
};

const hostDirs = {
  darwin: join(homedir(), "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts"),
  linux: join(homedir(), ".config", "google-chrome", "NativeMessagingHosts"),
};
const dir = hostDirs[platform()];
if (!dir) {
  process.stderr.write(`unsupported platform: ${platform()} (macOS/Linux only for the dev shim)\n`);
  process.exit(1);
}
mkdirSync(dir, { recursive: true });
const dest = join(dir, "com.browser_bridge.shim.json");
writeFileSync(dest, JSON.stringify(manifest, null, 2) + "\n");

process.stdout.write(`✓ native host manifest → ${dest}\n`);
process.stdout.write(`✓ shim launcher        → ${launcher}\n`);
process.stdout.write(`Now start the daemon (BB_BACKEND=extension) and click "Grant Operate" in Chrome.\n`);
