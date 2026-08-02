# Browser Bridge

A model-agnostic runtime that lets any AI operate a browser at machine speed. The
browser already knows what every field, button, and section is; Browser Bridge exposes
that as compact structured data, accepts intent in batches, executes and verifies
locally, and consults the model only for decisions that require intelligence.

- **Spec:** [`browser-bridge-build-plan-v2.md`](./browser-bridge-build-plan-v2.md) (authoritative)
- **Standing law:** [`CLAUDE.md`](./CLAUDE.md)
- **Decisions log:** [`DECISIONS.md`](./DECISIONS.md)
- **Milestone status:** [`MILESTONE_STATUS.md`](./MILESTONE_STATUS.md)

## Layout

```
packages/
  protocol/          Single source of truth: all cross-boundary types + Zod schemas
  policy/            Enforcement: grants, risk tiers, confirmation capabilities, reflexes
  audit/             Redacted structured logging with correlation IDs
  secrets/           SecretRef broker (values never reach model context)
  semantic-engine/   DOM+a11y+layout → compact SemanticViews; hidden-content; staleness
  backend/           The BrowserBackend contract the execution engine drives
  browser-playwright/ CDP/Playwright backend implementation
  locators/          Fingerprint scoring, re-resolution, ambiguity arbitration
  widget-patterns/   Widget playbooks (native + custom combobox)
  execution/         Batch engine: resolve → authorize → act → verify → audit
  daemon/            Session registry + gateway; binds grants, capability handshake
  mcp-server/        MCP surface: the 5 M1 tools over the daemon
  relay/             Extension relay contract; Zod-validated at every hop
  site-memory/       Per-origin widget cache; patterns are hints, verified live (INV-3)
  contribution/      Class A/B/C classifier, anonymize, sign, telemetry, viewer, kill switch
  evals/             Scorecard metrics, standard workflows, scripted-agent baselines
apps/
  fixture-farm/      Self-hosted gauntlet site the tests drive
  extension/         MV3 content script + service-worker relay
  shim/              Dev native-messaging host
  inspector-ui/      Confirm dialog (renders the daemon's words, not the model's)
  commons-ingest/    Quarantine intake (R1 stub; Vercel at ship)
  cli/               browser-bridge doctor
```

## Develop

```bash
corepack enable          # provides pnpm
pnpm install
pnpm build               # turbo: build every package
pnpm typecheck
pnpm test                # unit suites + fixture-farm smoke
```

Requires Node 20+. Licensed under Apache-2.0.
