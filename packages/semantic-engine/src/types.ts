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
