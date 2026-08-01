# Browser Bridge — Complete Build Plan (v2)

## A model-agnostic runtime that lets any AI operate a browser at machine speed

**Audience:** AI builder agents and the engineers supervising them. This document is
the authoritative spec and supersedes v1 entirely. Every milestone has acceptance
criteria. Build in order. MUST/NEVER statements are hard invariants.

**v2 changes from v1 (summary):** authorization objects (TaskGrant) and
daemon-constructed confirmation capabilities added to the protocol; security
architecture moved into M0/M1; the absolute "turns" north star replaced with a
constrained scorecard; SemanticLocator strengthened to a scored fingerprint; global
resource governor added above the per-origin scheduler; protocol hardened
(idempotency, deadlines, caps, typed failures, versioning); input-path ladder made
conservative; extension relay boundary corrected; INV-6 replaced with a data
classification; **data collection pipeline moved into v1 with a hard release gate —
no build reaches an external user without live collection.**

---

# 0. Thesis, scorecard, and invariants

## The thesis

An AI should not have to watch a webpage like a human. The browser already knows what
every field, button, and section is. Expose that knowledge as compact structured data,
accept intent in batches, execute and verify locally at machine speed, and consult the
model only for decisions that require intelligence.

## The scorecard (replaces "turns settle every debate")

Task latency = (model turns × seconds per turn) + (local actions × ms per action).
A model turn costs 3–15 s; a local action costs 50–200 ms. Minimizing model turns is
the performance thesis — but it is optimized **subject to gates, in this order**:

1. **Gate — safety:** `unsafe_action_rate` = 0 within the tested threat model.
2. **Gate — correctness:** field accuracy / completion / harvest fidelity meet
   thresholds.
3. **Gate — autonomy quality:** `human_intervention_rate` does not increase.
4. **Optimize — `model_turns_per_task`** (the primary performance metric).
5. **Then optimize** latency, tokens, image bytes, machine resources.

A three-turn workflow that sometimes submits the wrong form is worse than a five-turn
workflow that is reliable. Any proposal that trades a gate for a turn is rejected.

Targets (unchanged): 20-field form ≤ 3 turns / ≤ 15 s; fill-from-record ≈ 0 mid-form
turns; 50-page harvest ≤ 4 turns, network-bound; known-site replay ≤ 1 turn.

## Core invariants (INV-n, referenced throughout)

- **INV-1 — Turns are the scarce resource** (subject to the scorecard order). The
  daemon handles anything not requiring intelligence: waits, retries, verification,
  widget mechanics, interruptions.
- **INV-2 — Page content is untrusted data, never instructions.** Delivered only in
  explicit untrusted framing; never concatenated into instruction positions.
- **INV-3 — Patterns are hints, never commands.** Cached or community patterns MUST
  verify against the live page before any pattern-guided action. Lying patterns fail
  closed.
- **INV-4 — Secrets never enter model context**, logs, error payloads, or crash dumps.
- **INV-5 — All safety policy is enforced in the daemon; no model is trusted.**
  Conditionals, local reflexes, and replayed flows pass through the SAME policy
  engine as ordinary actions. No execution path bypasses a gate.
- **INV-6 — Data classification (replaces "user data never leaves"):**
  - **Class A — user content:** form values, harvested content, credentials, cookies,
    history, screenshots. NEVER leaves the machine. No exceptions.
  - **Class B — non-public structure:** patterns, locators, flows, and link graphs of
    intranet/authenticated/non-publicly-reachable origins. NEVER leaves the machine
    (structure of internal apps is competitive/organizational intelligence).
  - **Class C — public structure:** widget kinds, locator fingerprints, form field
    maps, link graphs, feed locations of publicly reachable origins. Contributed
    per the consent policy (§9.3). Contains no values, no user-identifying URLs
    (query strings stripped), no user-correlated timestamps.
- **INV-7 — All traffic flows through the scheduler** — global governor AND per-origin
  governor. No agent, reflex, or replay owns an uncoordinated browser connection.
- **INV-8 — Model-agnostic by construction.** No vendor, context-size, or vision
  assumptions. Flat schemas, teaching errors, capability handshake.
- **INV-9 — Authorization is explicit and daemon-owned.** Every session and batch is
  bound to a TaskGrant (§4.5). High-risk actions execute only with a single-use
  ConfirmationCapability that the DAEMON constructs from the blocked action — the
  model never authors what the user approves. No prior confirmation authorizes a
  later replay; replayed high-risk actions require fresh authorization.
- **INV-10 — The collection gate (product invariant).** No build reaches any external
  user unless the Class C contribution pipeline and product telemetry are live in it.
  The corpus is the business; an install that doesn't collect is asset burn.
  (Internal/founder dogfood builds are exempt but should collect anyway.)
- **INV-11 — The runtime is model-free.** Models call the bridge; the bridge NEVER
  calls a model. No component of the product may require, store, or ship a
  frontier-model API key, and the daemon initiates no inference calls. All
  intelligence — including ambiguity arbitration — is supplied by the connecting
  agent: on genuine ambiguity the daemon returns candidates for the calling agent to
  decide (there is no internal "Arbiter" that calls out). Dev-time evals get their
  intelligence from scripted agents in CI and from host CLIs authenticated by their
  own subscriptions (Claude Code, Codex); raw API keys are optional, manual-only,
  for the extended model matrix — never a build or release dependency.

