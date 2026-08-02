# Browser Bridge — dev-channel install

Two paths. **Path A (isolated browser)** gets you driving a browser from your agent in
~5 minutes, no extension. **Path B (your signed-in Chrome)** adds the extension so the
agent operates your real, logged-in tabs. Path B's final step (loading the extension in
real Chrome) is the one thing this repo can't verify for you — the exact steps and a
report-back template are at the bottom.

Requires **Node 20+**, **Google Chrome**, and **git**. (This is the dev channel — a
single signed installer is M6.)

### Prerequisite: pnpm via corepack

This repo pins **pnpm 9.15.9** through corepack. If `pnpm` is not on your PATH (it isn't
by default on a fresh machine — the first live tester hit exactly this), enable it once:

```bash
corepack enable
corepack prepare pnpm@9.15.9 --activate
```

If `corepack` itself isn't found, it ships with Node — `npm i -g corepack` restores it.
The activated pnpm shim lives under corepack's bin dir (often `~/.local/bin` or
`~/Library/pnpm`); make sure that's on your PATH for the commands below.

---

## Path A — isolated browser (5 minutes, no extension)

```bash
git clone https://github.com/capo689/TopGear.git browser-bridge
cd browser-bridge
corepack enable
pnpm install
pnpm build
pnpm exec playwright install chromium
```

**Already have the repo cloned?** Don't re-clone — refresh and rebuild in place:

```bash
cd browser-bridge        # your existing checkout
git pull
pnpm install             # no-op if deps unchanged
pnpm build               # turbo-cached; rebuilds only what changed
pnpm exec playwright install chromium   # no-op if already installed
```

Register the MCP server with your host CLI (one line):

```bash
# Claude Code
claude mcp add browser-bridge -- node "$(pwd)/packages/mcp-server/dist/bin.js"
# or Codex
codex mcp add browser-bridge -- node "$(pwd)/packages/mcp-server/dist/bin.js"
```

Verify the chain:

```bash
node apps/cli/dist/cli.js doctor
```

You should see `node ✓`, `chromium ✓`. Now ask your agent to use `bridge_attach` /
`bridge_view` / `bridge_act` against any URL. The daemon drives an isolated headless
Chromium. Done.

---

## Path B — your signed-in Chrome (the extension)

This lets the agent operate your real, logged-in tabs. Build + load the extension, then
register the native-messaging shim.

**1. Build and load the extension.**

```bash
pnpm --filter @browser-bridge/extension build     # → apps/extension/dist
```

In Chrome: `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
select `apps/extension/dist`. Copy the extension's **ID** (32 lowercase letters).

**2. Register the native-messaging host** (writes to Chrome's config dir — run it yourself):

```bash
pnpm --filter @browser-bridge/shim build
node apps/shim/bin/register-native-host.mjs <EXTENSION_ID>
```

**3. Register the MCP server in extension mode** and start it via your host CLI:

```bash
claude mcp add browser-bridge --env BB_BACKEND=extension -- node "$(pwd)/packages/mcp-server/dist/bin.js"
```

(`BB_BACKEND=extension` makes the daemon listen on `/tmp/browser-bridge.sock` for the
shim instead of launching its own browser.)

**4. Grant Operate.** Open a normal tab in your signed-in Chrome, click the **Browser
Bridge** toolbar button ("Grant Operate on this tab"). The service worker injects the
content script and connects the shim to the daemon. The agent can now drive *that* tab.

**5. Verify:**

```bash
node apps/cli/dist/cli.js doctor        # extension ✓, native-host ✓, daemon ✓ (once running)
```

### What's already proven vs. what you're verifying

- **Proven headlessly (in CI):** the semantic engine, execution + policy, the 8 tools, and
  the *entire relay data path* — daemon → Unix socket → (shim/SW/content-script) → tab →
  result — with real relay framing and validation (`browser-extension` tests). GPT drove
  the bridge live and the safety gate held.
- **You're verifying:** that real Chrome loads the MV3 bundle, the native-messaging host
  connects, and a real signed-in tab responds. That's the one link a repo can't self-test.

### Report-back template (paste results here)

```
Extension live-load report
- Chrome version:
- Extension loaded unpacked:           yes / no   (errors?)
- Native host registered (doctor):     yes / no
- Daemon started (BB_BACKEND=extension): yes / no
- Clicked "Grant Operate":             yes / no
- Agent bridge_attach + bridge_view on the granted tab: worked / failed (paste error)
- Filled/submitted a form on a real site: worked / failed
- Anything surprising:
```

Send that back and I'll turn any failure into a fix. See `DOGFOOD.md` for a guided first
real-site session that captures turns/accuracy into field-data rows.
