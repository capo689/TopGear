# Engineering records

These are the project's internal build records. They are kept for history and for
contributors who want the reasoning behind the code. **You do not need any of them to install
or use Browser Bridge**; start with the [README](../../README.md) and [install guide](../install.md).

| File | What it is |
|---|---|
| [`browser-bridge-build-plan-v2.md`](browser-bridge-build-plan-v2.md) | The original design spec. Section numbers cited in code comments (`plan §11`, etc.) refer to this file. |
| [`STANDING_LAW.md`](STANDING_LAW.md) | The scorecard, hard invariants (INV-1..INV-11) and conventions every change must respect. Formerly the root `CLAUDE.md`; the root file now imports it. |
| [`DECISIONS.md`](DECISIONS.md) | Judgment calls the spec did not dictate, with one-line rationales. |
| [`MILESTONE_STATUS.md`](MILESTONE_STATUS.md) | Milestone acceptance checklists and the evidence for each. |
| [`DOGFOOD.md`](DOGFOOD.md) | Runbook for collecting field data from real-site sessions. |
| [`EXTENSION_LIVELOAD.md`](EXTENSION_LIVELOAD.md) | Record-only checklist for the first extension run in a real signed-in Chrome. |

These files are append-only logs written during development. Older entries refer to the
previous file locations (for example `CLAUDE.md`, `INSTALL.md` at the repo root) and to
internal milestones; read them as history, not as current instructions. Some operational
details of the hosted commons service (database host names, project names) were trimmed
from these copies when the repo was made public.

The `scripts/gate-*.mjs` files are the release gates referenced throughout these records.
They are maintainer tools, not part of the user install.
