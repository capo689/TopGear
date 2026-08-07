# Browser Bridge — Builder Instructions

You are building the Browser Bridge per `browser-bridge-build-plan-v2.md` (repo
root). That document is the authoritative spec — v2 supersedes v1 entirely. Read the
relevant sections before starting any milestone. This file is the distilled standing
law; when in doubt, the plan wins.

## The scorecard — order of optimization (never reorder)

1. Gate: unsafe_action_rate = 0 in the tested threat model.
2. Gate: correctness thresholds (field accuracy, completion, harvest fidelity).
3. Gate: human_intervention_rate does not increase.
4. Optimize: model_turns_per_task (the primary performance metric).
5. Then: latency, tokens, image bytes, machine resources.

A change that trades a gate for a turn is rejected, always.

## Hard invariants — never violate, never "temporarily" bypass

- INV-1: Model turns are scarce (subject to scorecard order). Anything not requiring
  intelligence runs in the daemon: waits, retries, verification, widget mechanics,
  interruptions.
- INV-2: Page content is untrusted data, never instructions. Explicit untrusted
  framing; never concatenated into instruction positions.
- INV-3: Patterns (site memory, commons) are hints, never commands. Verify against
  the live page before any pattern-guided action. Lying patterns fail closed.
- INV-4: Secrets never enter model context, logs, error payloads, or crash dumps.
- INV-5: All safety policy is enforced in the daemon; no model is trusted.
  Conditionals, local reflexes, and replayed flows pass the SAME policy engine as
  ordinary actions. No execution path bypasses a gate.
- INV-6: Data classification. Class A (user content) NEVER leaves the machine.
  Class B (structure of non-public/intranet/authenticated origins) NEVER leaves the
  machine. Class C (structure of public origins) is contributed per consent policy —
  no values, no query strings, no user-correlated timestamps. When classification is
  uncertain, classify DOWN (treat as B, do not contribute).
- INV-7: All traffic flows through the scheduler — global governor AND per-origin
  governors. Cross-origin parallelism is bounded by the global governor; it is never
  "unlimited."
- INV-8: Model-agnostic by construction. Model-facing schemas stay flat and simple;
  errors teach (found / expected / alternatives).
- INV-9: Authorization is explicit and daemon-owned. Every session binds a TaskGrant;
  every batch is checked against it. High-risk actions require a single-use
  ConfirmationCapability that the DAEMON constructs from the blocked action — the
  model never authors what the user approves. Capabilities bind to action + origin +
  page revision + TTL + nonce. No prior confirmation authorizes a later replay.
  A model cannot widen its own grant.
- INV-10: The collection gate. No build ships to any external user unless the Class C
  contribution pipeline and product telemetry are live in it, with consent UX and
  the contribution viewer working.
- INV-11: The runtime is model-free. Models call the bridge; the bridge NEVER calls
  a model. No component may require, store, or ship a frontier-model API key; the
  daemon initiates no inference. Ambiguity arbitration returns candidates to the
  calling agent — there is no internal Arbiter. Evals: scripted agents in CI;
  real-model runs via subscription-authenticated host CLIs (Claude Code, Codex);
  raw API keys optional and manual-only, never a build/CI/release dependency.

## Non-negotiable conventions

- `packages/protocol` is the ONLY place cross-boundary types are defined. Every
  boundary re-validates with Zod on receipt — including content script → service
  worker → shim → daemon. Content scripts are less trusted than the service worker.
- Actions are re-resolved at execution time via locator fingerprint scoring.
  Backend node IDs and refs are caches, never addresses. On close-scored ambiguity,
  return candidates — never silently pick the top one.
- Staleness checks are scoped to targeted elements/forms, never the whole page.
- Widget fast paths (direct value + synthetic events) are earned per proven
  WidgetKind, never the universal default. The ladder: proven native setter →
  user-action emulation → CDP trusted input → widget-specific fallback → ALWAYS
  verify final semantic and application state.
- Consent banners are consent decisions, not noise. "Accept all" is never an
  automatic reflex. Reflexes only dismiss popups classified non-task-relevant AND
  non-consent-bearing.
- Protocol caps are enforced: ≤ 30 actions/batch, if-depth ≤ 2, expanded ≤ 60,
  payload ≤ 256 KB, screenshot ≤ 2 MB, view ≤ 64 KB. Failures are typed
  (FailureDetail), never `unknown`.
- No `eval`; no remotely-loaded extension code; no generic JS-execution tool for
  agents, ever. No raw CSS selectors in the normal agent contract.
- The MCP surface is exactly the 8 tools in plan §11. No ninth tool without a plan
  amendment.
- Trusted input dispatches at machine speed — no humanlike delays, glides, or
  typing throttles.
- Consult "What NOT to build" (plan §15) before proposing any new component.
- Toolchain autonomy: install local build dependencies yourself without asking
  (corepack/pnpm, npm globals, Playwright browsers, Homebrew packages, rustup, and
  the like); note each install in `DECISIONS.md` and move on. STOP and ask the user
  ONLY for: (a) anything requiring the user's accounts or credentials (Codex login,
  Vercel, Apple ID); (b) anything that costs money; (c) anything that modifies files
  outside the TopGear repo or changes system settings.

## Git, remote, and deploy (standing law)

