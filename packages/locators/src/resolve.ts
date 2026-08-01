import type { LocatorInput, LocatorFingerprint } from "@browser-bridge/protocol";
import type { RawElement, RawView } from "@browser-bridge/semantic-engine";
import { scoreInput, scoreFingerprint } from "./score.js";

export interface ResolveOptions {
  /** Top-2 confidence gap below which the result is ambiguous (default 0.15). */
  ambiguityGap?: number;
  /** Minimum confidence for a resolution to count (default 0.4). */
  minConfidence?: number;
}

const DEFAULTS: Required<ResolveOptions> = { ambiguityGap: 0.15, minConfidence: 0.4 };

export type Resolution =
  | { status: "resolved"; ref: string; confidence: number; element: RawElement }
  | { status: "ambiguous"; confidence: number; candidates: RawElement[] }
  | { status: "not_found"; confidence: number };

interface Ranked {
  el: RawElement;
  score: number;
}

function rank(view: RawView, scorer: (el: RawElement) => number): Ranked[] {
  return view.elements
    .map((el) => ({ el, score: scorer(el) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

function decide(ranked: Ranked[], opts: Required<ResolveOptions>): Resolution {
  if (ranked.length === 0) return { status: "not_found", confidence: 0 };
  const top = ranked[0]!;
  if (top.score < opts.minConfidence) return { status: "not_found", confidence: top.score };
  const second = ranked[1];
  if (second && second.score >= opts.minConfidence && top.score - second.score < opts.ambiguityGap) {
    // Close scores — never silently pick the top one (INV-11 / plan §4.3). Return the
    // near-tie band for the calling agent to arbitrate.
    const band = ranked.filter((r) => top.score - r.score < opts.ambiguityGap).map((r) => r.el);
    return { status: "ambiguous", confidence: top.score, candidates: band };
  }
  return { status: "resolved", ref: top.el.ref, confidence: top.score, element: top.el };
}

/**
 * Resolve a model-supplied locator against the current view. If `ref` is present and
 * still in the view, that is the fast path (refs are caches of the current revision).
 * Otherwise the daemon scores role/name across candidates and either resolves, returns
 * an ambiguity band, or reports not_found.
 */
export function resolveLocator(input: LocatorInput, view: RawView, options: ResolveOptions = {}): Resolution {
  const opts = { ...DEFAULTS, ...options };
  if (input.ref) {
    const hit = view.elements.find((e) => e.ref === input.ref);
    if (hit) return { status: "resolved", ref: hit.ref, confidence: 1, element: hit };
    // Stale ref: fall through to fingerprint-free scoring on role/name.
  }
  if (!input.role && !input.name) return { status: "not_found", confidence: 0 };
  return decide(rank(view, (el) => scoreInput(input, el)), opts);
}

/**
 * Re-resolve a stored fingerprint against a (possibly rerendered) view. This is how the
 * daemon survives DOM nodes being replaced: identity is the scored fingerprint, not the
 * backend node id (plan §4.3 identity rule).
 */
export function reresolveFingerprint(
  fp: LocatorFingerprint,
  view: RawView,
  options: ResolveOptions = {},
): Resolution {
  const opts = { ...DEFAULTS, ...options };
  return decide(rank(view, (el) => scoreFingerprint(fp, el)), opts);
}
