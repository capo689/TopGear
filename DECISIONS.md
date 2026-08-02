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

### M1 build choices (2026-08-01)
- **Backend abstraction:** the execution engine drives a `BrowserBackend` interface
  (`packages/backend`). M1 ships the CDP/Playwright implementation as both the isolated
  and attach backend; the extension relay is the second implementation. This let M1's
  acceptance be verified end-to-end in CI against real Chromium.
- **Element identity:** the extractor stamps a `data-bb-ref` attribute so primitives can
  target elements by ref; identity for re-resolution is the scored fingerprint (refs are
  caches). The attribute is a small, contained DOM mutation within the automation
  contract.
- **Human-approval gate on confirmations:** `CapabilityStore.mintPending` +
  `approve` + `consume`. A high-risk action mints a PENDING capability (daemon-authored);
  only the confirm UI can `approve`; the model re-issues with the id after approval.
  Preserves INV-9 (model cannot self-authorize) and is testable.
- **Risk classifier refinement:** "submit"/"save"/"continue"/"confirm" removed from the
  high-intent token set — a same-origin submit is medium, not high (it was over-gating
  every form). High = financial/destructive/publish-send, or a third-party submit.
- **Content-script input path:** user-action emulation (synthetic events) for M1;
  CDP trusted input is the separately-consented deep-control mode (M2 opt-in).
- **inspector-ui:** Vite + React per Q7. M1 implements the confirm dialog (the security
  surface); the full inspector shell is later.
- **Fable M0 findings folded:** goto destination-origin check (#1), hard-404 traversal
  test (#2), digit-gated blob scrubber (#3).

### M2 build choices (2026-08-01)
- **Widget detection** is heuristic over class/attribute signatures (react-select,
  Radix `data-radix-*`, MUI, Ant, headlessui, downshift) + ARIA autocomplete for
  typeahead. The shared ARIA combobox playbook drives them all (the positioning claim);
  bespoke per-library fixtures + virtualized lists are progressive hardening.
- **Element refs are globally unique** via a page-persistent `window.__bbRefSeq` counter.
  Resetting per-capture collided new elements with prior refs — a real correctness bug
  the widget gauntlet caught.
- **`click` refuses a disabled element** (backend precheck) instead of timing out.
- **fill_record matching** is deterministic token-Jaccard over accessible name +
  autocomplete + stable id/name (INV-11, no model); ambiguity returns candidates.
- **site-memory is in-memory for M2**; the better-sqlite3 persistent store implements the
  SAME `SiteMemoryStore` interface and is deferred to keep CI free of native builds. This
  is a temporary deviation from the "better-sqlite3" stack line, recorded here honestly.
- **CDP deep-control**: the Playwright backend already dispatches trusted CDP input; the
  extension `chrome.debugger` opt-in (separately consented) is a permission-ladder item,
  not separately implemented at M2.
- **commons-ingest** is a local HTTP stub with the exact routes the Vercel endpoint will
  serve (`POST /contributions`, `POST /purge`); the `HttpIngestClient` is unchanged when
  the real endpoint lands.
- **Fable M1 findings folded:** real read-back for click/set_date/expand (#1), two
  M5-inherited `it.fails` fixtures (#2), CI Chromium install step (#3).
