# Installing Browser Bridge

There are two ways to run it:

- **Part 1, isolated browser (recommended to start).** The agent drives its own Chromium,
  separate from your browser and not signed in to anything. No extension needed.
- **Part 2, your own signed-in Chrome (optional).** Adds a Chrome extension so the agent can
  work in tabs you choose, with your logins.

Each step below is marked **Verified** (run end to end on a clean checkout while preparing
this release, on macOS with Node 24) or **Not verified here** (needs your real Chrome or
Claude Desktop, so it could not be tested from the repo).

## Requirements

- Node.js 20 or newer
- git
- pnpm 9. It ships with Node: run `corepack enable` once. If that fails with `EACCES`
  (common when Node lives in `/usr/local`), run
  `corepack enable --install-directory "$HOME/.local/bin"` and add `$HOME/.local/bin` to
  your `PATH`.
- About 1 GB of free disk: about 200 MB for dependencies, plus Playwright's Chromium builds
  (about 550 MB unpacked, in Playwright's shared cache).
- For Part 2: Google Chrome 116 or newer, on macOS or Linux.

---

## Part 1 — isolated browser

### 1. Install (Verified)

```bash
git clone https://github.com/capo689/TopGear.git browser-bridge
cd browser-bridge
pnpm bootstrap
```

`pnpm bootstrap` (`scripts/setup.mjs`) runs these steps and stops at the first failure:

1. checks Node ≥ 20 and that `pnpm` is on your `PATH`
2. `pnpm install --frozen-lockfile`
3. `pnpm build`
4. `pnpm exec playwright install chromium`
5. `pnpm smoke`: starts the MCP server over stdio, lists the 8 tools, opens a local test
   page, fills a field and reads it back
6. prints the config for Claude Code, Claude Desktop and other MCP clients, using the
   absolute paths on your machine

It writes nothing outside the checkout except Playwright's browser cache, and it never edits
your MCP client's config. (`pnpm setup` is a pnpm built-in that does something else, so the
command is called `bootstrap`.)

To run the steps by hand instead:

```bash
pnpm install
pnpm build
pnpm exec playwright install chromium
pnpm smoke
```

### 2. Connect your MCP client

Use the absolute `node` path and server path that `pnpm bootstrap` printed. GUI apps such as
Claude Desktop don't inherit your shell's `PATH`, so a bare `node` often fails there.

**Claude Code** (Verified: `claude mcp get browser-bridge` reports *Connected*):

```bash
claude mcp add browser-bridge -- /absolute/path/to/node /absolute/path/to/browser-bridge/packages/mcp-server/dist/bin.js
```

