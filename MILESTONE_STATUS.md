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

## M1 — Semantic core with enforcement live — NOT STARTED

Blocked on M0 external review.
