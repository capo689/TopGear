/**
 * @browser-bridge/fixture-farm — the self-hosted gauntlet (plan §12). Tests import
 * `startFixtureFarm` and drive the real pages; nothing here mocks the thing under test.
 */
export * from "./server.js";

/** The catalog of fixture routes, for tests and evals to reference by name. */
export const FIXTURES = {
  index: "/",
  nativeForm: "/forms/native-form.html",
  dependentSelect: "/forms/dependent-select.html",
  nativeSelect: "/widgets/native-select.html",
  customSelect: "/widgets/custom-select.html",
  libraryWidgets: "/widgets/library-widgets.html",
  accordion: "/widgets/accordion.html",
  /** Debounced typeahead whose listbox is empty until text is typed (Slate shape). */
  asyncTypeahead: "/widgets/async-typeahead.html",
  /** Commits only a fragment of the option label ("United States +1" -> "+1"). */
  fragmentCommit: "/widgets/fragment-commit.html",
  /** Real fields with no <form> ancestor, beside an unrelated site-search form. */
  pseudoForm: "/forms/pseudo-form.html",
  /** Tables, infobox, spanned cells, multi-value cells, definition list, figcaption. */
  tablesAndLists: "/content/tables-and-lists.html",
  /** nav/header/main/article/footer, for landmark-scoped content reads. */
  landmarks: "/content/landmarks.html",
  injection: "/security/injection.html",
  grantEscape: "/security/grant-escape.html",
  // Expected-fail until M5 (full risk classifier + network backstop). See MILESTONE_STATUS.
  blandDestructive: "/security/bland-destructive.html",
  fetchExfil: "/security/fetch-exfil.html",
  consentBanner: "/security/consent-banner.html",
} as const;

export type FixtureName = keyof typeof FIXTURES;
