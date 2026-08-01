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
  accordion: "/widgets/accordion.html",
  injection: "/security/injection.html",
  grantEscape: "/security/grant-escape.html",
} as const;

export type FixtureName = keyof typeof FIXTURES;
