# Milestone Status

Honest acceptance evidence per milestone. Never game a test or metric — an honest fail
with a note beats a dishonest pass. Test counts are from `pnpm test` (Turbo).

---

## M0 — Foundations, baseline, and security skeleton — COMPLETE (pending external review)

**Release target:** none (M0 gates M1). **Built on:** 2026-08-01.

### Acceptance criteria

| Criterion | Status | Evidence |
|---|---|---|
| Protocol versioned | ✅ PASS | `SCHEMA_VERSION = "0.1.0-m0"`; §4 shapes complete in `packages/protocol` (envelope, semantic view, locator fingerprint, actions incl. recursive `if`, TaskGrant, ConfirmationCapability, typed failures, caps). 22 tests. |
| Policy + audit unit suites green, incl. capability single-use / TTL / revision-binding | ✅ PASS | `packages/policy` 27 tests; `capability.test.ts` covers single-use (burn-once), TTL expiry, revision-mismatch, origin-mismatch, unknown-id; `grant.test.ts` covers the high-risk confirmation flow, replay-block, and out-of-revision rejection. `packages/audit` 12 tests. |
| Fixture farm in CI | ✅ PASS (see note) | `apps/fixture-farm` served + smoke-tested (`server.test.ts`, 5 tests); `.github/workflows/ci.yml` runs build + typecheck + test (incl. fixture farm). **Note:** CI config is wired but not yet *exercised on GitHub* — the repo is local-only per user directive (no push). It will run on first push. |
| Baselines published in-repo | ⚠️ PARTIAL — honest split | **Scripted tier is real and published:** `packages/evals/BASELINES.md` + `harness.test.ts` measure & assert the turn matrix (20-field form: bridge 2 turns vs screenshot-loop 21 = 10.5×). **Live model-driven tier is deferred to M1** — it needs the daemon + a driven browser, and per INV-11 runs through host CLIs (Claude Code / Codex), not API keys. Not faked; flagged here. |

### What was built

- Monorepo scaffold: pnpm + Turborepo, shared `tsconfig.base`, Apache-2.0 license, `.gitignore`, CI workflow.
- `@browser-bridge/protocol` — all cross-boundary Zod schemas + inferred types; cap-enforcement helpers.
- `@browser-bridge/policy` — grant binding/checking, risk-tier classifier v0 (runs on all clicks + network backstop), capability mint/consume (nonce + TTL + revision), consent-aware reflex allowlist. Model-free (INV-11).
- `@browser-bridge/audit` — redacted structured logging, correlation IDs, two-layer value stripping.
- `@browser-bridge/evals` — scorecard metrics + gate ordering, the 8 standard workflows, scripted agents, turn-baseline harness.
- `@browser-bridge/fixture-farm` — self-hosted gauntlet: 20-field form, dependent selects, native + custom selects, present/lazy accordions, injection page, grant-escape page.

### Test tally

76 tests across 5 packages, all green: protocol 22, policy 27, audit 12, evals 10, fixture-farm 5.

### Known gaps / honest notes (Q9)

1. **Live baselines** (screenshot-loop + Playwright-MCP via host CLIs) are captured at M1, not M0 — they require the daemon and a driven browser. The scripted tier stands in and is test-verified now.
2. **CI is unexercised** until the repo is pushed (local-only by directive). The workflow is correct but has not run on GitHub.
3. **Codex CLI is not installed** — needed for M1's "one OpenAI-based agent" acceptance criterion (a stop-and-ask login item at the M1 boundary).
4. **Vercel account** is needed before any external ship at R1 (M2 boundary); the dev build uses a local ingest stub until then.
5. Extension, dev shim, MCP server, and semantic engine are **M1** scope — not M0 gaps.

### Reviewer notes (for Fable)

- Highest-value scrutiny: `packages/policy` (the enforcement core) and `packages/protocol` (the wire contract everything re-validates against).
- The risk classifier is deliberately **v0** and conservative; the full all-clicks classifier + network backstop is M5. Confirm the v0 escalation heuristics don't *under*-classify.
- `authorize()` treats high risk as never-ungated regardless of the grant's tier ceiling (INV-9). Confirm that reading of "allowedRiskTiers = ceiling for ungated execution" is right.
- Baseline turn model for scripted agents encodes assumptions about each tool class; confirm they are fair stand-ins before M1 measures live.

---

## M1 — Semantic core with enforcement live — COMPLETE (pending external review) → R0

**Release target:** R0 internal dogfood. **Built on:** 2026-08-01. M0 gate: PASS (Fable).

### Acceptance criteria

