import { z } from "zod";

/** Popup taxonomy the daemon classifies before any reflex fires. */
export const PopupKind = z.enum([
  "cookie_consent",
  "newsletter",
  "app_promo",
  "interstitial",
  "chat_widget",
  "modal",
  "unknown",
]);
export type PopupKind = z.infer<typeof PopupKind>;

/** What the daemon observed about a popup (all daemon-derived, never model-asserted). */
export interface PopupSignal {
  kind: PopupKind;
  /** Does this popup carry a consent decision (cookies, tracking, terms)? */
  consentBearing: boolean;
  /** Is the popup relevant to the current task (e.g. a required dialog)? */
  taskRelevant: boolean;
  hasRejectOption?: boolean;
  hasNecessaryOnlyOption?: boolean;
}

export type ReflexDecision =
  | { action: "dismiss"; rule: string }
  | { action: "reject_non_essential"; rule: string }
  | { action: "surface"; reason: string };

/** User-configurable reflex behavior (plan §7.5). Conservative defaults. */
export const ReflexConfig = z.object({
  /** Dismiss non-task-relevant, non-consent popups automatically. */
  dismissNonEssentialPopups: z.boolean().default(true),
  /** For consent banners: prefer reject/necessary-only, or always surface. */
  consentDefault: z.enum(["reject", "surface"]).default("reject"),
});
export type ReflexConfig = z.infer<typeof ReflexConfig>;

export const DEFAULT_REFLEX_CONFIG: ReflexConfig = {
  dismissNonEssentialPopups: true,
  consentDefault: "reject",
};

/**
 * Decide what to do about a popup (INV-5, plan §7.5). The invariants encoded here:
 *  - Task-relevant popups are NEVER auto-touched — they surface.
 *  - Consent banners are consent decisions, not noise: the reflex chooses
 *    reject / necessary-only where offered, else surfaces. "Accept all" is NEVER an
 *    automatic reflex.
 *  - Only popups classified non-task-relevant AND non-consent-bearing are dismissible.
 */
export function decideReflex(
  signal: PopupSignal,
  config: ReflexConfig = DEFAULT_REFLEX_CONFIG,
): ReflexDecision {
  if (signal.taskRelevant) {
    return { action: "surface", reason: "task_relevant" };
  }

  if (signal.consentBearing) {
    const canRejectCleanly = signal.hasRejectOption === true || signal.hasNecessaryOnlyOption === true;
    if (config.consentDefault === "reject" && canRejectCleanly) {
      return { action: "reject_non_essential", rule: "consent_reject_non_essential" };
    }
    return { action: "surface", reason: "consent_requires_decision" };
  }

  if (config.dismissNonEssentialPopups) {
    return { action: "dismiss", rule: "dismiss_non_essential" };
  }
  return { action: "surface", reason: "reflex_disabled" };
}
