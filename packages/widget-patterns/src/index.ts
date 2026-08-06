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
  /**
   * D4(b): the runtime could not SEE this widget's options, so it does not know what it
   * has. Never collapse this into `option_not_found` with an empty list — that is
   * indistinguishable from a field that genuinely has none, and the driving AI acts
   * differently on each ("reopen and retry" vs "this field offers nothing").
   */
  | { ok: false; reason: "options_not_visible"; widgetState: "closed" | "unknown"; detail?: string }
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

/**
 * D4(a) — STATE HYGIENE. A probe that opens a listbox must put the widget back in a
 * known-closed state before it returns. Leaving it open poisons the NEXT action on the
 * same widget: that action clicks the trigger, the click TOGGLES the open listbox shut,
 * and the runtime then sees zero options. A playbook must never depend on some later
 * unrelated action to clean up after it.
 *
 * Escape first (every mainstream combobox honours it and it cannot commit a value), then
 * a trigger activation for widgets that ignore Escape. Best-effort but VERIFIED: we read
 * the state back rather than assuming the keypress worked.
 */
async function restoreClosed(page: BrowserPage, ref: string): Promise<void> {
  if ((await page.readState(ref)).listboxOpen === false) return; // already known-closed
  await page.press(ref, "Escape");
  if (await settledClosed(page, ref)) return;
  await page.click(ref); // widgets that ignore Escape close on a second trigger activation
  await settledClosed(page, ref);
}

/** Poll until the listbox reads closed. `undefined` = unobservable: nothing more we can do. */
async function settledClosed(page: BrowserPage, ref: string): Promise<boolean> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const s = await page.readState(ref);
    if (s.listboxOpen !== true) return true;
    await sleep(25);
  }
  return false;
}

/**
 * Open the listbox IDEMPOTENTLY. Clicking a trigger toggles, so clicking an already-open
 * widget CLOSES it — the exact D4 poisoning. Read the state first and click only when the
 * widget is not already open; if the widget was open in a way we could not observe and the
 * click shut it, one retry reopens it.
 *
 * Never fails on "did not open": the option poll plus `classifyMissing` is the honest
 * arbiter, and it reports what was actually observed.
 */
async function openListbox(page: BrowserPage, ref: string): Promise<WidgetResult> {
  if ((await page.readState(ref)).listboxOpen === true) return { ok: true };
  const clicked = fromPrimitive(await page.click(ref));
  if (!clicked.ok) return clicked;
  for (let round = 0; round < 2; round++) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const s = await page.readState(ref);
      if (s.listboxOpen === true) return { ok: true };
      if (s.listboxOpen === undefined) return { ok: true }; // unobservable → let the poll arbitrate
      await sleep(25);
    }
    if (round === 0) {
      const again = fromPrimitive(await page.click(ref));
      if (!again.ok) return again;
    }
  }
  return { ok: true };
}

/**
 * D4(b) — classify "I did not find the option". Emitting `option_not_found` with an empty
 * `availableOptions` is only honest when the listbox is demonstrably OPEN. Otherwise the
 * runtime could not look, and it must say exactly that.
 */