| Criterion | Status | Evidence |
|---|---|---|
| 20-field native form ≤ 3 turns | ✅ VERIFIED (scripted-over-real-stack); ⚠️ live host-CLI pending | `execution/src/execution.e2e.test.ts` "20-field form in ONE batch": **attach + one `act` batch = 2 turns**, all 22 actions verified against real Chromium, values never in audit. **Live `from Claude Code AND Codex` host-CLI runs are the carried watch-item** — Claude Code CLI present; **Codex CLI not installed (a credentials decision, below).** |
| Dependent-select as one batch with embedded wait | ✅ VERIFIED | `execution.e2e.test.ts` + `browser-playwright/src/backend.test.ts` (real 250ms async enable bridged by a wait). |
| Injection fixture blocked with a gullible scripted model | ✅ VERIFIED | `execution.e2e.test.ts` "prompt injection is blocked": a model doing exactly what the page says gets the cross-origin submit gated behind confirmation; no navigation to evil. |
| Confirmation-spoofing impossible (no self-authored / reused / out-of-revision capability) | ✅ VERIFIED | `execution.e2e.test.ts` (daemon-authored summary, approve→allow, replay→blocked; fabricated id rejected) + `policy/src/capability.test.ts` (pending-approval, revision-mismatch, single-use). |
| Grant-escape fails with teaching errors | ✅ VERIFIED | `execution.e2e.test.ts` (goto to non-granted origin → `grant_denied`) + `policy/src/grant.test.ts` (origin + tier escape). |
| Beat both baselines ≥ 3× on turns, gates clean | ✅ VERIFIED (honest live number quoted) | The 20-field form runs end-to-end in **2 turns** on the real stack vs screenshot-loop 21 / playwright-mcp 22 (~10×), gates clean (all verified, no unsafe action in the tested fixtures). **2 turns is the quoted honest number**, not the optimistic scripted 10.5× (Fable watch-item 5). |

### What was built

semantic-engine (in-page extractor, hidden-content reading, scoped-staleness) · backend contract · browser-playwright (CDP backend) · locators (scoring, re-resolution, ambiguity) · execution engine (resolve → authorize → act → verify → audit; embedded waits; `if`; confirmation interruptions; navigation detection) · widget-patterns (native + custom combobox) · secrets broker · daemon (session registry, grant binding, capability handshake) · mcp-server (5 tools) · relay (Zod at every hop) · extension (MV3 content script + SW) · shim (dev native host) · inspector-ui (confirm dialog).

### Test tally

**120 tests, all green.** New in M1: semantic-engine 6, browser-playwright 4, locators 6, execution E2E 6, secrets 3, daemon 5, mcp-server 6, relay 5, inspector-ui 2.

### Fable M0 findings — disposition

1. **goto_intent / destination origin** — ✅ addressed: `goto` now checks the *destination* origin against the grant (`grant_denied` on escape). `goto_intent` real resolution remains M3 (returns `widget_unrecognized` for now, honestly).
2. **Path-traversal test** — ✅ fixed: the fixture-farm test now hard-404s both plain and encoded traversal.
3. **Audit over-redaction** — ✅ addressed: the long-blob scrubber now only redacts 24+ char runs containing a digit, sparing correlation-id labels and URL path words.

### Known gaps / honest notes (Q9) — carried into R0

1. **Live host-CLI acceptance** (Claude Code + Codex driving the MCP server over stdio against a real browser) is **not in CI** — it needs the MCP registration, an interactive session, and **Codex credentials**. The MCP server is built and handler-tested; the scripted-over-real-stack turn count (2) is verified. This is the watch-item 4 obligation for R0.
2. **Extension live path** (signed-in Chrome load-unpacked + native-messaging round trip): the relay **validation core is verified** (`relay` tests); the live load is manual. Content-script input is user-action emulation (synthetic events); CDP trusted input is the separately-consented deep-control mode (M2 opt-in).
3. **Unix-socket daemon listener**: the shim↔daemon socket client is written; the daemon's socket *listener* is not yet wired (the daemon exposes MCP stdio + in-process API, and the CDP backend proves the full execution path today). Small addition, flagged.
4. **inspector-ui**: the confirm-rendering logic is verified; the full Vite+React shell (sessions/audit/contribution viewer) is minimal — the contribution viewer is M2 anyway.

### Reviewer notes (for Fable)

- Highest scrutiny: `execution/src/session.ts` (the integrator: authorize on *every* action, read-back verification, confirmation interruption + navigation detection) and the extension trust boundary (`relay/src/validate.ts`).
- Risk classifier was refined this milestone: a same-origin "Submit" is **medium**, not high (it was over-escalating every form). High is financial/destructive/publish-send or third-party submit. Confirm this reads correctly.
- The confirmation flow now has an explicit human-approval gate (`mintPending` → `approve` → `consume`); confirm the model cannot approve its own capability by any path.

---

## M2 — Widgets, fill_record, collection — NOT STARTED

Blocked on M1 external review. First item at the boundary: the **Codex credentials decision** for the live "OpenAI-based agent" acceptance.
