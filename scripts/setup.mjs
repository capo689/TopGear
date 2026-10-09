#!/usr/bin/env node
/**
 * One-command install for a fresh checkout:
 *
 *   pnpm bootstrap
 *
 * 1. checks Node >= 20 and that pnpm resolves on PATH (turbo needs it)
 * 2. pnpm install --frozen-lockfile
 * 3. pnpm build
 * 4. pnpm exec playwright install chromium   (the isolated browser the server drives)
 * 5. runs the smoke test: starts the MCP server over stdio and drives a local page
 * 6. prints copy-paste config for Claude Code, Claude Desktop and other MCP clients
 *
 * Flags:  --skip-smoke   skip step 5
 *         --no-browser   skip step 4 (only if Chromium is already installed)
 *
 * It writes nothing outside this checkout except Playwright's browser cache
 * (~/Library/Caches/ms-playwright on macOS, ~/.cache/ms-playwright on Linux).
 * It never edits your MCP client's config; it prints what to add.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const isWin = process.platform === "win32";

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

function run(title, cmd, cmdArgs) {
  console.log(`\n→ ${title}\n  $ ${[cmd, ...cmdArgs].join(" ")}`);
  const r = spawnSync(cmd, cmdArgs, { cwd: root, stdio: "inherit", shell: isWin });
  if (r.error) fail(`${title} could not start: ${r.error.message}`);
  if (r.status !== 0) fail(`${title} failed (exit ${r.status}). Fix the error above and re-run: pnpm bootstrap`);
}

// 1. prerequisites
const major = Number(process.versions.node.split(".")[0]);
if (major < 20) fail(`Node ${process.versions.node} is too old. Install Node 20 or newer, then re-run.`);
const pnpm = spawnSync("pnpm", ["--version"], { encoding: "utf8", shell: isWin });
if (pnpm.status !== 0 || pnpm.error) {
  fail(
    "pnpm is not on your PATH. Enable it once with:\n" +
      "    corepack enable\n" +
      "  (if that fails with EACCES: corepack enable --install-directory \"$HOME/.local/bin\" && export PATH=\"$HOME/.local/bin:$PATH\")\n" +
      "  then re-run: pnpm bootstrap",
  );
}
console.log(`✓ Node ${process.versions.node}, pnpm ${pnpm.stdout.trim()}`);

// 2-4. install, build, browser
run("Installing dependencies", "pnpm", ["install", "--frozen-lockfile"]);
run("Building all packages", "pnpm", ["build"]);
if (!args.has("--no-browser")) {
  run("Installing the Chromium build Playwright drives", "pnpm", ["exec", "playwright", "install", "chromium"]);
}

// 5. smoke test
if (!args.has("--skip-smoke")) {
  run("Smoke test (starts the MCP server and drives a local page)", process.execPath, [
    join(root, "packages/mcp-server/scripts/smoke.mjs"),
  ]);
}

// 6. config snippets
const node = process.execPath;
const bin = join(root, "packages/mcp-server/dist/bin.js");
if (!existsSync(bin)) fail(`Build finished but ${bin} is missing.`);
const q = (s) => (/\s/.test(s) ? `"${s}"` : s);
const desktopConfig = isWin
  ? "%APPDATA%\\Claude\\claude_desktop_config.json"
  : process.platform === "darwin"
    ? "~/Library/Application Support/Claude/claude_desktop_config.json"
    : "~/.config/Claude/claude_desktop_config.json";
const json = JSON.stringify({ mcpServers: { "browser-bridge": { command: node, args: [bin] } } }, null, 2);

console.log(`
✓ Browser Bridge is installed and working.

Connect it to your MCP client (pick one):

  Claude Code:
    claude mcp add browser-bridge -- ${q(node)} ${q(bin)}

  Claude Desktop: add this to ${desktopConfig}
  (merge into "mcpServers" if the file already has one), then quit and reopen Claude Desktop:
${json.replace(/^/gm, "    ")}

  Any other MCP client (stdio): command = ${node}
                                args    = ["${bin}"]

To watch the browser instead of running it headless, add the env var BB_HEADLESS=false.
To drive your own signed-in Chrome instead, see docs/install.md, Part 2.
Check your install at any time with:  pnpm run doctor
`);
