import type { LocatorInput, LocatorFingerprint } from "@browser-bridge/protocol";
import type { RawElement } from "@browser-bridge/semantic-engine";

export function normalizeName(s: string | undefined): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function nameMatch(candidate: string | undefined, wanted: string): number {
  const c = normalizeName(candidate);
  const w = normalizeName(wanted);
  if (!c || !w) return 0;
  if (c === w) return 1;
  if (c.includes(w) || w.includes(c)) return 0.6;
  return 0;
}

interface Signal {
  weight: number;
  match: number;
}

function combine(signals: Signal[]): number {
  const totalWeight = signals.reduce((n, s) => n + s.weight, 0);
  if (totalWeight === 0) return 0;
  return signals.reduce((n, s) => n + s.weight * s.match, 0) / totalWeight;
}

/** Score a candidate element against a model-supplied locator (role/name). 0..1. */
export function scoreInput(input: LocatorInput, el: RawElement): number {
  const signals: Signal[] = [];
  if (input.role) signals.push({ weight: 0.35, match: el.role === input.role ? 1 : 0 });
  if (input.name) signals.push({ weight: 0.65, match: nameMatch(el.name, input.name) });
  return combine(signals);
}

/** Score a candidate against a stored fingerprint — used for rerender survival. */
export function scoreFingerprint(fp: LocatorFingerprint, el: RawElement): number {
  const signals: Signal[] = [];
  if (fp.name) signals.push({ weight: 0.4, match: nameMatch(el.name, fp.name) });
  if (fp.role) signals.push({ weight: 0.15, match: el.role === fp.role ? 1 : 0 });
  if (fp.testId) signals.push({ weight: 0.2, match: el.fingerprint.testId === fp.testId ? 1 : 0 });
  if (fp.autocomplete) signals.push({ weight: 0.1, match: el.fingerprint.autocomplete === fp.autocomplete ? 1 : 0 });
  if (fp.inputType) signals.push({ weight: 0.05, match: el.fingerprint.inputType === fp.inputType ? 1 : 0 });
  if (fp.stableAttributes) {
    const want = fp.stableAttributes;
    const have = el.fingerprint.stableAttributes ?? {};
    const keys = Object.keys(want);
    const hits = keys.filter((k) => have[k] === want[k]).length;
    signals.push({ weight: 0.15, match: keys.length ? hits / keys.length : 0 });
  }
  if (fp.structuralFingerprint) {
    signals.push({ weight: 0.05, match: el.fingerprint.structuralFingerprint === fp.structuralFingerprint ? 1 : 0 });
  }
  return combine(signals);
}