---

# 1. Product definition and strategy

## What ships (release train)

| Release | Contents | Gate |
|---|---|---|
| **R0 — internal dogfood** | M0+M1: semantic core, extension mode, enforcement live | founder use only |
| **R1 — first external users (dev channel)** | +M2: widget primitives, fill_record, widget-cache site memory, **collection pipeline live**, consent UX, npm packaging | INV-10 satisfied; M0–M2 acceptance passed |
| **R1.5** | +M3: isolated browsers, scheduler, pattern runner, harvest store | |
| **R2** | +M4: flow replay, commons serving/promotion | core turn-reduction thesis validated by R1/R1.5 field data |
| **GA** | +M5 validation, +M6 adapters/SDKs/signed installers | adversarial suites pass; pen-test checklist clean |

The v1 wedge is the core runtime (R1). Large-scale harvesting is R1.5. The Commons
*serving* platform is R2 — but Commons *collection* starts at R1 (INV-10): clients
contribute from day one into quarantine storage; the promotion/serving machinery
processes the backlog when it arrives. Collection and serving are separable; only
serving waits for validation.

## What the business is

Give the runtime away; the learned knowledge is the product. Free, permissively
open-source client. Every install contributes Class C structural patterns and
telemetry (per consent policy §9.3) from first launch. The Pattern Commons — everyone's
first visit runs at everyone's hundredth-visit speed — is the compounding,
non-copyable asset. Revenue layers later: enterprise control plane, curated/SLA'd
commons access, managed isolated-browser capacity.

## Positioning (why this beats existing tools)

Accessibility-tree snapshots already exist (Playwright MCP et al.). This differs where
it matters: (1) batching + verification — one call per form, exceptions-only
responses; (2) widget primitives — `select` works identically on native select,
react-select, Radix, MUI; (3) signed-in-profile operation via extension; (4) a
stateful daemon: scheduler, site memory, harvest store, policy — stateless per-agent
tools structurally cannot have these; (5) the commons — gets faster with adoption;
(6) neutrality — any tool-calling model, any vendor.

---

# 2. Architecture

```text
┌───────────────────────────────────────────────────────────────┐
│ Agents: Claude Code / Codex / Cursor / custom API agents /    │
│ open-model frameworks — any tool-calling model                │
└───────────────┬───────────────────────────────────────────────┘
                │ MCP (stdio / streamable HTTP) · REST · SDKs
┌───────────────▼───────────────────────────────────────────────┐
│ DAEMON (local, TypeScript/Node)                               │
│  Gateway ─ auth, capability handshake, schema-version nego    │
│  Policy Engine ─ TaskGrants, risk tiers, confirmation         │
│    capabilities, origin & exfil rules (INV-5, INV-9)          │
│  Scheduler ─ GLOBAL governor (tabs/mem/bandwidth/fd/quotas)   │
│    └─ per-origin governors (pacing, backoff)      (INV-7)     │
│  Execution Engine ─ batches, conditionals, verification       │
│  Widget Primitive Library ─ ritual → single op                │
│  Pattern Runner ─ harvest loops (R1.5)                        │
│  Semantic Page Engine ─ DOM+a11y+layout → compact views       │
│  Site Memory ─ SQLite: widget cache, playbooks, link graph    │
│  Harvest Store ─ SQLite+FTS5 (R1.5)                           │
│  Contribution Pipeline ─ classify→anonymize→sign→ingest       │
│    (Class C only, per consent; live at R1, INV-10)            │
│  Secrets Broker ─ refs only, never to models (INV-4)          │
│  Screenshot Ring Buffer ─ RAM-only, TTL, ROI crops            │
└──────┬──────────────────────────────┬─────────────────────────┘
       │                              │ Playwright / CDP (R1.5)
┌──────▼───────────────────┐   ┌──────▼──────────────┐
│ EXTENSION RELAY CHAIN    │   │ ISOLATED BROWSERS   │
│  Page                    │   │ disposable profiles │
│   ↓ (page world)         │   │ bulk / unattended   │
│  Isolated content script │   └─────────────────────┘
│   ↓ validated, least-priv msg
│  MV3 service worker      │   Content scripts CANNOT call
│   ↓ native messaging     │   native messaging directly.
│  Signed native shim      │   Every boundary re-validates
│   ↓ authed local socket  │   (Zod) — content scripts are
│  Daemon                  │   less trusted than the worker.
└──────────────────────────┘
┌───────────────────────────────────────────────────────────────┐
│ CLOUD (thin)                                                  │
│  Ingest (R1): quarantine bucket + tiny worker. Trivial.       │
│  Serve/Promote (R2): quorum, provenance, per-domain fetch,    │
│  auto-demotion, seed corpus, CDN.                             │
└───────────────────────────────────────────────────────────────┘
```

