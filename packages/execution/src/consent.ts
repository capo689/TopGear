import type { RawView, RawElement } from "@browser-bridge/semantic-engine";
import type { PopupSignal } from "@browser-bridge/policy";

const ACCEPT_ALL = /accept all|allow all|accept cookies|allow cookies/i;
const REJECT = /reject all|reject|decline|refuse|deny/i;
const NECESSARY = /necessary only|essential only|only necessary|strictly necessary/i;
const CONSENT_CONTEXT = /cookie|consent|gdpr|tracking|privacy/i;

export interface ConsentDetection {
  signal: PopupSignal;
  acceptAll?: RawElement;
  reject?: RawElement;
  necessary?: RawElement;
}

/**
 * Detect a cookie/consent banner and its buttons. Consent banners are consent decisions,
 * not noise (plan §7.5). The `acceptAll` button is surfaced only so the reflex knows NOT
 * to click it.
 */
export function detectConsentBanner(view: RawView): ConsentDetection | null {
  const buttons = view.elements.filter((e) => e.role === "button" || e.role === "link");
  const acceptAll = buttons.find((b) => ACCEPT_ALL.test(b.name ?? ""));
  const necessary = buttons.find((b) => NECESSARY.test(b.name ?? ""));
  const reject = buttons.find((b) => REJECT.test(b.name ?? "") && b !== necessary);

  const contextText = [
    ...(view.content ?? []).map((c) => c.text),
    ...view.alerts.map((a) => a.text),
    view.title,
  ].join(" ");
  const hasConsentContext = CONSENT_CONTEXT.test(contextText) || acceptAll !== undefined;

  if (!hasConsentContext || (!acceptAll && !reject && !necessary)) return null;

  const signal: PopupSignal = {
    kind: "cookie_consent",
    consentBearing: true,
    taskRelevant: false,
    hasRejectOption: reject !== undefined,
    hasNecessaryOnlyOption: necessary !== undefined,
  };
  return {
    signal,
    ...(acceptAll ? { acceptAll } : {}),
    ...(reject ? { reject } : {}),
    ...(necessary ? { necessary } : {}),
  };
}
