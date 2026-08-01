import type { RawView, RawElement } from "./types.js";

/**
 * Scoped-staleness diffing (plan §4.3/§5). Mutations are classified so that unrelated
 * page churn ("noise") never bumps the revision — `expected_revision` rejects only when
 * the TARGETED elements or their containing form actually changed.
 */
export type MutationClass = "target-relevant" | "structure-relevant" | "noise";

function descriptor(e: RawElement): string {
  return JSON.stringify([
    e.role,
    e.name ?? "",
    e.value ?? "",
    e.checked ?? "",
    e.disabled ? 1 : 0,
    e.invalid ? 1 : 0,
    e.required ? 1 : 0,
    e.requiresExpand ? 1 : 0,
    (e.options ?? []).join(","),
  ]);
}

function elementMap(view: RawView): Map<string, RawElement> {
  return new Map(view.elements.map((e) => [e.ref, e]));
}

function changedRefs(prev: RawView, next: RawView): Set<string> {
  const prevMap = elementMap(prev);
  const nextMap = elementMap(next);
  const changed = new Set<string>();
  for (const [ref, e] of nextMap) {
    const before = prevMap.get(ref);
    if (!before || descriptor(before) !== descriptor(e)) changed.add(ref);
  }
  for (const ref of prevMap.keys()) if (!nextMap.has(ref)) changed.add(ref);
  return changed;
}

/** The form refs that contain any of the target refs, in either view. */
function targetForms(prev: RawView, next: RawView, targetRefs: string[]): Set<string> {
  const targets = new Set(targetRefs);
  const forms = new Set<string>();
  for (const view of [prev, next]) {
    for (const e of view.elements) {
      if (e.formRef && targets.has(e.ref)) forms.add(e.formRef);
    }
  }
  return forms;
}

export interface DiffResult {
  classification: MutationClass;
  changedRefs: string[];
}

export function diffViews(prev: RawView, next: RawView, targetRefs: string[] = []): DiffResult {
  const changed = changedRefs(prev, next);
  if (changed.size === 0) return { classification: "noise", changedRefs: [] };

  const targets = new Set(targetRefs);
  for (const ref of changed) if (targets.has(ref)) return { classification: "target-relevant", changedRefs: [...changed] };

  // A target is also stale if its containing form's STRUCTURE changed — fields added or
  // removed, the form appearing/disappearing, or its aggregate validity flipping. A
  // *sibling field's value* changing is NOT structural, so it stays noise to the target.
  const forms = targetForms(prev, next, targetRefs);
  for (const formRef of forms) {
    const before = prev.forms.find((f) => f.ref === formRef);
    const after = next.forms.find((f) => f.ref === formRef);
    if (!before || !after) return { classification: "target-relevant", changedRefs: [...changed] };
    if (before.fields.join(",") !== after.fields.join(",")) return { classification: "target-relevant", changedRefs: [...changed] };
    if (before.valid !== after.valid) return { classification: "target-relevant", changedRefs: [...changed] };
  }

  // Changed, but not the targets or their form structure: structure-relevant only if
  // fields/forms appeared or disappeared; pure value flips elsewhere are noise.
  const structural = prev.elements.length !== next.elements.length || prev.forms.length !== next.forms.length;
  return { classification: structural ? "structure-relevant" : "noise", changedRefs: [...changed] };
}

/** True only if the specific target's own descriptor changed between two views. */
export function didTargetChange(prev: RawView, next: RawView, ref: string): boolean {
  const before = prev.elements.find((e) => e.ref === ref);
  const after = next.elements.find((e) => e.ref === ref);
  if (!before || !after) return true;
  return descriptor(before) !== descriptor(after);
}

/**
 * Tracks a page's revision number. Noise does not bump it (INV: staleness is scoped).
 */
export class Revisioner {
  private revision = 0;
  private last: RawView | null = null;

  get current(): number {
    return this.revision;
  }

  /** Set the baseline view without bumping (first extraction). */
  commit(view: RawView): number {
    this.last = view;
    return this.revision;
  }

  /** Evaluate a new view; bump the revision unless the change is pure noise. */
  evaluate(next: RawView, targetRefs: string[] = []): { revision: number; classification: MutationClass } {
    if (!this.last) {
      this.last = next;
      return { revision: this.revision, classification: "noise" };
    }
    const diff = diffViews(this.last, next, targetRefs);
    if (diff.classification !== "noise") this.revision += 1;
    this.last = next;
    return { revision: this.revision, classification: diff.classification };
  }
}
