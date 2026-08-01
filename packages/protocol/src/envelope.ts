import { z } from "zod";

/**
 * Wraps every request/response (plan §4.1). `schemaVersion` is negotiated at attach;
 * mismatches are rejected clearly. `idempotencyKey` lets a batch be retried safely.
 * `deadlineMs` bounds daemon work; past it the daemon aborts and returns partials.
 */
export const Envelope = z.object({
  schemaVersion: z.string(),
  correlationId: z.string().min(1),
  idempotencyKey: z.string().optional(),
  deadlineMs: z.number().int().positive().optional(),
});
export type Envelope = z.infer<typeof Envelope>;