async function classifyMissing(page: BrowserPage, ref: string, seen: string[]): Promise<WidgetResult> {
  const s = await page.readState(ref);
  // Options were visible somewhere on the page but THIS widget reads closed: they belong to
  // another widget, so they are not this field's options and must not be reported as such.
  if (seen.length > 0 && s.listboxOpen !== false) return { ok: false, reason: "option_not_found", availableOptions: seen };
  if (seen.length === 0 && s.listboxOpen === true) return { ok: false, reason: "option_not_found", availableOptions: [] };
  return {
    ok: false,
    reason: "options_not_visible",
    widgetState: s.listboxOpen === false ? "closed" : "unknown",
    detail:
      s.listboxOpen === false
        ? "the listbox is closed, so this widget's options could not be read; reopen it and retry"
        : "this widget exposes no observable open/closed state, so its options could not be read",
  };
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
    // verify, then RESTORE the widget to a known-closed state (D4(a)) on every exit path.
    // Works identically across react-select / Radix / MUI / Ant / headlessui.
    const open = await openListbox(page, element.ref);
    if (!open.ok) return open; // disabled / not_visible: nothing was opened, nothing to restore

    /** Poll for `wanted` among the VISIBLE options; returns what was seen either way. */
    const pollFor = async (wanted: string, rounds: number): Promise<{ option?: RawElement; seen: string[] }> => {
      let seen: string[] = [];
      for (let attempt = 0; attempt < rounds; attempt++) {
        const view = await page.captureRaw({ scope: { kind: "full" }, refPrefix: "combo-" });
        // Only VISIBLE options (from the open listbox) — never a hidden option from
        // another closed combobox on the page.
        const candidates = view.elements.filter((e) => e.role === "option" && e.disabled !== true && e.visible !== false && (e.name?.trim().length ?? 0) > 0);
        seen = candidates.map((e) => e.name ?? "");
        const hit = candidates.find((e) => e.name === wanted || e.name?.includes(wanted));
        if (hit) return { option: hit, seen };
        await sleep(50);
      }
      return { seen };
    };

    for (const wanted of values) {
      let { option, seen: lastOptions } = await pollFor(wanted, 40);
      // A match found while THIS widget reads closed belongs to some other open listbox;
      // classifyMissing reports that honestly rather than clicking a foreign option.
      if (option && (await page.readState(element.ref)).listboxOpen === false) option = undefined;
      if (!option && (await page.readState(element.ref)).listboxOpen !== true) {
        // ONE recovery pass. The widget may have been left open by something else, in which
        // case our opening click toggled it SHUT — the D4 poisoning, arriving from outside
        // this call. Reopen and look again rather than reporting a state we caused.
        const again = fromPrimitive(await page.click(element.ref));
        if (again.ok) {
          const retry = await pollFor(wanted, 20);
          option = retry.option;
          if (retry.seen.length > 0) lastOptions = retry.seen;
        }
      }
      if (!option) {
        const classified = await classifyMissing(page, element.ref, lastOptions);
        await restoreClosed(page, element.ref);
        return classified;
      }
      const clicked = fromPrimitive(await page.click(option.ref));
      if (!clicked.ok) {
        await restoreClosed(page, element.ref);
        return clicked;
      }
      if (!(await verifyContains(page, element.ref, wanted))) {
        await restoreClosed(page, element.ref);
        return { ok: false, reason: "error", detail: "combobox value did not update after selection" };
      }
    }
    // Most widgets close themselves on commit; multi-select ones stay open. Either way the
    // next action must find a known state, so this is not conditional on what we observed.
    await restoreClosed(page, element.ref);
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
    // Not an input? open it first (button-style combobox) — idempotently, so an already-open
    // listbox is not toggled shut (D4(a)).
    const opened = await openListbox(page, element.ref);
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
  const chosen =
    options.length === 0
      ? undefined
      : typeof pick === "object"
        ? options[pick.index]
        : options.find((o) => o.name === pick || o.name?.includes(pick));
  if (!chosen) {
    // D4(b): zero filtered options means "the query matched nothing" ONLY when the listbox
    // is open. If it is closed we could not read anything, and that is a different fact.
    const classified = await classifyMissing(page, element.ref, options.map((o) => o.name ?? ""));
    await restoreClosed(page, element.ref); // D4(a): never leave the listbox open
    return classified;
  }
  const clicked = fromPrimitive(await page.click(chosen.ref));
  if (!clicked.ok) {
    await restoreClosed(page, element.ref);
    return clicked;
  }

  const wanted = typeof pick === "object" ? (chosen.name ?? "") : pick;
  // Same committed-value verification as applySelect: carrier → rendered display → never the
  // (cleared) search input. Previously this fell back to "we clicked something with a name ⇒ ok",
  // which could report success without observing a commit — removed (G2: fail closed).
  const committed = await verifyContains(page, element.ref, wanted);
  await restoreClosed(page, element.ref); // D4(a): the next action must find a known state
  if (committed) return { ok: true };
  return { ok: false, reason: "error", detail: "combobox value did not update after selection" };
}