**Claude Desktop** (Not verified here). Edit `claude_desktop_config.json`:
macOS `~/Library/Application Support/Claude/`, Windows `%APPDATA%\Claude\`. Add the
following, merging it into `mcpServers` if that key already exists:

```json
{
  "mcpServers": {
    "browser-bridge": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/browser-bridge/packages/mcp-server/dist/bin.js"]
    }
  }
}
```

Quit Claude Desktop completely and reopen it. The tools appear under the connectors/tools
menu.

**Other MCP clients** (Codex, Cursor, etc.): register a **stdio** server with the same command
and argument. For example, `codex mcp add browser-bridge -- /path/to/node /path/to/bin.js`.

### 3. Options (environment variables)

| Variable | Default | Effect |
|---|---|---|
| `BB_HEADLESS` | `true` | `false` shows the browser window so you can watch. |
| `BB_EVAL_LOG` | unset | A file path. Writes local JSONL metrics (turns, accuracy). Off when unset. |
| `BB_BACKEND` | unset | `extension` switches to Part 2 mode. |
| `BB_SOCKET` | `/tmp/browser-bridge.sock` | Socket the extension shim connects to (Part 2). Keep it short: Unix socket paths are limited to about 100 characters. |

Example: `claude mcp add browser-bridge --env BB_HEADLESS=false -- /path/to/node /path/to/bin.js`

### 4. Check it

```bash
pnpm doctor
```

In isolated mode, expect `✓` for node, platform, pnpm and chromium. The `!` lines for
daemon and native-host only matter for Part 2.

### Alternative: a `.mcpb` bundle for Claude Desktop (Bundle verified; install not verified here)

```bash
pnpm build:mcpb          # → dist/browser-bridge.mcpb
```

The bundle contains the server and Playwright, but not Chromium. Install Chromium once with
`pnpm exec playwright install chromium`, or, on a machine without the repo, with
`npx playwright@<version> install chromium` (the version is in the bundle's description). In
Claude Desktop, open the `.mcpb` file (double-click it, or drag it into Settings →
Extensions). The bundle passes `mcpb validate`, and its server passes `pnpm smoke` when
unpacked. Installing it into Claude Desktop has not been tested. No prebuilt `.mcpb` is
published yet.

---

## Part 2 — your own signed-in Chrome (optional)

In this mode the MCP server doesn't launch a browser. It waits on a local socket for the
extension. You choose which tab the agent may use by clicking the extension's toolbar button
on that tab. Harvesting (`bridge_run_pattern`) always uses a separate isolated browser.

Supported on macOS and Linux. The native-host registration script does not support Windows.

### 1. Build (Verified)

`pnpm bootstrap` (or `pnpm build`) already builds the extension to `apps/extension/dist` and
the native-messaging shim to `apps/shim/dist`.

### 2. Load the extension in Chrome (Not verified here)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `apps/extension/dist` folder.
4. Copy the extension's **ID**: 32 lowercase letters shown on its card.

### 3. Register the native-messaging host (Script verified; Chrome launching it not verified here)

```bash
node apps/shim/bin/register-native-host.mjs <EXTENSION_ID>
```

This writes `com.browser_bridge.shim.json` to Chrome's `NativeMessagingHosts` folder
(`~/Library/Application Support/Google/Chrome/NativeMessagingHosts` on macOS,
`~/.config/google-chrome/NativeMessagingHosts` on Linux). It also writes a launcher in
`apps/shim/dist` that pins the absolute path of your `node`, because Chrome starts native
hosts with a minimal `PATH`. If you move the repo or change Node versions, run it again.

### 4. Run the server in extension mode (Verified: the server starts and listens; the shim launcher connects to it with an empty environment)

```bash
claude mcp add browser-bridge --env BB_BACKEND=extension -- /path/to/node /path/to/browser-bridge/packages/mcp-server/dist/bin.js
```

For Claude Desktop, add `"env": { "BB_BACKEND": "extension" }` to the server entry. Use one
mode per registration. To keep both, register this one under a different name, such as
`browser-bridge-chrome`.

### 5. Grant a tab (Not verified here)

Open the tab you want the agent to use and click the **Browser Bridge** toolbar button
(tooltip: "Grant Operate on this tab"). Then ask your agent to attach to it, for example:
*"Use browser-bridge to attach to my current tab and summarize the main heading."*

`pnpm doctor` should now show `extension ✓`, `native-host ✓` and, while your client is
running, `daemon ✓`.

### If it doesn't work

- **chrome://extensions shows errors on the card:** rebuild with `pnpm build` and click the
  reload icon on the card.
- **The service worker can't reach the native host:** check that the ID you registered matches
  the card exactly, then run step 3 again. Open the extension's *service worker* console from
  its card to see the error.
- **"daemon not running":** the MCP client has to be running with `BB_BACKEND=extension`;
  the server only listens while the client keeps it alive.
- Please [open an issue](https://github.com/capo689/TopGear/issues) with your Chrome
  version, OS, the service-worker console output and the MCP server's stderr. Extension mode
  is the least-tested part of this release, so these reports are useful.

---

## Updating

```bash
git pull
pnpm bootstrap      # or: pnpm install && pnpm build
```

Then restart your MCP client. In Part 2, also click reload on the extension's card in
`chrome://extensions`.

## Uninstalling

- Remove the server from your client: `claude mcp remove browser-bridge`, or delete the entry
  from `claude_desktop_config.json`.
- Part 2: remove the extension in `chrome://extensions` and delete
  `com.browser_bridge.shim.json` from the `NativeMessagingHosts` folder above.
- Delete the checkout. To reclaim Chromium's disk space, delete Playwright's cache
  (`~/Library/Caches/ms-playwright` on macOS, `~/.cache/ms-playwright` on Linux). Other
  Playwright projects use that cache too.
