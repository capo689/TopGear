import { z } from "zod";
import { WidgetKind } from "./primitives.js";
import { LocatorFingerprint } from "./locator.js";

/**
 * A single element as exposed to models. Compact by design (plan §5): no raw DOM,
 * no AX tree, no CSS. Secret field values are redacted (INV-4): `value` is omitted and
 * `valueRedacted` is true.
 */
export const ElementRecord = z.object({
  /** Short-lived handle valid for the current view revision. */
  ref: z.string(),
  role: z.string(),
  name: z.string().optional(),
  /** Current value for non-sensitive fields; omitted when redacted. */
  value: z.string().optional(),
  /** True when the value was withheld because the field is secret-tagged (INV-4). */
  valueRedacted: z.boolean().optional(),
  disabled: z.boolean().optional(),
  visible: z.boolean().optional(),
  editable: z.boolean().optional(),
  required: z.boolean().optional(),
  invalid: z.boolean().optional(),
  validationMessage: z.string().optional(),
  /** Enumerable options for selects/listboxes. */
  options: z.array(z.string()).optional(),
  widgetKind: WidgetKind.optional(),
  /** Present only in daemon-internal views; stripped before crossing to models. */
  fingerprint: LocatorFingerprint.optional(),
  /** Content exists but is behind a lazy-on-expand container (plan §5). */
  requiresExpand: z.boolean().optional(),
  framePath: z.array(z.string()).optional(),
});
export type ElementRecord = z.infer<typeof ElementRecord>;

/** A form and its field references. `action` feeds exfiltration policy (T4). */
export const FormSummary = z.object({
  ref: z.string(),
  name: z.string().optional(),
  /** Resolved form action URL — checked against the grant before any submit. */
  action: z.string().optional(),
  method: z.string().optional(),
  /** Refs of the fields contained in this form. */
  fields: z.array(z.string()),
  valid: z.boolean().optional(),
});
export type FormSummary = z.infer<typeof FormSummary>;

/** An alert/message region surfaced from the page. */
export const Alert = z.object({
  kind: z.enum(["error", "warning", "status"]),
  text: z.string(),
});
export type Alert = z.infer<typeof Alert>;

/**
 * A block of readable content (plan §5). ALWAYS treated as untrusted data (INV-2);
 * the containing view carries the `trust.pageContent = "untrusted"` flag.
 */
export const ContentBlock = z.object({
  kind: z.enum(["heading", "paragraph", "list", "table", "code", "quote", "other"]),
  text: z.string(),
  /** Heading level, when kind === "heading". */
  level: z.number().int().min(1).max(6).optional(),
});
export type ContentBlock = z.infer<typeof ContentBlock>;
