# Browser Bridge — Decisions Log

Every judgment call the plan did not dictate, with a one-line rationale. Newest
section first. Dates are absolute.

## 2026-08-01 — Project setup, standing rules, and §16 resolutions

### Workspace
- **Standing-law file:** renamed `CLAUDE_1.md` → `CLAUDE.md` at repo root so the
  builder instructions auto-load every session.
- **Repo layout:** the TopGear repo root *is* the monorepo root (`apps/`, `packages/`
  live at root), not a nested `browser-bridge/` directory.
- **Commits:** local only, at package/feature boundaries, no push (user directive).

### Standing rules
- **Toolchain autonomy (user directive):** the builder installs local build
  dependencies itself (corepack/pnpm, npm globals, Playwright browsers, Homebrew,
  rustup, etc.), records each here, and moves on. Stops only for: user
  accounts/credentials (Codex login, Vercel, Apple ID), spend, or changes outside the
  TopGear repo / to system settings. Mirrored in `CLAUDE.md` conventions.

### §16 open decisions
1. **HTTP framework → Hono.** Lighter, loopback-friendly, carries over to edge/serverless.
2. **Dev shim language → Node/TS now; Rust at M6.** The relay chain needs a shim from
   M1; "Rust preferred" refers to the M6 signed production host.
3. **Commons host → Vercel (OVERRIDES earlier Cloudflare default; user directive
   2026-08-01):** ingest serverless function + Vercel Blob for quarantine storage;
   CDN serving at Release 2. Requires the user's Vercel account before any external
   ship — a stop-and-ask item, not a build blocker (local stub until then).
4. **Per-install key → device-bound, revocable.** Simplest revocation; matches §9.2.
5. **Quorum → N=3**, with a curated finance/health/gov sensitive-domain list.
6. **Public-origin classification → reachability probe + curated public-suffix /
   known-public lists + heuristics; classify DOWN (Class B) when unsure.**
7. **Locator ambiguity threshold → top-2 confidence gap < 0.15 returns candidates;**
   tunable in policy config.

### Infrastructure
- **CI → GitHub Actions**, wired when the repo goes remote (currently local-only).
- **commons-ingest → local stub with the identical interface until R1;** real Vercel
  ingest must be live before any external ship (INV-10).

### Evals (INV-11)
- Intelligence for evals comes from scripted agents in CI and subscription-authenticated
  host CLIs (Claude Code present; Codex CLI not yet installed — a stop-and-ask login
  item at the M1 acceptance boundary). No frontier API keys in build/CI/release.

### Toolchain installs (per autonomy rule)
- **pnpm 9.15.9** — installed via `corepack enable --install-directory ~/.local/bin`
  (2026-08-01). `/usr/local/bin` needs sudo, so the shim lives in `~/.local/bin`;
  build commands prepend it to PATH. No sudo, no dotfile edits.
- Dev dependencies pinned in `package.json`: turbo 2.x, typescript 5.7, vitest 2.1,
  zod 3.24. TS config is NodeNext ESM, strict + `noUncheckedIndexedAccess`,
  `verbatimModuleSyntax`. Vitest resolves `.js` specifiers to `.ts` sources natively.

### M0 build choices (2026-08-01)
- **Baselines are two-tier.** Scripted-agent baselines (deterministic, the INV-11 CI
  mechanism) are real, published (`packages/evals/BASELINES.md`), and test-asserted so
  they cannot drift. Live model-driven baselines via host CLIs are captured at M1 when
  the daemon + a driven browser exist — deferred honestly, never faked (Q9).
- **`authorize()` semantics:** high risk ALWAYS requires a fresh single-use
  confirmation capability regardless of the grant's tier ceiling (INV-9);
  `allowedRiskTiers` gates low/medium only. Recorded here because the plan's phrase
  "ceiling for ungated execution" admitted two readings; this is the chosen one.
- **Risk classifier is v0** (conservative escalation on high-intent labels,
  third-party submits, and cross-origin POSTs carrying sensitive values). The full
  all-clicks classifier + network backstop is M5.
