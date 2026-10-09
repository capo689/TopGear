# Browser Bridge

Browser Bridge lets an AI agent use a web browser. It is an
[MCP](https://modelcontextprotocol.io) server: you connect it to Claude Desktop, Claude Code
or another MCP client, and the agent gets eight `bridge_*` tools for opening pages, reading
them, filling forms and clicking.

Instead of screenshots and raw HTML, the agent gets a short structured view of each page
(fields, buttons, sections). It sends whole batches of actions at once. Browser Bridge runs
them locally, checks that each one did what it was supposed to, and tells the agent only
about the ones that went wrong. It stops risky actions such as purchases, deletions or
sending data to another site instead of running them.

> **Status: v0.1 developer preview.** You install it from source, which needs Node and
> pnpm. There is no signed installer and no Chrome Web Store listing yet. See
> [Project status](#project-status).

**Who it's for:** developers and technical users who want an agent to fill forms, read pages
or collect content from many pages, and who are comfortable running a few terminal commands.

## Quickstart (about 60 seconds)

You need **Node 20+**, **git**, and **pnpm** (run `corepack enable` once if `pnpm` isn't
found). macOS and Linux are tested. Windows should work for this mode but has not been tested.

```bash
git clone https://github.com/capo689/TopGear.git browser-bridge
cd browser-bridge
pnpm bootstrap
```

`pnpm bootstrap` installs dependencies, builds everything, downloads the Chromium that
Browser Bridge drives (a few hundred MB, stored in Playwright's cache), and runs a smoke test that
starts the server and fills in a test page. At the end it prints the exact config for your
machine. Use `pnpm bootstrap`, not `pnpm setup`: `pnpm setup` is a different, built-in pnpm
command.

Then connect your client:

| Client | What to do |
|---|---|
| **Claude Code** | Run the `claude mcp add browser-bridge -- …` line that `pnpm bootstrap` printed. |
| **Claude Desktop** | Paste the printed JSON into `claude_desktop_config.json` (on macOS: `~/Library/Application Support/Claude/`), then quit and reopen Claude Desktop. |
| **Other MCP clients** | Add a stdio server with `command` = your `node` path and `args` = `[".../packages/mcp-server/dist/bin.js"]`, as printed. |

Then try a request like: *"Use browser-bridge to open https://example.com and tell me the
main heading."*

By default the agent drives its own **separate, headless Chromium**, which is not signed in
to anything. To watch it work, set `BB_HEADLESS=false` in the server's env. To let the agent
work in **your own signed-in Chrome tabs**, install the extension:
[docs/install.md, Part 2](docs/install.md#part-2--your-own-signed-in-chrome-optional).

## Tools

| Tool | What it does |
|---|---|
| `bridge_attach` | Opens a browser session (optionally at a URL) under a task grant, and returns the first page view. |
| `bridge_view` | Returns a compact view of the page or part of it (forms, content, viewport, invalid fields). |
| `bridge_act` | Runs a batch of actions (fill, click, select, wait, go to a URL…), checks each one, and reports only the ones that failed. |
| `bridge_fill_record` | Fills a whole form from a key/value record in one call. |
| `bridge_run_pattern` | Loads many URLs in parallel in an isolated browser, limited to the grant's origins and capped per origin, and keeps the content locally. |
| `bridge_harvest` | Searches, lists or exports the content `bridge_run_pattern` collected. |
| `bridge_screenshot` | Takes a screenshot of an element, a form, the viewport or the full page, for when the structured view is not enough. |
| `bridge_confirm` | Asks the confirmation UI to show a pending confirmation that Browser Bridge created. It cannot create or describe one. |

## Safety model

Browser Bridge applies these rules itself. They do not depend on the model behaving well.

- **Page content is data, not instructions.** Everything read from a page is marked
  untrusted before the agent sees it.
- **Every session runs under a task grant** that sets which origins it may act on, how risky
  its actions may be, which sites may receive sensitive values, and when it expires. Actions
  outside the grant are refused with an explanation. *Note:* in this preview the agent writes
  the grant when it calls `bridge_attach`, so the grant limits mistakes, not a determined
  model. The checks below apply no matter what the grant says.
- **High-risk actions always stop.** This covers buying, paying, deleting, transferring,
  publishing, sending, submitting a form to a different site, and posting sensitive values to
  another origin. These are never run without a single-use confirmation that Browser Bridge
  creates itself, tied to that exact action, page and moment. The model cannot write what you
  are asked to approve.
  **In v0.1 there is no approval dialog yet,** so these actions are blocked and the agent is
  told so. You do that step yourself in the browser.
- **Logs and errors are redacted.** The runtime can fill secrets by reference, so the value
  never enters the model's context, but v0.1 has no way for you to store a secret yet. Don't
  give the agent passwords. Sign in yourself, in extension mode.
- **Browser Bridge never calls an AI model** and needs no API key. Your MCP client calls it,
  never the other way round.

## Privacy

- **Nothing leaves your machine except your own browsing.** The only network traffic is the
  browser loading the pages you or your agent visit. The MCP server contains no code that
  calls any other server.
- **Harvested content stays local**, in memory, for the life of the server process.
- **Commons contribution is off.** The code includes an opt-in way to share anonymous
  *page structure* (never your content or form values, never data from signed-in or internal
  sites) to help other users. It is off by default, it is not connected in this release, and
  the hosted endpoint does not accept data
  (`/api/contributions` returns 410 unless its operator sets `COMMONS_INGEST_ENABLED=true`).
- **Optional local telemetry:** set `BB_EVAL_LOG=/path/to/file.jsonl` to record turn and
  accuracy metrics to a local file. It is off unless you set it.

## Troubleshooting

Run `pnpm doctor` first. It checks Node, pnpm, Chromium, the extension build, the
native-messaging host and the daemon socket.

| Symptom | Fix |
|---|---|
| `pnpm: command not found` | `corepack enable`. If that fails with EACCES (Node in `/usr/local`): `corepack enable --install-directory "$HOME/.local/bin"` and add that directory to your `PATH`. |
| `pnpm setup` edited your shell profile and did nothing else | That's pnpm's built-in command. Run `pnpm bootstrap`. |
| `Executable doesn't exist … ms-playwright` | `pnpm exec playwright install chromium` |
| Claude Desktop shows the server as failed | Use the **absolute** `node` path that `pnpm bootstrap` printed, because Desktop doesn't see your shell's `PATH`. Check the logs in `~/Library/Logs/Claude/mcp*.log`. |
| The tools work but you can't see the browser | It runs headless by default. Set `BB_HEADLESS=false` in the server's `env`. |
| The agent reports `capability_required` / `confirmation_required` | That's the safety gate (see above). Do that step yourself. |
| Extension mode: nothing happens when you click the toolbar button | See [docs/install.md, Part 2](docs/install.md#part-2--your-own-signed-in-chrome-optional). The server must be running with `BB_BACKEND=extension`, and the native host must be registered with your extension ID. |
| You changed the code and nothing changed | Run `pnpm build`, then restart your MCP client so it restarts the server. |

## Project status

**Works today, and tested in this repo:** the isolated-browser mode end to end (all eight
tools, form filling with verification, harvesting, the safety gate). There are 273 automated
tests, including real-Chromium suites. The repo's smoke test drives the MCP server over
stdio exactly as a client does, and the `.mcpb` bundle passes `mcpb validate`.

**Works, but not yet verified on a user's machine:** the Chrome extension mode (your
signed-in tabs). Every link from the server to the tab is tested in CI against real Chromium,
except Chrome itself loading the unpacked extension and launching the native-messaging host.
Installing the `.mcpb` bundle into Claude Desktop has also not been verified.

**Not there yet:** a downloadable release (`.mcpb` or installer), a Chrome Web Store
listing, an approval dialog for high-risk actions, grants set by the user rather than the
agent, Windows support for extension mode, and persistent harvest storage.

## Repository layout

```
packages/      the runtime: protocol types, policy, semantic engine, execution, daemon, MCP server, …
apps/          extension (MV3), shim (native-messaging host), cli (doctor), inspector-ui,
               fixture-farm (test site), commons-ingest (commons intake, off)
api/, public/  the hosted commons endpoint (Vercel); not needed to run Browser Bridge
scripts/       setup, .mcpb builder, release gates
docs/          install guide; docs/engineering/ has the design spec and build logs
```

## Develop

```bash
pnpm build        # build every package (turbo)
pnpm typecheck
pnpm test         # unit + real-Chromium suites (run `pnpm exec playwright install chromium` first)
pnpm smoke        # end-to-end check of the built MCP server
pnpm build:mcpb   # package the server as dist/browser-bridge.mcpb
```

See [CONTRIBUTING.md](CONTRIBUTING.md) to contribute and [SECURITY.md](SECURITY.md) to report a
vulnerability. The design spec and engineering history are in
[docs/engineering/](docs/engineering/README.md).

## License

[Apache-2.0](LICENSE). Copyright 2026 Adam R. Cagle.

Built by [Adam R. Cagle](https://adamcagle.com).
