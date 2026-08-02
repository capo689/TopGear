/**
 * Consent onboarding disclosure (§9.3). Plain-language, disclosed default-on for the
 * free client. The claims here are enforced by architecture (INV-6 classification), not
 * by server-side promise. The inspector-ui renders this at onboarding.
 */
export const CONSENT_DISCLOSURE = [
  "Browser Bridge gets faster for everyone by learning the *structure* of public",
  "websites — which widgets a page uses, where its form fields are. It never sends your",
  "content, your form values, your cookies, or anything from internal or signed-in",
  "sites. You can see every record it sends, and turn it off anytime — off is instant",
  "and purges anything not yet promoted.",
].join(" ");

export interface OnboardingChoice {
  /** Class C public-structure contribution. Disclosed default-on; one click off. */
  contributeClassC: boolean;
}

export function defaultOnboarding(): OnboardingChoice {
  return { contributeClassC: true };
}