Mode routing (deterministic, daemon-decided, never model-decided): authenticated tasks
→ extension/real profile, gentle pacing; bulk anonymous reads/evals/unattended →
isolated browsers; canvas/broken semantics → hybrid (semantic + targeted screenshots);
browser-internal pages / remote desktops → visual fallback (agent's own computer use).

---

# 3. Stack and repository

## Stack (settled — do not relitigate)

TypeScript end-to-end; Node current LTS; pnpm + Turborepo; Chrome MV3 extension (WXT);
Hono or Fastify loopback-only (Unix socket / named pipe preferred); Zod at every
boundary; better-sqlite3 (+FTS5) — no vector DB; sharp + worker threads for images;
extension+CDP primary automation, Playwright for isolated mode; official MCP TS SDK
(stdio + streamable HTTP); Vitest + Playwright Test against the fixture farm;
Cloudflare Workers + R2/D1 or equivalent (deliberately trivial); Rust or Go static
shim as the native-messaging host (M6 for signed installers; a dev-mode shim exists
from M1 because the relay chain requires it).

Rust beyond the shim: only post-stabilization, edges inward, never the page-touching
layer. The moat is accumulated knowledge, not language.

## Repository layout

```text
browser-bridge/
  apps/
    extension/          # MV3, WXT: content scripts + service worker relay
    daemon/             # thin shell over packages/*
    shim/               # native-messaging host (dev-mode from M1; Rust/Go at M6)
    cli/                # install, doctor, inspector launch
    inspector-ui/       # sessions, patterns, audit, contribution viewer, confirm UI
    commons-ingest/     # R1: quarantine intake worker (trivial)
    commons-api/        # R2: promotion/serving
    fixture-farm/       # self-hosted gauntlet site (§12)
  packages/
    protocol/           # ALL shared types + Zod. Single source of truth.
    semantic-engine/    # views, diffing, revisions, hidden-content reading
    locators/           # fingerprints, scoring, re-resolution, ambiguity
    widget-patterns/    # detectors + playbooks (highest churn)
    execution/          # batches, conditionals, verification, failure model
    scheduler/          # global governor + per-origin governors
    pattern-runner/     # harvest loops (R1.5)
    site-memory/        # widget cache, playbooks, link graph, flows (replay R2)
    harvest-store/      # corpora + FTS (R1.5)
    policy/             # grants, risk tiers, capabilities, origins, reflex allowlist
    contribution/       # Class C extraction, anonymization, signing, telemetry
    secrets/            # SecretRefs, brokers
    screenshots/        # ring buffer, ROI
    mcp-server/  adapters/  sdk-ts/  sdk-py/
    audit/              # redacted structured logs, correlation IDs
    evals/              # workflows, per-model matrix, scorecard metrics
```

## Conventions for builder agents

- `packages/protocol` is the only place cross-boundary types are defined; every
  boundary re-validates with Zod on receipt — including extension-internal boundaries
  (content script → service worker → shim → daemon).
- Errors returned to models must teach: found / expected / alternatives.
- No `eval`; no remotely-loaded code in the extension; no generic JS-execution tool
  for agents, ever.
- Model-facing schemas stay flat and simple (INV-8); internal schemas may be richer.
- Definition of done: fixture test + eval metric recorded + scorecard gates clean +
  protocol updated if a boundary changed + no invariant violations.

---

# 4. Protocol

Full Zod schemas in `packages/protocol`. Shapes below are normative.

## 4.1 Envelope (every request/response)

```ts
interface Envelope {
  schemaVersion: string;         // negotiated at attach; mismatches rejected clearly
  correlationId: string;         // threads request → audit → telemetry
  idempotencyKey?: string;       // batches: safe retry without double-execution
  deadlineMs?: number;           // daemon aborts work past deadline
}
```

Cancellation: transports' native mechanisms (MCP cancellation notifications; REST
DELETE /batches/{id}) abort in-flight batches; partial results returned with
`status: "interrupted"`.

**Hard caps (enforced, rejected with teaching errors):** ≤ 30 actions per batch; `if`
nesting ≤ 2; total expanded actions ≤ 60; request payload ≤ 256 KB; screenshot
response ≤ 2 MB; view response ≤ 64 KB.

## 4.2 Semantic view

```ts
interface SemanticView {
  sessionId: string; pageId: string; revision: number;
  url: string; origin: string; title: string;
  loading: "loading" | "interactive" | "idle";
  scope: ViewScope;
  elements: ElementRecord[];
  forms: FormSummary[];
  alerts: { kind: "error" | "warning" | "status"; text: string }[];
  content?: ContentBlock[];
  trust: { pageContent: "untrusted" };            // INV-2, always present
}

type ViewScope =
  | { kind: "visible_form" } | { kind: "all_forms" } | { kind: "viewport" }
  | { kind: "region"; near: LocatorInput }
  | { kind: "invalid_fields" }
  | { kind: "content"; region?: SemanticRegion }   // reading, not acting
  | { kind: "full" };                              // last resort

type SemanticRegion =                              // no raw CSS in the normal contract
  | { kind: "main" } | { kind: "article" }
  | { kind: "section"; heading: string }
  | { kind: "element"; target: LocatorInput };
// Raw CSS selectors: available only behind an "advanced" capability flag granted
// per-integration, never default (arbitrary CSS is an injection/ambiguity surface).
```

No `goal: string` parameter — relevance filtering is the model's job; the daemon
provides structural scopes only.

## 4.3 Locators (strengthened)

