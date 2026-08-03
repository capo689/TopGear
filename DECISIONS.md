# Browser Bridge — Decisions Log

Every judgment call the plan did not dictate, with a one-line rationale. Newest
section first. Dates are absolute.

## 2026-08-01 — Project setup, standing rules, and §16 resolutions

### Workspace
- **Standing-law file:** renamed `CLAUDE_1.md` → `CLAUDE.md` at repo root so the
  builder instructions auto-load every session.
- **Repo layout:** the TopGear repo root *is* the monorepo root (`apps/`, `packages/`
  live at root), not a nested `browser-bridge/` directory.
- **Git & deploy (standing law, updated 2026-08-01):** GitHub
  `github.com/capo689/TopGear` (private) is the remote — push at every feature/milestone
  boundary. `main` is the Vercel auto-deploy production branch; a milestone lands on
  `main` only after Fable's review (merge = ship). Secrets NEVER enter the repo (INV-4)
  — Vercel env vars only. Codex/GPT is an approved subscription-auth host CLI for live
  acceptance (no API keys, INV-11). **This supersedes and deletes the earlier
  "local-only / no push" note, which was a misread.**

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

### M3 inbox — Fable R1 review finding (folded in M3)
- **Auth tri-state (R1 finding):** DONE — the classifier treats `authStatus` as a
  tri-state; `authenticated` OR absent/unknown → Class B. Only an explicitly-unauthenticated
  public origin is Class C. Real pattern-runner output re-run through
  `runClassificationAudit` (0 leaks, private origin withheld).

### M3 build choices (2026-08-01)
- **Scheduler** is a two-level semaphore governor (global + per-origin) with FIFO
  hand-off; grant budgets (maxPages/maxDownloadBytes) throw `BudgetExhaustedError`;
  exponential backoff has an injectable sleep for deterministic tests. Profile mode clamps
  per-origin to ≤ 2 and refuses bulk.
- **Isolated mode** = a fresh Playwright `BrowserContext` per attach (disposable profile),
  closed with the page. Default attach shares one context (profile mode).
- **Crawl policy** enforces the grant's origin allowlist (covering auth walls: reach them
  only if named) + robots for unauthenticated crawling. The daemon uses the origin
  allowlist; per-origin robots fetching is proven in the runner but not auto-fetched by the
  daemon yet.
- **harvest-store is in-memory** (dedupe by url+content-hash, tokenized TF search, chunked
  export). Class A content is local-only; better-sqlite3 + FTS5 sits behind the same
  interface (same deviation as site-memory).
- **goto_intent** resolves via the site-memory link graph (a HINT, INV-3) and the resolved
  URL passes the SAME destination-origin grant check as a literal goto (Fable M0 #1).
- **8-tool surface complete:** `bridge_run_pattern` + `bridge_harvest` added. No ninth tool.
- **Bonus fix:** `click` refuses a disabled element (backend precheck) — surfaced by the
  widget gauntlet.

## R1 field-fixes (first live dogfood run — Ace, Claude Code/Sonnet 4.6)

- **Select verification matches on value OR label.** The backend already resolves an
  option by either its `value` or its visible text (browser-playwright), so `readState`
  now also returns `selectedLabel` and verify accepts a match on either. Verifying against
  `value` alone false-failed label-requested selects ("Oregon" vs value "OR"). A false
  negative is a correctness-gate defect, not cosmetic.
- **`invalidFields` reads a final re-captured view.** `working` only refreshes on
  page-changing ops, so fills/checks after the last click were invisible to the
  end-of-batch invalid scan. We re-capture once at batch end (skipped on interruption,
  whose own view is already fresh). One extra daemon capture per batch — cheap, and it
  buys an honest invalid report. Turns are unaffected (INV-1 is about MODEL turns).
- **`attach` returns `initialView`.** Default scope `full`, caller-overridable via the
  bridge_attach `scope` field. Collapses attach + first-view into one model turn — the
  live run proved the scripted 2-turn baseline was only true if attach returned a view,
  which it didn't. Additive to `AttachResult`; existing `{sessionId, capabilities}`
  destructures are untouched.

## Wave 1 — arm-before-storage (FINISHER P0s: AUTHZ-01/02, AUTH-01/02, PIPE-02, TEST-01)

- **ed25519 asymmetric verification, NOT HMAC.** Fable's note said "HMAC the payload with
  the device key," but the device identity is already ed25519 (asymmetric). Asymmetric is
  the correct fit: the public key travels in each record, the server verifies with it, and
  no server-side shared secret exists to store or leak. HMAC would require the server to
  hold a per-install secret — strictly worse. The public key is base64 SPKI DER; installId
  = sha256(publicKey).slice(0,16), computed the SAME way on both sides.
- **Derive installId from the verified key; reject body mismatch.** A record whose
  `installId` does not equal `deriveInstallId(publicKey)` is 401. Storage uses the derived
  id, never the body's claim (AUTHZ-01). This closes commons-poisoning (plan T6): you can
  only write under an install whose private key you hold.
- **Verify BEFORE the storage (503) check.** A forger gets 401 whether or not storage is
  configured — no oracle that leaks storage state. Shape/allowlist checks (413/400/422)
  still run first so a malformed body fails fast without crypto.
- **Purge requires a signed ownership proof.** The proof signs `{action:"purge", installId}`
  with the device key; the server derives installId from the proof's key and purges ONLY
  that prefix (AUTHZ-02). `IngestClient.purge(installId)` became `purge(PurgeProof)`.
  Replay note: a captured proof only re-purges the SAME install (whose owner already asked
  to purge) — bounded, non-escalating; a nonce store is deferred (needs durable storage).
- **PIPE-02: read back after PUT.** The contributions endpoint no longer trusts `put.ok`;
  it reads the object back and confirms the stored `installId` matches before 202. Failure
  fails CLOSED (502 → the non-blocking pipeline queues for retry), never a false accept.
  The readback is proven against an in-memory Blob simulator in parity.test; the live
  Vercel Blob response shape is verified when the store is provisioned (Wave 3).
- **Dependency-free Vercel copies.** The ed25519 verification is inlined byte-identically
  in api/contributions.ts + api/purge.ts (Vercel functions cannot import workspace pkgs);
  the shared source of truth is packages/contribution/verify.ts, and parity.test.ts guards
  drift across all status codes for BOTH endpoints.

## Wave 1b — purge replay window + wider installId (Fable wave1 re-review findings)

- **Purge proof carries `issuedAt`; server enforces a ±5 min window.** The signed message
  is now `{action:"purge", installId, issuedAt}`. Without a timestamp the proof was a
  PERMANENT purge capability once observed (logs, retries, crash dumps). The window makes an
  observed proof useless after 5 min. **In-window replay is accepted BY DESIGN** — purge is
  idempotent over the caller's own install (a replayed proof purges 0 more). A server-side
  nonce store (single-use) is deferred: it needs durable storage, and the window already
  bounds the exposure. `issuedAt` is injectable on `purgeProof()` so tests craft
  expired/future proofs; the server always uses its own `Date.now()`.
- **installId widened 64 → 128 bits** (`sha256(publicKey).slice(0,16)` → `slice(0,32)`).
  A 64-bit id gating a destructive purge is a 2^64 second-preimage grind — below standard.
  128 bits puts impersonation out of reach. This is a DELIBERATE pre-storage BREAKING change:
  every derived installId changes, which is free today (no quarantine data) and would be a
  migration once real data exists — exactly why storage was gated behind this wave. The
  Vercel inline `deriveInstallId` copies were widened byte-identically; parity guards drift.
