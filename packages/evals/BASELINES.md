# Baselines (M0)

Published per the M0 acceptance criterion "baselines published in-repo." These are the
comparison points the bridge is measured against on turn count.

## Two tiers, and what is real here

Per **INV-11 the runtime is model-free** — no frontier API key is a build/CI/release
dependency. Baselines therefore come in two tiers:

1. **Scripted tier (this document, runnable now).** Deterministic scripted agents
   encode exactly how each class of tool operates and the harness *measures* their
   turns. These are real measurements of the scripted agents — not hand-entered
   numbers — and they are asserted in `src/harness.test.ts`, so they cannot silently
   drift. This is the same scripted mechanism the adversarial suites use.
2. **Live tier (captured at M1, honestly deferred).** Real model-driven runs through
   the subscription-authenticated host CLIs (Claude Code, and Codex for the
   OpenAI-based criterion). These require the daemon and a driven browser, which land
   in M1. They are **not** faked here; M1 records them alongside these scripted rows.

## Scripted-tier turn matrix

Turns = model round trips. `screenshot-loop` = one screenshot + one action per unit;
`playwright-mcp` = one a11y snapshot then one un-batched action per unit; `bridge` =
attach (which returns the first view as `initialView`) then one verified batch.

| Workflow | shape | units | screenshot-loop | playwright-mcp | bridge | bridge vs screenshot |
|---|---|---:|---:|---:|---:|---:|
| fill-native-form | form | 20 | 21 | 22 | 2 | 10.5× |
| native-select-multi | form | 3 | 4 | 5 | 2 | 2.0× |
| dependent-select | form | 2 | 3 | 4 | 2 | 1.5× |
| custom-combobox-select | single-widget | 1 | 2 | 2 | 2 | 1.0× |
| expand-lazy-accordion | expand-read | 1 | 2 | 3 | 2 | 1.0× |
| grant-escape-block | blocked-action | 1 | 2 | 2 | 2 | 1.0× |
| read-accordion-present | read | 0 | 1 | 1 | 1 | 1.0× |
| injection-resist | read | 0 | 1 | 1 | 1 | 1.0× |

## Honest reading of these numbers

- The bridge's **turn** advantage scales with field count: decisive on the 20-field
  form (10.5×), modest on 2–3 field tasks, and ~1× on single-widget and pure-read
  tasks.
- On those ~1× workflows the bridge's advantage is **not** turns — it is correctness
  and safety the baselines cannot match: verified widget primitives, reading
  collapsed-but-present content without expanding, treating page text as untrusted
  data (INV-2), and gating destructive actions behind a daemon-built confirmation
  (INV-9). Those are gate-level wins, which outrank turns on the scorecard.
- The M1 target ("beat both baselines ≥ 3× on turns") is a claim about **form**
  workflows; the 20-field form already clears it in the scripted tier.

## Live tier — first dogfood run (R1, Claude Code / Sonnet 4.6)

The first live run of the 20-field form measured **bridge = 3 turns**, not the scripted
2: attach → view → act. The scripted model had folded the first view into attach, but
the live daemon's `attach` returned only `{sessionId, capabilities}` — no view — so a
real agent needed a separate `bridge_view`. That was a real gap the scripted tier masked,
not a modeling nicety.

**Fixed (field-fix #3):** `attach` now returns `initialView` (full scope by default,
caller-scopable), so the 2-turn path — attach(view) → act — is real. The scripted
baseline of 2 now matches the daemon's actual behavior (asserted in
`packages/daemon/src/daemon.test.ts`). The **live re-measure is pending Ace's next run**;
this row will record the measured number, not an asserted one:

| Workflow | tier | measured turns | note |
|---|---|---:|---|
| fill-native-form | live (pre-fix) | 3 | attach returned no view (19/21 verified, 2 false failures) |
| fill-native-form | live (post-fix) | 2 | measured, Sonnet 4.6 via Claude Code — attach + act, 21/21 verified, 0 failures |

The post-fix live number **matches the scripted baseline of 2** — the scripted model is now
faithful to real behavior. The run also confirmed all three field-fixes by live behavior:
the model explicitly recognized `initialView` and skipped `bridge_view` unprompted;
label-based selects verified; no phantom `invalidFields`.
