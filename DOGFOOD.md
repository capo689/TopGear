# Dogfood — your first real-site session

The goal is the first **field data**: real tasks, on real sites, in your signed-in Chrome,
with turns / accuracy / failures captured. This is what unblocks M4 (which is honestly
gated on R1/R1.5 usage — no faking it).

Install first: `INSTALL.md` Path B (the extension). Then work through 3–5 small tasks and
fill one row per task in the table below. Copy the finished rows into
`MILESTONE_STATUS.md` under "R1 field data".

## How to run one task

1. Open the target site in your signed-in Chrome; click **Grant Operate** on the tab.
2. Give your agent ONE concrete task (examples below). Let it use only `bridge_*` tools.
3. Watch for a **confirmation** prompt on anything high-risk (submit/purchase/delete) — the
   daemon should stop and ask via the inspector confirm UI. Approve or deny deliberately.
4. Record the row.

## What to capture per task

| field | meaning |
|---|---|
| task | one line: what you asked |
| site | domain (no credentials) |
| turns | model round-trips the agent used (attach + views + acts) |
| outcome | completed / partial / failed |
| accuracy | fields correct / total (for forms) |
| intervention | did a human have to step in? what for? |
| gate hit | did a high-risk action get confirmation-gated? correct? |
| notes / failure | anything surprising; paste the exact error |

## Good first tasks (low-stakes, real)

- **Read:** "Summarize the main article on this page" (a news/docs page) — exercises
  `bridge_view` content scope. Zero risk.
- **Form (no submit):** "Fill this contact/profile form with <details>, but DON'T submit" —
  exercises fill + verify; ends before the gated action.
- **Form (with submit):** the same, then submit — the submit should trip a **confirmation**
  if it's a third-party/high-intent control. Note whether the gate fired correctly.
- **Harvest:** "Collect the titles from these 10 pages and list them" — exercises
  `bridge_run_pattern` + `bridge_harvest`.

## Honesty rules for the rows

- Record what happened, not what should have. A partial (like GPT's live 9/22 form) is a
  data point, not a failure to hide.
- If the daemon gated something it shouldn't have (or missed something it should have gate),
  that's the most valuable row — write it up as a finding.
- Secrets never go in a row. Site = domain only; no field values.

When you have 3–5 rows, paste them into `MILESTONE_STATUS.md` → "R1 field data" and send
them over. Those rows + any findings decide what's next (M4 needs them to exist at all).