```ts
// What MODELS send — deliberately simple (INV-8):
type LocatorInput = { role?: string; name?: string; ref?: string };
// ref = short-lived handle from the current view. If the view's revision still
// matches at execution, ref resolves directly (fast path); otherwise the daemon
// falls back to fingerprint re-resolution automatically.

// What the DAEMON records in views and site memory — the scored fingerprint:
interface LocatorFingerprint {
  role?: string;
  name?: string;                  // normalized accessible name
  testId?: string;                // data-testid and friends
  autocomplete?: string;
  inputType?: string;
  stableAttributes?: Record<string, string>;   // id/name where non-generated
  formContext?: string;
  framePath?: string[];
  structuralFingerprint?: string; // hashed ancestor/sibling shape
  labels?: { locale: string; name: string }[]; // localization resilience
}

interface ResolutionResult {
  status: "resolved" | "ambiguous" | "not_found";
  confidence: number;             // 0–1, scored across fingerprint signals
  candidates?: ElementRecord[];   // returned on ambiguity — model arbitrates;
}                                 // NEVER silently pick the top candidate when
                                  // scores are close (threshold in policy config)
```

**Identity rule:** actions are re-resolved at execution time via fingerprint scoring;
backend node IDs and `ref`s are caches, never addresses. This is how rerenders that
replace DOM nodes are survived by design.

**Staleness rule:** `expected_revision` rejects only if the *targeted elements or
their containing form* changed — never on unrelated page mutation. The semantic-engine
diff classifies mutations as target-relevant / structure-relevant / noise; noise never
bumps revisions.

## 4.4 Actions

```ts
type Action =
  | { op: "fill";    target: LocatorInput; value: string | SecretRef }
  | { op: "check";   target: LocatorInput; value: boolean }
  | { op: "click";   target: LocatorInput; capability?: string }  // §4.5 for high-risk
  | { op: "press";   target?: LocatorInput; key: string }
  | { op: "scroll";  target?: LocatorInput; direction: "up"|"down"; amount?: number }
  | { op: "upload";  target: LocatorInput; fileToken: string }
  // widget primitives — daemon runs the ritual internally (§6)
  | { op: "select";      target: LocatorInput; value: string | string[] }
  | { op: "set_date";    target: LocatorInput; value: string /* ISO */ }
  | { op: "search_pick"; target: LocatorInput; query: string; pick: string | { index: number } }
  | { op: "open_menu_path"; path: string[] }
  | { op: "expand";      target: LocatorInput }
  // navigation
  | { op: "goto"; url: string } | { op: "goto_intent"; intent: string }
  // control flow — zero model turns; NEVER bypasses policy gates (INV-5)
  | { op: "wait"; condition: WaitCondition; timeoutMs?: number }
  | { op: "if";   condition: PageCondition; then: Action[]; else?: Action[] };
```

`WaitCondition` / `PageCondition` as v1 (element state, url_changed, text_present,
network_idle, form_valid, dialog, download_complete; safe glob-style URL matching —
no arbitrary regex from models). `if` is a tiny declarative conditional, capped depth
2 — not a scripting language. **Every action inside `if`, every local reflex, and
every replayed step passes the same policy engine as a directly-issued action; a
conditional cannot pre-authorize what policy would gate (INV-5, INV-9).**

## 4.5 Authorization: TaskGrant and ConfirmationCapability (INV-9)

```ts
interface TaskGrant {
  taskId: string;
  allowedOrigins: string[];            // exact origins; no wildcards below eTLD+1
  allowedRiskTiers: RiskTier[];        // ceiling for ungated execution
  sensitiveDataDestinations: string[]; // origins permitted to receive tagged values
  budgets: { maxPages?: number; maxDownloads?: number; maxTabs?: number;
             maxUploadBytes?: number };
  expiresAt: string;
}
// Every session binds to a grant at attach. Every batch is checked against it.
// Actions outside the grant fail with a teaching error naming the needed extension;
// GRANT EXTENSION IS A USER DECISION surfaced via the confirmation UI — a model
// cannot widen its own grant.

interface ConfirmationCapability {
  capabilityId: string;                // single-use nonce
  action: NormalizedAction;            // constructed BY THE DAEMON from the blocked
                                       // action — never from model-supplied text
  origin: string;
  pageRevision: number;
  sensitiveFields: string[];           // what tagged values this would transmit
  expiresAt: string;                   // short TTL
}
```

