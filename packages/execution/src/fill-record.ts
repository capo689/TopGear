import type { FieldValue } from "@browser-bridge/protocol";
import type { RawElement } from "@browser-bridge/semantic-engine";

/** Split on non-alphanumerics AND camelCase boundaries, lowercase. */
export function tokenize(s: string | undefined): string[] {
  return (s ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter += 1;
  return inter / new Set([...sa, ...sb]).size;
}

export function valueKind(value: FieldValue): "boolean" | "text" {
  return typeof value === "boolean" ? "boolean" : "text";
}

function compatible(el: RawElement, kind: "boolean" | "text"): boolean {
  if (kind === "boolean") return el.role === "checkbox" || el.role === "radio";
  return (
    el.role === "textbox" ||
    el.role === "combobox" ||
    el.role === "listbox" ||
    el.role === "spinbutton" ||
    el.tag === "select" ||
    el.tag === "input" ||
    el.tag === "textarea"
  );
}

/**
 * Deterministic field score (INV-11: no embedded model). Combines accessible-name token
 * overlap, autocomplete tokens, and stable name/id tokens.
 */
export function scoreField(key: string, el: RawElement): number {
  const keyTokens = tokenize(key);
  const nameScore = jaccard(keyTokens, tokenize(el.name));
  const autoScore = jaccard(keyTokens, tokenize(el.fingerprint.autocomplete));
  const idScore = jaccard(keyTokens, tokenize(el.fingerprint.stableAttributes?.name ?? el.fingerprint.stableAttributes?.id));
  return Math.min(1, nameScore * 0.6 + autoScore * 0.35 + idScore * 0.25);
}

export interface FieldMatchOutcome {
  field: string;
  status: "matched" | "unmatched" | "ambiguous";
  element?: RawElement;
  confidence: number;
  candidates?: RawElement[];
}

export function matchField(
  key: string,
  value: FieldValue,
  elements: RawElement[],
  opts: { minConfidence?: number; ambiguityGap?: number } = {},
): FieldMatchOutcome {
  const minConfidence = opts.minConfidence ?? 0.34;
  const ambiguityGap = opts.ambiguityGap ?? 0.15;
  const kind = valueKind(value);
  const ranked = elements
    .filter((el) => compatible(el, kind))
    .map((el) => ({ el, score: scoreField(key, el) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  if (ranked.length === 0 || ranked[0]!.score < minConfidence) {
    return { field: key, status: "unmatched", confidence: ranked[0]?.score ?? 0 };
  }
  const top = ranked[0]!;
  const second = ranked[1];
  if (second && second.score >= minConfidence && top.score - second.score < ambiguityGap) {
    return {
      field: key,
      status: "ambiguous",
      confidence: top.score,
      candidates: ranked.filter((r) => top.score - r.score < ambiguityGap).map((r) => r.el),
    };
  }
  return { field: key, status: "matched", element: top.el, confidence: top.score };
}
