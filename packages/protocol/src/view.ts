import { z } from "zod";
import { LocatorInput, LoadingState } from "./primitives.js";
import { ElementRecord, FormSummary, Alert, ContentBlock } from "./element.js";

/**
 * Structural region for a content-reading view (plan §4.2). No raw CSS in the normal
 * contract — arbitrary CSS is an injection/ambiguity surface, available only behind an
 * advanced capability flag granted per-integration.
 */
export const SemanticRegion = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("main") }),
  z.object({ kind: z.literal("article") }),
  z.object({ kind: z.literal("section"), heading: z.string() }),
  z.object({ kind: z.literal("element"), target: LocatorInput }),
]);
export type SemanticRegion = z.infer<typeof SemanticRegion>;

/**
 * The scope a view was requested at. The daemon provides structural scopes only; there
 * is no `goal: string` — relevance filtering is the model's job (plan §4.2).
 */
export const ViewScope = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("visible_form") }),
  z.object({ kind: z.literal("all_forms") }),
  z.object({ kind: z.literal("viewport") }),
  z.object({ kind: z.literal("region"), near: LocatorInput }),
  z.object({ kind: z.literal("invalid_fields") }),
  z.object({ kind: z.literal("content"), region: SemanticRegion.optional() }),
  z.object({ kind: z.literal("full") }),
]);
export type ViewScope = z.infer<typeof ViewScope>;

/**
 * A compact structured view of the page (plan §4.2, §5). Typical form view ≤ 4 KB;
 * never raw DOM/AX trees/CSS. `trust.pageContent` is ALWAYS "untrusted" (INV-2).
 */
export const SemanticView = z.object({
  sessionId: z.string(),
  pageId: z.string(),
  revision: z.number().int(),
  url: z.string(),
  origin: z.string(),
  title: z.string(),
  loading: LoadingState,
  scope: ViewScope,
  elements: z.array(ElementRecord),
  forms: z.array(FormSummary),
  alerts: z.array(Alert),
  content: z.array(ContentBlock).optional(),
  trust: z.object({ pageContent: z.literal("untrusted") }),
});
export type SemanticView = z.infer<typeof SemanticView>;
