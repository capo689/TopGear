#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseEventsJsonl, aggregateRuns, summarizeRuns } from "./live-recorder.js";

/**
 * `node dist/live-summarize.js <BB_EVAL_LOG.jsonl>` → prints the reproducible comparison table
 * from a benchmark round's raw event log. A round is re-runnable from the file, not a transcript.
 */
function main(): void {
  const path = process.argv[2];
  if (!path) {
    process.stderr.write("usage: live-summarize <events.jsonl>\n");
    process.exit(2);
  }
  const events = parseEventsJsonl(readFileSync(path, "utf8"));
  const runs = aggregateRuns(events);
  process.stdout.write(summarizeRuns(runs) + "\n");
}

main();
