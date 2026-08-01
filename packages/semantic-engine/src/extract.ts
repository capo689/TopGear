import type {
  SemanticView,
  ElementRecord,
  FormSummary,
  Alert,
  ContentBlock,
  ViewScope,
  LocatorFingerprint,
  WidgetKind,
} from "@browser-bridge/protocol";
import type { RawView, RawElement } from "./types.js";

const WIDGET_KINDS = new Set<string>([
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

function toWidgetKind(raw: string | undefined): WidgetKind | undefined {
  if (!raw) return undefined;
  return (WIDGET_KINDS.has(raw) ? raw : "custom") as WidgetKind;
}

/** Map a raw element to the MODEL-FACING record (no fingerprint; checked folded in). */
function toElementRecord(e: RawElement): ElementRecord {
  const record: ElementRecord = { ref: e.ref, role: e.role };
  if (e.name !== undefined) record.name = e.name;
  // Checkbox/radio state is surfaced as the value the model reads.
  if (e.checked !== undefined) record.value = String(e.checked);
  else if (e.value !== undefined) record.value = e.value;
  if (e.valueRedacted) record.valueRedacted = true;
  if (e.disabled !== undefined) record.disabled = e.disabled;
  if (e.visible !== undefined) record.visible = e.visible;
  if (e.editable !== undefined) record.editable = e.editable;
  if (e.required !== undefined) record.required = e.required;
  if (e.invalid !== undefined) record.invalid = e.invalid;
  if (e.validationMessage !== undefined) record.validationMessage = e.validationMessage;
  if (e.options !== undefined) record.options = e.options;
  const wk = toWidgetKind(e.widgetKind);
  if (wk) record.widgetKind = wk;
  if (e.requiresExpand !== undefined) record.requiresExpand = e.requiresExpand;
  return record;
}

function toFormSummary(f: RawView["forms"][number]): FormSummary {
  const summary: FormSummary = { ref: f.ref, fields: f.fields };
  if (f.name !== undefined) summary.name = f.name;
  if (f.action !== undefined) summary.action = f.action;
  if (f.method !== undefined) summary.method = f.method;
  if (f.valid !== undefined) summary.valid = f.valid;
  return summary;
}

export interface ViewMeta {
  sessionId: string;
  pageId: string;
  revision: number;
  scope: ViewScope;
}

export interface ExtractedView {
  /** The model-facing view (no fingerprints, untrusted framing stamped). */
  view: SemanticView;
  /** Daemon-side ref → fingerprint index used for execution-time re-resolution. */
  fingerprints: Map<string, LocatorFingerprint>;
}

/**
 * Convert a raw in-page extraction into the protocol `SemanticView` plus the daemon-side
 * fingerprint index. Fingerprints are STRIPPED from the model-facing view (plan §4.2/§5)
 * and the untrusted-content flag is always stamped (INV-2).
 */
export function toSemanticView(raw: RawView, meta: ViewMeta): ExtractedView {
  const fingerprints = new Map<string, LocatorFingerprint>();
  for (const e of raw.elements) fingerprints.set(e.ref, e.fingerprint as LocatorFingerprint);

  const view: SemanticView = {
    sessionId: meta.sessionId,
    pageId: meta.pageId,
    revision: meta.revision,
    url: raw.url,
    origin: raw.origin,
    title: raw.title,
    loading: raw.loading,
    scope: meta.scope,
    elements: raw.elements.map(toElementRecord),
    forms: raw.forms.map(toFormSummary),
    alerts: raw.alerts.map((a): Alert => ({ kind: a.kind, text: a.text })),
    trust: { pageContent: "untrusted" },
  };
  if (raw.content) {
    view.content = raw.content.map((c): ContentBlock => {
      const block: ContentBlock = { kind: c.kind, text: c.text };
      if (c.level !== undefined) block.level = c.level;
      return block;
    });
  }

  return { view, fingerprints };
}
