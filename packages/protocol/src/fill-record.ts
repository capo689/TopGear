import { z } from "zod";
import { SecretRef } from "./primitives.js";
import { ElementRecord } from "./element.js";
import { BatchResult } from "./result.js";

/** A value in a fill-from-record: text, a boolean (checkbox/radio), or a secret. */
export const FieldValue = z.union([z.string(), z.boolean(), SecretRef]);
export type FieldValue = z.infer<typeof FieldValue>;

/** How to handle a record key that matches more than one field within the gap. */
export const AmbiguityPolicy = z.enum(["ask", "skip", "best_effort"]);
export type AmbiguityPolicy = z.infer<typeof AmbiguityPolicy>;

export const FillRecordRequest = z.object({
  record: z.record(FieldValue),
  ambiguityPolicy: AmbiguityPolicy.optional(),
});
export type FillRecordRequest = z.infer<typeof FillRecordRequest>;

export const FieldMatch = z.object({
  field: z.string(),
  /** The matched element's label. */
  target: z.string(),
  confidence: z.number(),
});
export type FieldMatch = z.infer<typeof FieldMatch>;

export const FieldAmbiguity = z.object({
  field: z.string(),
  candidates: z.array(ElementRecord),
});
export type FieldAmbiguity = z.infer<typeof FieldAmbiguity>;

/**
 * Result of `bridge_fill_record`: what matched (with confidence), what did not, and any
 * ambiguities for the model to arbitrate. `batch` is the verified execution result of
 * the matched fills. Deterministic matching — no embedded model (INV-11).
 */
export const FillRecordResult = z.object({
  matched: z.array(FieldMatch),
  unmatched: z.array(z.string()),
  ambiguities: z.array(FieldAmbiguity),
  batch: BatchResult,
});
export type FillRecordResult = z.infer<typeof FillRecordResult>;
