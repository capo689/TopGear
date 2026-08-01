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
  protocol/   Single source of truth: all cross-boundary types + Zod schemas
  policy/     Daemon-owned enforcement: grants, risk tiers, confirmation capabilities
  audit/      Redacted structured logging with correlation IDs
  evals/      Scorecard metrics, standard workflows, scripted-agent baselines
apps/
  fixture-farm/  Self-hosted gauntlet site the tests drive
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
