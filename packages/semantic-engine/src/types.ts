/**
 * Plain (Zod-free) shapes the in-page extractor returns. They must be JSON-serializable
 * and importable by both the browser-side extractor and the Node host, so nothing here
 * depends on protocol/Zod. The host maps RawView → the protocol `SemanticView`.
 */

export interface RawFingerprint {
  role?: string;
  name?: string;
  testId?: string;
  autocomplete?: string;
  inputType?: string;
  stableAttributes?: Record<string, string>;
  formContext?: string;
  structuralFingerprint?: string;
}

export interface RawElement {
  ref: string;
  role: string;
  name?: string;
  value?: string;
  valueRedacted?: boolean;
  checked?: boolean;
  disabled?: boolean;
  visible?: boolean;
  editable?: boolean;
  required?: boolean;
  invalid?: boolean;
  validationMessage?: string;
  options?: string[];
  widgetKind?: string;
  requiresExpand?: boolean;
  fingerprint: RawFingerprint;
  tag: string;
  formRef?: string;
  /** True when this control submits a form (button/input of type submit, or default). */
  submit?: boolean;
}

export interface RawForm {
  ref: string;
  name?: string;
  action?: string;
  method?: string;
  fields: string[];
  valid?: boolean;
}

export interface RawAlert {
  kind: "error" | "warning" | "status";
  text: string;
}

export interface RawContentBlock {
  kind: "heading" | "paragraph" | "list" | "table" | "code" | "quote" | "other";
  text: string;
  level?: number;
}

export type ScopeInput =
  | { kind: "visible_form" }
  | { kind: "all_forms" }
  | { kind: "viewport" }
  | { kind: "invalid_fields" }
  | { kind: "full" }
  | { kind: "content"; heading?: string }
  | { kind: "region"; nearRef?: string };

export interface ExtractOptions {
  scope: ScopeInput;
  /** Prefix for element refs so successive views can be told apart if needed. */
  refPrefix: string;
  /** data-* names the daemon has tagged as sensitive (values redacted). */
  sensitiveAttributes?: string[];
}

/** Targeted read-back of one element's state, used for post-action verification. */
export interface ElementStateResult {
  found: boolean;
  value?: string;
  /**
   * For <select>/combobox: the human-readable label(s) of the selected option(s),
   * alongside `value` (the option value attribute). Verification accepts a match on
   * EITHER, so requesting "Oregon" against <option value="OR">Oregon</option> verifies.
   */
  selectedLabel?: string;
  /**
   * The COMMITTED selection for a combobox — the value the form actually submits — resolved
   * from a named hidden carrier if one exists, else the rendered selected-value display.
   * NEVER the search input (react-select clears it on commit). Absent when nothing resolved,
   * so verification fails closed rather than guessing.
   */
  committedValue?: string;
  /** Which signal produced `committedValue` (for honest per-field reporting). */
  committedSignal?: "carrier" | "display";
  /**
   * D4: for a combobox, whether its listbox is OPEN and its options are therefore
   * observable right now. `true` open, `false` closed, ABSENT when the runtime cannot
   * tell. Three states, never two: "I could not look" and "there is nothing there" are
   * different facts and callers act differently on each.
   */
  listboxOpen?: boolean;
  /** Which signal produced `listboxOpen` (for honest reporting). */
  listboxSignal?: "listbox-visible" | "aria-expanded";
  checked?: boolean;
  disabled: boolean;
  invalid: boolean;
  visible: boolean;
}

export interface RawView {
  url: string;
  origin: string;
  title: string;
  loading: "loading" | "interactive" | "idle";
  elements: RawElement[];
  forms: RawForm[];
  alerts: RawAlert[];
  content?: RawContentBlock[];
  /** Structural signature used by the revisioner to classify mutations. */
  signature: string;
}
