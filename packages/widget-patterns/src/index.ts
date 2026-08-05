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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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

/**
 * Verify a combobox committed the INTENDED value (D1, live-measured on Greenhouse/react-select).
 *
 * Reads the COMMITTED value — hidden carrier if present, else the rendered selected-value
 * display — never the search input, which react-select clears on commit (the false-failure
 * source). Guardrails:
 *   G1 value-matching, not presence-checking: the committed text must MATCH `wanted`; a
 *      combobox that committed some OTHER option still fails.
 *   G2 fail closed: if no committed signal resolves, this returns false (verification_mismatch).
 *      "I could not find where the value landed" is never success.
 */
function matchesWanted(observed: string, wanted: string): boolean {
  const o = observed.trim().toLowerCase();
  const w = wanted.trim().toLowerCase();
  // Directional containment only (observed ⊇ wanted, or wanted ⊇ observed for a truncated
  // display) — never "non-empty ⇒ pass".
  return o === w || o.includes(w) || w.includes(o);
}

async function verifyContains(page: BrowserPage, ref: string, wanted: string): Promise<boolean> {
  const s = await page.readState(ref);
  if (s.committedValue !== undefined) return matchesWanted(s.committedValue, wanted); // G1 + G2
  if (s.selectedLabel !== undefined && matchesWanted(s.selectedLabel, wanted)) return true;
  if (s.value === undefined) return false; // G2: no signal → fail
  return matchesWanted(s.value, wanted);
}

/** The `select` primitive: native select or a custom ARIA combobox. */
export async function applySelect(page: BrowserPage, element: RawElement, values: string[]): Promise<WidgetResult> {
  if (isNativeSelect(element)) {
    return fromPrimitive(await page.selectOption(element.ref, values));
  }

  if (isCustomCombobox(element)) {
    // Playbook: open the listbox, poll for the option (handles async + rerender), click,
    // verify. Works identically across react-select / Radix / MUI / Ant / headlessui.
    const open = fromPrimitive(await page.click(element.ref));
    if (!open.ok) return open;

    for (const wanted of values) {
      let option: RawElement | undefined;
      let lastOptions: string[] = [];
      for (let attempt = 0; attempt < 40; attempt++) {
        const view = await page.captureRaw({ scope: { kind: "full" }, refPrefix: "combo-" });
        // Only VISIBLE options (from the open listbox) — never a hidden option from
        // another closed combobox on the page.
        const candidates = view.elements.filter((e) => e.role === "option" && e.disabled !== true && e.visible !== false && (e.name?.trim().length ?? 0) > 0);
        lastOptions = candidates.map((e) => e.name ?? "");
        option = candidates.find((e) => e.name === wanted || e.name?.includes(wanted));
        if (option) break;
        await sleep(50);
      }
      if (!option) return { ok: false, reason: "option_not_found", availableOptions: lastOptions };
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

/**
 * The `search_pick` primitive (typeahead): type a query into the combobox, wait for the
 * options to filter, then pick by label or index. ALWAYS verifies (a filtered click that
 * returns without throwing proves nothing).
 */
export async function applySearchPick(
  page: BrowserPage,
  element: RawElement,
  query: string,
  pick: string | { index: number },
): Promise<WidgetResult> {
  // Typeahead inputs filter on input; fill the query (fires input events).
  const typed = fromPrimitive(await page.fillText(element.ref, query));
  if (!typed.ok) {
    // Not an input? open it first (button-style combobox).
    const opened = fromPrimitive(await page.click(element.ref));
    if (!opened.ok) return opened;
  }

  // Poll briefly for the filtered options to appear.
  let options: RawElement[] = [];
  for (let attempt = 0; attempt < 40; attempt++) {
    const view = await page.captureRaw({ scope: { kind: "full" }, refPrefix: "sp-" });
    options = view.elements.filter((e) => e.role === "option" && e.disabled !== true && (e.name?.trim().length ?? 0) > 0);
    if (options.length > 0) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  if (options.length === 0) return { ok: false, reason: "option_not_found", availableOptions: [] };

  const chosen =
    typeof pick === "object"
      ? options[pick.index]
      : options.find((o) => o.name === pick || o.name?.includes(pick));
  if (!chosen) {
    return { ok: false, reason: "option_not_found", availableOptions: options.map((o) => o.name ?? "") };
  }
  const clicked = fromPrimitive(await page.click(chosen.ref));
  if (!clicked.ok) return clicked;

  const wanted = typeof pick === "object" ? (chosen.name ?? "") : pick;
  // Same committed-value verification as applySelect: carrier → rendered display → never the
  // (cleared) search input. Previously this fell back to "we clicked something with a name ⇒ ok",
  // which could report success without observing a commit — removed (G2: fail closed).
  if (await verifyContains(page, element.ref, wanted)) return { ok: true };
  return { ok: false, reason: "error", detail: "combobox value did not update after selection" };
}
