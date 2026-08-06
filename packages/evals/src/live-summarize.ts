#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseEventsJsonl, parseRunsJsonl, aggregateRuns, summarizeRuns } from "./live-recorder.js";

/**
 * `node dist/live-summarize.js <bridge-events.jsonl> [baseline-runs.jsonl]`
 *
 * Prints the reproducible two-arm comparison table. The first file is the daemon's raw
 * BB_EVAL_LOG events (bridge arm). The optional second file is externally-measured, already
 * per-run baseline records (the baseline arm never touches the daemon — see BASELINES.md).
 * A round is re-runnable from the files, not a transcript.
 */
function main(): void {
  const eventsPath = process.argv[2];
  const baselinePath = process.argv[3];
  if (!eventsPath) {
    process.stderr.write("usage: live-summarize <bridge-events.jsonl> [baseline-runs.jsonl]\n");
    process.exit(2);
  }
  const runs = aggregateRuns(parseEventsJsonl(readFileSync(eventsPath, "utf8")));
  if (baselinePath) runs.push(...parseRunsJsonl(readFileSync(baselinePath, "utf8")));
  process.stdout.write(summarizeRuns(runs) + "\n");
}

main();
