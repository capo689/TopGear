# Extension live-load — first pass in real signed-in Chrome (RECORD, don't fix)

This is the biggest genuine unknown left: the MV3 extension loaded in Ace's ACTUAL Chrome,
attached to a REAL signed-in session, driven over the native-messaging relay. It has never
run outside CI's headless proof. **First pass is observation only — run it, record exactly
what breaks, fix nothing.** Independent of the Blob store and of the benchmark (which runs
isolated-mode via the .mcpb on public pages).

Not the `.mcpb` — that bundle is **isolated** Playwright mode. Extension mode is the CLI path
below (`BB_BACKEND=extension`), which starts the daemon's socket relay for the shim to connect.

## Steps

```bash
# from the repo root, after: pnpm install && pnpm build && pnpm exec playwright install chromium
pnpm --filter @browser-bridge/extension build          # → apps/extension/dist
```

1. **Load unpacked:** Chrome → `chrome://extensions` → enable **Developer mode** →
   **Load unpacked** → select `apps/extension/dist`. Copy the **extension ID** (32 lowercase letters).
2. **Register the native host** (writes to Chrome's config dir):
   ```bash
   pnpm --filter @browser-bridge/shim build
   node apps/shim/bin/register-native-host.mjs <EXTENSION_ID>
   ```
3. **Start the daemon in extension mode** via your host CLI:
   ```bash
   claude mcp add browser-bridge --env BB_BACKEND=extension -- node "$(pwd)/packages/mcp-server/dist/bin.js"
   ```
   (It listens on `/tmp/browser-bridge.sock` for the shim instead of launching its own browser.)
4. **Grant Operate:** open a NORMAL tab in your signed-in Chrome (something low-stakes you're
   logged into), click the **Browser Bridge** toolbar button → "Grant Operate on this tab".
5. **One trivial read** — ask the agent, using only `bridge_*` tools:
   > "Attach to this tab and summarize the main heading." (`bridge_attach` + `bridge_view`, no acts.)

## Record (paste this back — do not fix anything on the first pass)

```
Extension live-load — first pass
- Chrome version:
- Extension loaded unpacked:            yes / no   (any errors in chrome://extensions?)
- Native host registered (doctor / file present): yes / no
- Daemon started (BB_BACKEND=extension), "relay listening" line seen: yes / no
- Service worker connected to the native host (chrome://extensions → service worker console): yes / no / errors
- Clicked "Grant Operate", content script injected: yes / no / errors
- bridge_attach on the granted tab:     worked / failed  (paste the exact error / failure JSON)
- bridge_view returned a SemanticView:  worked / failed  (element count? trust.pageContent?)
- Anything in the SW console / daemon stderr / page console:
- First thing that broke (one line):
```

## What's already proven vs. what this measures
- **Proven headlessly (CI):** the full relay data path — daemon → Unix socket → shim/SW/content-script
  → a real Chromium tab → result — with real relay framing (`browser-extension` tests).
- **This measures:** real Chrome loading the MV3 bundle, the native-messaging host actually
  connecting, the service worker adopting the daemon nonce, and a live signed-in tab responding.
  That last mile is the part a repo cannot self-test.
