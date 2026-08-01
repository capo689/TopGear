import { z } from "zod";

/**
 * What MODELS send to point at an element — deliberately simple (INV-8).
 * `ref` is a short-lived handle from the current view; if the view's revision still
 * matches at execution the daemon resolves it directly (fast path), otherwise it falls
 * back to fingerprint re-resolution automatically (plan §4.3). At least one field
 * should be present, but the daemon tolerates and teaches rather than hard-rejecting.
 */
export const LocatorInput = z.object({
  role: z.string().optional(),
  name: z.string().optional(),
  ref: z.string().optional(),
});
export type LocatorInput = z.infer<typeof LocatorInput>;

/**
 * A reference to a secret value, resolved only by the Secrets Broker (INV-4). The
 * actual value NEVER appears in the protocol, model context, logs, or crash dumps.
 */
export const SecretRef = z.object({
  secretRef: z.string().min(1),
});
export type SecretRef = z.infer<typeof SecretRef>;

/** A value that may be a literal string or a broker-resolved secret. */
export const FillValue = z.union([z.string(), SecretRef]);
export type FillValue = z.infer<typeof FillValue>;

/** Type guard: is this fill value a SecretRef? */
export function isSecretRef(value: FillValue): value is SecretRef {
  return typeof value === "object" && value !== null && "secretRef" in value;
}

/** Risk tiers for actions (plan §10 T2). The ceiling for ungated execution. */
export const RiskTier = z.enum(["low", "medium", "high"]);
export type RiskTier = z.infer<typeof RiskTier>;

/**
 * Widget taxonomy the detector maps DOM shapes onto (plan §6). `unknown` means the
 * detector could not classify — the daemon surfaces `widget_unrecognized`, never a
 * silent guess.
 */
export const WidgetKind = z.enum([
  "native-select",
  "react-select",
  "radix",
  "mui",
  "headlessui",
  "downshift",
  "ant",
  "custom-combobox",
  "native-date",
  "custom-datepicker",
  "typeahead",
  "custom",
  "unknown",
]);
export type WidgetKind = z.infer<typeof WidgetKind>;

/** Loading state of a page/view. */
export const LoadingState = z.enum(["loading", "interactive", "idle"]);
export type LoadingState = z.infer<typeof LoadingState>;
