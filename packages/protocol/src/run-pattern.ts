import { z } from "zod";

/** Per-run budget override (composes with the TaskGrant budgets). */
export const RunBudget = z.object({
  maxPages: z.number().int().nonnegative().optional(),
  maxDownloadBytes: z.number().int().nonnegative().optional(),
});
export type RunBudget = z.infer<typeof RunBudget>;

/** `bridge_run_pattern` input: the URLs to harvest under the session's grant + policy. */
export const RunPatternRequest = z.object({
  urls: z.array(z.string()),
  budget: RunBudget.optional(),
});
export type RunPatternRequest = z.infer<typeof RunPatternRequest>;

export const RunPatternResult = z.object({
  requested: z.number().int(),
  harvested: z.number().int(),
  deduped: z.number().int(),
  skipped: z.array(z.object({ url: z.string(), reason: z.string() })),
  exceptions: z.array(z.object({ url: z.string(), error: z.string() })),
});
export type RunPatternResult = z.infer<typeof RunPatternResult>;

/** `bridge_harvest` input: query the local corpus (Class A stays on the machine). */
export const HarvestRequest = z.object({
  mode: z.enum(["search", "list", "export"]),
  query: z.string().optional(),
  limit: z.number().int().positive().optional(),
  chunkSize: z.number().int().positive().optional(),
});
export type HarvestRequest = z.infer<typeof HarvestRequest>;

export const HarvestRecordDTO = z.object({
  url: z.string(),
  title: z.string().optional(),
  text: z.string().optional(),
  harvestedAt: z.number().int(),
});
export type HarvestRecordDTO = z.infer<typeof HarvestRecordDTO>;

export const HarvestResult = z.object({
  count: z.number().int(),
  records: z.array(HarvestRecordDTO).optional(),
  chunks: z.array(z.array(HarvestRecordDTO)).optional(),
});
export type HarvestResult = z.infer<typeof HarvestResult>;