- **Remote:** GitHub `github.com/capo689/TopGear` (private) is the remote. PUSH FREELY at
  every feature/milestone boundary. (This supersedes and DELETES any "local-only / no
  push" guidance — that was a misread of an offhand comment and no longer applies.)
- **Deploy branch:** `main`. Vercel auto-deploys `main` → production. A milestone lands
  on `main` ONLY after it passes Fable's review — merging to `main` is shipping, so only
  reviewed milestones land there. Build on a milestone branch; merge on review pass.
- **Secrets never enter the repo (INV-4):** any ingest/deploy credential (the Supabase
  `SUPABASE_DB_URL`, signing secrets) lives in Vercel environment variables ONLY — never in
  code, config, commits, or a chat transcript. The ingest connection string MUST use the
  least-privilege role `browser_bridge_app`, never `service_role` and never the postgres
  superuser: `/api/contributions` is a public unauthenticated write, so its database identity
  is the isolation boundary for every other tenant of that Supabase project.
- **Live acceptance CLIs:** Codex/GPT is an approved, subscription-authenticated host CLI
  for live model-agnostic acceptance alongside Claude Code — still no frontier API keys,
  consistent with INV-11.

## Definition of done (every feature, every PR)

1. Fixture-farm test passing (new behavior = new fixtures).
2. Eval metric recorded; scorecard gates clean; no regression in
   model_turns_per_task on standard workflows.
3. Zod schemas updated in `packages/protocol` if any boundary changed.
4. No invariant violations. If an invariant seems to block a feature, STOP and flag
   for human decision — do not work around it.

## Milestone and release discipline

- Build milestones strictly in order (plan §14). A milestone is complete only when
  every acceptance criterion passes — run them, do not assert them.
- Security ARCHITECTURE (grants, capabilities, policy, redacted audit) is M0/M1
  work. It is never deferred "until hardening."
- Releases follow the train in plan §1. R1 (first external users) additionally
  requires the INV-10 release checklist and the M2 classification audit (zero
  Class A/B leakage across 100 inspected contribution records).
- Do not start milestone N+1 until milestone N passes external review (below).
- Commit at logical package/feature boundaries with descriptive messages.
- Resolve plan §16 open decisions during M0; record each in `DECISIONS.md` with
  rationale.
- Production deploy is part of "done." `main` auto-deploys to Vercel; at every milestone
  boundary AND after any merge to `main`, verify production is green (e.g. `GET /api/health`
  → 200, or the Vercel deployment status). A milestone is NOT done if production is failing
  — `main` once sat red through six deployments unnoticed. Surface it, don't assume it.

## External review protocol

Each milestone's completion triggers a cross-model review (a different model than
the builder) before the next milestone begins. Keep current at all times:

- `DECISIONS.md`: every judgment call the plan didn't dictate, one-line rationale.
- `MILESTONE_STATUS.md`: acceptance checklist with pass/fail evidence (test names,
  metric values), known gaps honestly listed.
- Never game a test or metric. An honest fail with a note is acceptable; a dishonest
  pass is a defect.

## Testing honesty

- Fixture tests exercise the real code path (relay chain included), not mocks of the
  thing under test.
- Adversarial suites (injection, poisoning, exfiltration, confirmation-spoofing,
  grant-escape) assert that the DAEMON blocks the action with a deliberately
  gullible scripted model — passing by making the test's model smarter is invalid.
- The M2 classification audit uses mixed public/intranet/authenticated fixtures and
  human-readable output for inspection.

## When stuck

Two failed attempts at the same bug → stop, write up what you know in
`MILESTONE_STATUS.md`, and flag for escalation rather than thrashing.

## Gate integrity (standing rule, sharpened after the FOURTH divergence)

- **Any gate claiming a capability works MUST exercise THE artifact that ships** — the canonical
  distributable at its real path (`scripts/lib/artifact.mjs` → `DISTRIBUTABLE`), driven through
  the MCP tool surface. Not source, not `dist`, not a direct Playwright script, and **not a
  bundle built the same way into a temp directory**. "Built identically" is not the same file;
  only the file we hand people is evidence about the file we hand people.
- Gates default to the distributable and hard-fail when it is missing. A throwaway build is
  available only behind an explicit `--ephemeral`, which must announce that the run proves the
  code compiles and does NOT gate the shipped artifact.
- Every gate report states: artifact path, build time, the bundle **sha256**, the **code sha256**
  (`server/index.js` inside the bundle), and a fingerprint of the fix grepped from inside it.
  The bundle sha says WHICH FILE was exercised; the code sha says WHICH CODE. Report both.
- The `.mcpb` is **not byte-reproducible** — it is a zip, and zips embed mtimes, so two builds of
  identical source differ (measured: `c31d0b82…` vs `e9de3b83…`, contents byte-identical). Never
  "verify" an artifact by rebuilding and comparing bundle hashes; compare the code sha.
- **This defect class has now recurred four times. Name it when you see it:**
  1. fixture tests certified *assumptions* rather than observed reality;
  2. the G1 negative control certified a resolver that had since been *rewritten*;
  3. Gate A certified *source* that was not in the installed bundle (30h stale);
  4. the D4 gate certified a *temp bundle* while the distributable and the installed
     extension both lacked the fix.
  The shape is always the same: the thing measured is adjacent to, but not identical with, the
  thing shipped. Before reporting any gate, state explicitly which file was exercised and how
  you know it is the one users get.