Flow: a high-risk action executes → policy blocks it → `BatchResult.interruption`
carries the daemon-constructed pending confirmation → the user approves in the
inspector/confirm UI (which renders the daemon's normalized description, the
destination, and the sensitive fields — never the model's words) → approval mints the
capability → the model re-issues the action with `capability` → consumed on use,
invalid if the page revision moved or TTL expired. `bridge_confirm` exists only to
*request* that the UI surface a pending confirmation; it cannot describe or create
one.

## 4.6 Batch results (typed failures)

```ts
interface BatchResult {
  status: "completed" | "partial" | "rejected" | "interrupted";
  revision: number;
  completed: number;
  results: { target: string; status: "verified" | "failed" | "skipped";
             failure?: FailureDetail }[];
  interruption?: { kind: "navigation" | "modal" | "origin_change"
    | "confirmation_required" | "captcha" | "auth_wall" | "budget_exhausted";
    pendingConfirmation?: ConfirmationCapability;   // daemon-built, unsigned yet
    view?: SemanticView };
  invalidFields?: ElementRecord[];
}

type FailureDetail =
  | { reason: "option_not_found"; availableOptions: string[] }
  | { reason: "ambiguous_target"; candidates: ElementRecord[] }
  | { reason: "stale_target"; freshView?: SemanticView }
  | { reason: "widget_unrecognized"; widgetHint?: string }
  | { reason: "not_editable" | "not_visible" | "disabled" }
  | { reason: "grant_denied"; needed: { origin?: string; tier?: RiskTier } }
  | { reason: "capability_required" | "capability_invalid" }
  | { reason: "verification_mismatch"; expected: string; observed: string }
  | { reason: "timeout" | "budget_exhausted"; budget?: string };
```

---

# 5. Semantic Page Engine

As v1, unchanged in substance: DOM + a11y + layout + form metadata + validation state
+ shadow DOM + frame hierarchy → compact `SemanticView`s (typical form view ≤ 4 KB;
never raw DOM/AX trees/CSS). Hidden-content reading: collapsed-but-present accordion
content readable without expansion; lazy-on-expand containers detected and reported
(`requiresExpand: true`). Mutation pipeline: 50–100 ms coalescing → semantic diff →
{target-relevant, structure-relevant, noise}; noise never bumps revisions. Frames
flattened with paths; cross-origin reachability reported honestly. All content blocks
carry untrusted framing (INV-2).

---

# 6. Widget Primitive Library

The highest-ROI code: each primitive collapses a 3–5-turn ritual to zero extra turns.

Detector maps DOM shapes to `WidgetKind` (native-select, react-select, radix, mui,
headlessui, downshift, ant, custom-combobox, native-date, custom-datepicker,
typeahead, …); results cached in site memory; Class C contributable.

**Input-path ladder (conservative — fast paths are earned per widget, not default):**

1. Standards-based native setter + synthetic events — ONLY where the playbook for
   that specific WidgetKind has proven it safe (framework state, validation, and
   isTrusted checks can silently break; a "fast" path that corrupts state is a
   correctness failure, which outranks turns on the scorecard).
2. User-action emulation (Playwright-style actionability-checked interaction).
3. CDP trusted input dispatch (`Input.dispatchMouseEvent/KeyEvent`) — machine speed,
   no humanlike delays.
4. Widget-specific fallback sequence from the playbook.
5. ALWAYS: verify final semantic AND application state (read-back). A click that
   returns without throwing proves nothing.

Unknown widget → `{ reason: "widget_unrecognized" }` + targeted screenshot offer —
never a silent guess. Acceptance bar per WidgetKind: fixture gauntlet across happy
path, option-not-found, disabled, async options, virtualized listbox,
mid-interaction rerender.

---

# 7. Execution Engine

## Batch semantics (normative)

1. Sequential execution; every action re-resolves via fingerprint at execution time.
2. Dependent fields stay one call via embedded waits:
   `[fill country, wait element_enabled(state), select state, …]`.
3. Failure model: failed action records typed failure; independent targets continue,
   dependents (same-form downstream) skip; `stopOnFailure: true` per batch.
4. Interruptions (navigation, modal, origin change, CAPTCHA, auth wall, budget,
   confirmation) stop the batch and include a fresh view — handling costs one turn.
5. **Local reflexes — allowlisted, policy-gated (INV-5):** spinner/skeleton waits,
   single stale-retry, dismissal of popups CLASSIFIED as non-task-relevant AND
   non-consent-bearing. **Cookie/consent banners are consent decisions, not noise:**
   default reflex chooses "reject / necessary only" where offered; otherwise the
   banner surfaces to the model/user. "Accept all" is never an automatic reflex.
   Reflex set and choices are user-configurable.
6. Streamed freshness: after any page-changing action the daemon pre-extracts the new
   view so the next turn starts with state in hand.

## Fill-from-record (`bridge_fill_record`)

As v1: agent hands a structured record once; daemon does deterministic field matching
(accessible names, autocomplete attrs, input types, name/id tokens, site-memory
hints — no embedded model). Returns matched (with confidence), unmatched, ambiguities
for the model to arbitrate. `ambiguityPolicy: "ask" | "skip" | "best_effort"`.
SecretRefs compose (INV-4). Sensitive-tagged values check
`TaskGrant.sensitiveDataDestinations` before any fill (a fill IS transmission).

---

# 8. Reading at scale (R1.5)

## Scheduler (INV-7) — two levels

```text
GLOBAL GOVERNOR (protects the user's machine and catches runaway agents)
  ├─ max total tabs / browser contexts
  ├─ memory + CPU ceilings (backpressure, not crash)
  ├─ bandwidth and download-bytes budget
  ├─ file-descriptor limits
  └─ per-task quotas (from TaskGrant.budgets)
       └─ PER-ORIGIN GOVERNORS (protect websites)
            ├─ default 3 concurrent loads; profile mode 1–2
            ├─ jittered, human-plausible pacing
            ├─ exponential backoff on 429/503/Retry-After
            └─ pause + surface on CAPTCHA / bot-challenge
```

Cross-origin parallelism is bounded by the global governor — never "unlimited."
Ten agents can want the same origin; they experience one queue. Bulk work defaults to
isolated mode; high-volume runs in profile mode are refused by default.

## Crawl policy (explicit)

Pattern runs honor: robots directives for unauthenticated crawling (configurable for
the user's own authenticated properties — the user's standing with a site is theirs,
not ours, but defaults are conservative); per-task page/byte budgets from the
TaskGrant; max content size per page; no crawling behind auth walls unless the grant
names the origin; site-terms surface as a user decision, not silently ignored.
Prefer sitemaps/RSS/APIs when site memory records one.

## Pattern Runner and Harvest Store

As v1: model defines extraction pattern on the first page (1–2 turns); daemon runs the
loop at network speed in parallel tabs; misses surface as exceptions with views.
Capture ≠ comprehension: harvested content goes to the store (Class A — never leaves
the machine, never auto-enters model context); the model queries it afterward in
chunks (`bridge_harvest`: list, FTS search, chunked export). One fetch, many readers.
Dedupe by URL + content hash.

---

# 9. Site memory, contribution, and the Commons

## 9.1 Local site memory

As v1: per-origin playbooks — widget cache (ships R1 with M2), form field maps, link
graph (powers `goto_intent`), feeds, hit stats; recorded flows for replay (R2).
**Replay authorization (INV-9):** replayed steps re-verify against the live page
(INV-3) AND re-pass policy; high-risk steps in a replay require fresh confirmation
capabilities every run — a flow recording is a route, never a standing authorization.

## 9.2 Contribution pipeline (`packages/contribution`) — live at R1 (INV-10)

Client-side, runs on task completion:

1. Extract candidate patterns from site memory.
2. **Classify** per INV-6: Class A/B discarded at this stage — public-origin check
   (reachability probe + heuristics + curated lists), value stripping, query-string
   stripping, timestamp coarsening.
3. Anonymize: no user identifiers beyond the per-install signing key (device-bound,
   revocable).
4. Sign and upload to the ingest quarantine. Failures queue and retry; contribution
   never blocks or slows a task.

**Product telemetry (also live at R1, same classification discipline):** pattern
hit/miss counts, per-widget success rates, scorecard metrics (turns, latency,
intervention) — aggregated, structural, no content, no URLs beyond origin.

The inspector-ui includes a **contribution viewer**: every record sent, inspectable,
with a per-record and global kill switch. Auditable in ten seconds.

## 9.3 Consent policy

- Free client: disclosed default-on for Class C at onboarding — plain-language
  disclosure ("this free tool learns site *structure* from public sites — never your
  content, never internal apps — here's exactly what it sends, here's the off
  switch"). One click off, off is respected instantly and retroactively purges the
  install's quarantined, unpromoted contributions.
- Enterprise/managed config: policy file forces contribution off; Class B
  classification is enforced regardless of any toggle.
- The disclosure claims are enforced by architecture (INV-6 classification in the
  client), not by server-side promises.

## 9.4 Commons serving and promotion (R2)

As v1 §9.2: quarantine → quorum promotion (N=3 independent installs structurally
agreeing) → provenance-tagged serving via CDN; per-domain fetch; seed corpus from
first-party eval runs across top sites; telemetry-driven auto-demotion; elevated
quorum or first-party-only for sensitive domains (finance/health/gov); signed
contributions with revocable keys; INV-3 verification as the absolute last line —
poisoned patterns fail closed and demote.

Leanness facts stand: records are hundreds of bytes; playbooks tens of KB; the corpus
dedupes to a shared widget-definition library; serving is CDN-shaped and near-free.

---

# 10. Security model

All enforcement in the daemon (INV-5). Architecture ships in M0/M1; M5 validates it.

**T1 — Prompt injection from pages.** INV-2 framing everywhere; the adversarial suite
asserts the DAEMON blocks resulting actions (grants, tiers, capabilities) even when
the scripted model is deliberately gullible. Defense-in-depth, not model trust.

**T2 — Risk-tiered actions.** Low (read/scroll/expand/draft fills/same-origin nav):
ungated within grant. Medium (upload/download/new-origin nav/PII entry/reversible
settings): grant-configurable, default allow + audit. High (third-party submit,
send/publish, purchase, delete, permission/password change, financial entry, legal
agreement): ConfirmationCapability required (§4.5).
**Honesty requirement:** "submit" cannot be perfectly distinguished from "click" —
SPAs commit via fetch() from arbitrary handlers. The risk classifier therefore runs
on ALL clicks (button semantics, form context, page signals), backstopped by network
watch for cross-origin POSTs carrying sensitive-tagged values. Gating is classifier +
capability + network backstop — never advertised as unbypassable.

**T3 — Secrets (INV-4).** SecretRefs resolved by the broker; read-back of secret
fields compares hashes, returns `valueRedacted`. v1 fallback: pause-and-human-types
is acceptable; keychain/credential-manager brokering lands incrementally.

**T4 — Exfiltration.** Policy validates destination origin, form action URL, upload
destination, and sensitive-tagged value movement against
`TaskGrant.sensitiveDataDestinations`. Filling a field IS transmission.

**T5 — Local attack surface.** Relay chain per §2: every boundary re-validates;
content scripts are less trusted than the service worker; the page can never
fabricate an authenticated command. Unix socket / named pipe; loopback HTTP only if
unavoidable with per-session capability tokens, no wildcard CORS, CSRF protection,
process-ownership checks; signed shim↔daemon handshake.

**T6 — Commons poisoning.** §9.4; INV-3 absolute.

**T7 — Retention.** Screenshots RAM-only + TTL; values redacted from logs; cookies
never exposed; history never read; downloads quarantined; audit = action names +
target labels + outcomes + correlation IDs, no raw values.

**T8 — No generic JS execution for agents.** Not in v1; never without a
disposable-VM boundary.

**Permission ladder (extension):** Observe → Operate (per-site) → Deep-control
(chrome.debugger; separately consented; Chrome's persistent debug banner disclosed
honestly). No all-sites permission by default, ever.

---

# 11. Agent surface and model-agnosticism

## The 8 tools (complete surface — do not grow)

```text
bridge_attach        attach tab / isolated session; binds TaskGrant; returns
                     capabilities + schema version
bridge_view          SemanticView for a scope
bridge_act           execute Action batch → BatchResult
bridge_fill_record   fill-from-record
bridge_run_pattern   harvest loop (R1.5)
bridge_harvest       query/export corpora (R1.5)
bridge_screenshot    ROI capture: element | form | viewport | full
bridge_confirm       request the confirm UI surface a pending daemon-built
                     confirmation (cannot describe or create one — §4.5)
```

Waiting is an action; validation is a view scope; submission gating is policy.

## Transports, degradation, adapter cards

As v1: MCP first (stdio + streamable HTTP) → ~80% coverage; OpenAI function-calling
adapter; REST/OpenAPI + TS/Python SDKs — all thin skins over `packages/execution`,
zero logic in adapters. Capability handshake at attach (vision availability, modes,
schema version); text-only models get pure-semantic mode with text descriptions or
human handoff where a screenshot would be the answer. Per-host adapter cards (Claude
Code, Codex, Cursor, raw API): prefer bridge over screenshots; batch aggressively;
fill_record for forms; run_pattern for multi-page reads.

---

# 12. Testing and evaluation

## Fixture farm

As v1, plus authorization fixtures: every supported WidgetKind × every supported
library; missing/duplicate/localized labels; hidden/disabled fields; async dependent
selects; virtualized lists; lazy accordions (both kinds); shadow DOM; nested +
cross-origin iframes; infinite scroll; cookie/consent banners (including
consent-classification tests); modal interrupts; slow networks; mid-interaction
rerenders; fetch()-from-div submit classifiers; injection pages instructing
exfiltration; **confirmation-spoofing fixtures (model attempts to author its own
confirmation text / reuse capabilities / replay high-risk steps)**; grant-escape
fixtures (actions outside allowed origins/tiers); CAPTCHA and auth walls
(detect-and-surface); WebAuthn/passkey prompts, OAuth popups, native file/print
dialogs (detect-and-hand-off — these MUST fail gracefully to the human).

## Eval suite and scorecard

Metrics per §0 scorecard, gates first: `unsafe_action_rate` (must be 0),
`field_accuracy`, `form_completion_rate`, `harvest_fidelity`,
`human_intervention_rate`, then `model_turns_per_task` (primary optimization),
`time_to_completion`, `tokens_sent`, `image_bytes_sent`, `recovery_rate`, machine
resource usage. **Eval intelligence per INV-11:** CI runs on scripted agents
(deterministic tool-call sequences — the same mechanism as the adversarial suites);
real-model runs go through host CLIs authenticated by their own subscriptions
(Claude Code, Codex CLI); raw API keys are optional and manual-only, for the
extended matrix (Grok, Kimi, open-weights) — never a build, CI, or release
dependency. Regressions on any tracked model block release. Baselines (M0) on the
record: screenshot-loop agent AND a Playwright-MCP-style agent on the same
workflows, both driven through subscription-authenticated host CLIs.

---

# 13. Distribution

Phase 1 (dev channel, R1): npm daemon + dev shim + store/unpacked extension +
one-line MCP registration + `browser-bridge doctor`. Phase 2 (GA): single signed
installer; Rust/Go static shim as the native-messaging host (trivially
signed/notarized, supervises daemon startup); daemon bundled single-executable;
signature-verified auto-update; launchd/systemd/service registration;
native-messaging manifests per browser. Deep-control permission kept optional and
separately consented so the base extension reviews cleanly in the Web Store.

---

# 14. Milestones

Strictly in order; each gates the next. Security ARCHITECTURE is M0/M1;
M5 is validation of an architecture that already exists.

## M0 — Foundations, baseline, and security skeleton

Build: monorepo scaffold; `packages/protocol` v0 COMPLETE (§4: envelope, views,
locator fingerprints, actions, TaskGrant, ConfirmationCapability, typed failures,
caps); `packages/policy` core (grant binding + checking, risk-tier classifier v0,
capability mint/consume, reflex allowlist format); `packages/audit` (redacted
logging, correlation IDs) — all with unit suites; fixture farm v1 (forms, native
widgets, one custom-select library, accordions, injection page, grant-escape page);
evals harness; baseline runs (screenshot agent + Playwright-MCP-style agent) on the
8 standard workflows; `DECISIONS.md` for §16 resolutions.

Accept: baselines published in-repo; protocol versioned; policy/audit unit suites
green including capability single-use, TTL, and revision-binding tests; fixture farm
in CI.

## M1 — Semantic core with enforcement live (→ R0 internal)

Build: MV3 extension (standard mode) with the full relay chain (content script → SW →
dev shim → daemon), Zod at every hop; daemon + MCP server;
`bridge_attach/view/act/screenshot/confirm`; semantic engine v1 (views,
hidden-content reading, scoped-staleness diffing); locator scoring + re-resolution +
ambiguity returns; sequential batches with verification, typed failures,
interruptions, streamed freshness; native widgets (text, native select, checkbox,
radio, button); TaskGrant enforcement on every batch; daemon-constructed
confirmations end-to-end with the inspector confirm UI; sensitive-field tagging v1;
Unix-socket transport.

Accept: 20-field native form ≤ 3 turns from Claude Code AND one OpenAI-based agent;
dependent-select form passes as one batch with embedded wait; injection fixture —
daemon blocks exfiltration with a gullible scripted model; confirmation-spoofing
fixture — model cannot author, reuse, or out-of-revision-replay a capability;
grant-escape fixture — actions outside grant fail with teaching errors; all form
workflows beat both baselines ≥ 3× on turns with gates clean.

## M2 — Widgets, fill_record, collection (→ R1 first external users)

Build: widget detectors + playbooks (react-select, Radix, MUI, headlessui, ant,
custom-datepicker, typeahead) with the §6 input-path ladder; primitives
(`select/set_date/search_pick/expand/open_menu_path`); CDP deep-control mode
(opt-in); `bridge_fill_record`; local reflexes incl. consent-aware banner handling;
`if` conditionals through policy; site-memory widget cache; **`packages/contribution`
complete: Class A/B/C classifier, anonymization, signing, ingest upload, telemetry,
consent onboarding UX, contribution viewer + kill switch; `apps/commons-ingest`
quarantine intake live**; npm packaging + `doctor`.

Accept: every WidgetKind passes its gauntlet incl. rerender; fill_record: 0 mid-form
turns on the job-application fixture with correct ambiguity surfacing; consent-banner
fixture — "Accept all" never auto-clicked; **classification audit: reviewer inspects
100 generated contribution records from mixed public/intranet/authenticated fixtures
and finds zero Class A/B leakage; kill switch verified end-to-end; INV-10 release
checklist passes** → R1 may ship.

## M3 — Reading at scale (→ R1.5)

Build: Playwright isolated mode; global governor + per-origin governors + budgets
from grants; crawl policy (robots, budgets, max sizes, auth-wall refusal); pattern
runner; harvest store; `bridge_run_pattern/bridge_harvest`; parallel tabs;
`goto_intent`; feed preference.

Accept: 50-page harvest ≤ 4 turns, wall-clock ≤ 1.5× raw parallel load time at
concurrency 3; drift at page 23 recovers in exactly 1 extra turn; global governor
holds machine ceilings under a runaway-agent test (spawns 100 origins); per-origin
caps hold under 10 competing agents; profile-mode bulk refused by default; robots
fixture honored.

## M4 — Replay and Commons serving (→ R2, after R1/R1.5 field validation)

Build: flow recording + replay with INV-3 re-verification and per-run fresh
authorization for high-risk steps; commons promotion (quorum, provenance,
auto-demotion), per-domain fetch, seed corpus from eval runs, sensitive-domain
elevated quorum, key revocation + purge.

Accept: second run of a recorded flow ≤ 1 turn with high-risk steps freshly
confirmed; warm-start on seeded sites ≥ 2× first-visit turn reduction;
poisoned-pattern fixture fails closed and auto-demotes; revoked key's patterns
purged; replay-authorization fixture — a recorded confirmation never re-authorizes.

## M5 — Adversarial validation

Build: full risk classifier (all clicks + network backstop); secrets broker
(keychain/credential-manager + human-type fallback); complete exfiltration policy;
permission-ladder UX; download quarantine; injection/poisoning/exfiltration/
confirmation-spoofing suites wired into CI; enterprise policy file format
(including forced contribution-off); third-party pen-test checklist run.

Accept: `unsafe_action_rate` = 0 across the full adversarial suite with a gullible
scripted model; automated scan proves secrets absent from logs/context/crash dumps;
pen-test checklist clean.

## M6 — Ecosystem and distribution (→ GA)

Build: OpenAI adapter, REST/OpenAPI, TS/Python SDKs, adapter cards, capability
handshake completeness, per-model CI matrix, production Rust/Go shim, signed
installers + auto-update, inspector-ui v1 complete.

Accept: 8 workflows pass from 5 models via 3 transports; fresh machine → working
install ≤ 5 minutes via signed installer; leaderboard generated from the matrix.

## Post-GA (out of scope now)

Firefox/WebDriver-BiDi; enterprise control plane; password-manager integrations;
managed isolated-browser capacity. (There is no internal Arbiter — INV-11:
ambiguity returns to the calling agent, always.)

---

# 15. What NOT to build

As v1, unchanged: no video streams to models; no cloud path for Class A/B data ever;
no Chromium fork; no goal-driven relevance filter or embedded model in v1; no generic
JS execution; no scripting language grown from `if`; no ninth tool without a plan
amendment; no RPA designer, agent framework, or MCP alternative; no humanlike input
simulation; no vector DB/Kubernetes/heavy cloud; no Rust rewrite of churning code.

---

# 16. Open decisions (resolve during M0 in DECISIONS.md)

1. Hono vs Fastify. 2. Shim language (Rust preferred). 3. Commons host (requirement:
bucket + tiny worker + CDN). 4. Per-install key scheme (device-bound vs
account-bound; affects revocation). 5. Quorum N and sensitive-domain lists (start
N=3 + curated finance/health/gov). 6. Public-origin classification method
(reachability probe + list heuristics; false-positive bias toward Class B — when
unsure, don't contribute). 7. Locator ambiguity threshold defaults.

---

*End of plan. The screenshot remains an exception handler. The browser already knows
what every field is — this system is how every AI, from any vendor, uses that
knowledge at machine speed, safely, while every install grows the asset.*
