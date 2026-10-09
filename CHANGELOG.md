# Changelog

## 0.1.0 — developer preview (2026-10)

First public release. Install from source; see [docs/install.md](docs/install.md).

### What's in it
- An MCP server with eight tools: `bridge_attach`, `bridge_view`, `bridge_act`,
  `bridge_fill_record`, `bridge_run_pattern`, `bridge_harvest`, `bridge_screenshot`,
  `bridge_confirm`.
- **Isolated-browser mode:** the agent drives its own Playwright Chromium, headless or
  visible.
- **Extension mode (preview):** an MV3 Chrome extension and native-messaging host let the
  agent work in a tab you grant in your own Chrome. It is tested in CI against real Chromium,
  but not yet in many users' Chrome installs.
- **Safety gate:** every session runs under a task grant. High-risk actions are always
  blocked pending a single-use confirmation that the daemon builds. Page content is treated
  as untrusted.
- **Local harvesting:** parallel page collection, limited to the grant's origins and capped
  per origin, with search and export. Content stays on your machine. (The crawl policy
  supports robots.txt rules, but the server does not fetch robots.txt yet.)
- `.mcpb` bundle builder for Claude Desktop (`pnpm build:mcpb`).

### Changed for this release
- **Commons contribution is opt-in and off.** Client consent defaults to off. The hosted
  intake returns 410 unless its operator explicitly enables it.
- `pnpm bootstrap`: one command to install, build, fetch Chromium, run a smoke test and
  print client config.
- `pnpm smoke` and `pnpm doctor` added as root scripts.
- The MCP server now exits when its client disconnects or sends SIGTERM. Before this, it
  left a node and Chromium process running after each client restart.
- The native-messaging launcher pins an absolute Node path, so Chrome can start it when Node
  came from Homebrew, nvm and similar tools.
- `.mcpb` output moved to `dist/browser-bridge.mcpb` (override with `BB_MCPB_PATH`).
- Docs: a new README and install guide. The internal design spec and build logs moved to
  `docs/engineering/`.

### Known limitations
- No approval dialog yet. High-risk actions are blocked, and you do them yourself.
- The agent writes the task grant, so the grant limits mistakes, not a determined model.
- No way for users to store secrets yet.
- Extension mode supports macOS and Linux only.
- Harvested content is kept in memory and is lost when the server restarts.
- No prebuilt release, signed installer or Chrome Web Store listing.
