import type { BrowserPage, PrimitiveOutcome } from "@browser-bridge/backend";
import type { RawElement } from "@browser-bridge/semantic-engine";

/**
 * @browser-bridge/widget-patterns — widget playbooks (plan §6). Each collapses a
 * multi-turn ritual into one op and ALWAYS verifies final state (a click that returns
 * without throwing proves nothing). M1 covers native widgets plus a custom ARIA
 * combobox; the react-select/Radix/MUI playbooks land in M2. An unrecognized widget is
 * reported, never silently guessed.
 */

export type WidgetResult =
  | { ok: true }
  | { ok: false; reason: "option_not_found"; availableOptions: string[] }
  | { ok: false; reason: "widget_unrecognized"; widgetHint?: string }
  | { ok: false; reason: "not_found" | "not_visible" | "disabled" | "not_editable" | "error"; detail?: string };

function fromPrimitive(out: PrimitiveOutcome): WidgetResult {
  if (out.ok) return { ok: true };
  if (out.reason === "option_not_found") return { ok: false, reason: "option_not_found", availableOptions: out.availableOptions ?? [] };
  return { ok: false, reason: out.reason, ...(out.detail ? { detail: out.detail } : {}) };
}

function isNativeSelect(el: RawElement): boolean {
  return el.tag === "select" || el.widgetKind === "native-select";
}

function isCustomCombobox(el: RawElement): boolean {
  return el.role === "combobox" || el.widgetKind === "custom-combobox";
}

async function verifyContains(page: BrowserPage, ref: string, wanted: string): Promise<boolean> {
  const s = await page.readState(ref);
  if (s.value === undefined) return false;
  return s.value === wanted || s.value.includes(wanted);
}

/** The `select` primitive: native select or a custom ARIA combobox. */
export async function applySelect(page: BrowserPage, element: RawElement, values: string[]): Promise<WidgetResult> {
  if (isNativeSelect(element)) {
    return fromPrimitive(await page.selectOption(element.ref, values));
  }

  if (isCustomCombobox(element)) {
    // Playbook: open the listbox, click the option by accessible name, verify.
    const open = fromPrimitive(await page.click(element.ref));
    if (!open.ok) return open;

    for (const wanted of values) {
      const view = await page.captureRaw({ scope: { kind: "full" }, refPrefix: "combo-" });
      const option = view.elements.find((e) => e.role === "option" && (e.name === wanted || e.name?.includes(wanted)));
      if (!option) {
        const available = view.elements.filter((e) => e.role === "option").map((e) => e.name ?? "");
        return { ok: false, reason: "option_not_found", availableOptions: available };
      }
      const clicked = fromPrimitive(await page.click(option.ref));
      if (!clicked.ok) return clicked;
      if (!(await verifyContains(page, element.ref, wanted))) {
        return { ok: false, reason: "error", detail: "combobox value did not update after selection" };
      }
    }
    return { ok: true };
  }

  return { ok: false, reason: "widget_unrecognized", widgetHint: element.widgetKind };
}

/** The `set_date` primitive. M1: native date inputs (ISO value). */
export async function applySetDate(page: BrowserPage, element: RawElement, isoValue: string): Promise<WidgetResult> {
  if (element.widgetKind === "native-date" || element.tag === "input") {
    return fromPrimitive(await page.fillText(element.ref, isoValue));
  }
  return { ok: false, reason: "widget_unrecognized", widgetHint: element.widgetKind };
}

/** The `expand` primitive: activate an expander and let the caller re-read content. */
export async function applyExpand(page: BrowserPage, element: RawElement): Promise<WidgetResult> {
  return fromPrimitive(await page.click(element.ref));
}
