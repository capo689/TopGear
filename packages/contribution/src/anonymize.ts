import type { CandidatePattern } from "./classify.js";

export interface ContributionFingerprint {
  role?: string;
  name?: string;
  testId?: string;
  autocomplete?: string;
  inputType?: string;
}

export interface UnsignedContribution {
  origin: string;
  kind: string;
  widgetKind?: string;
  fingerprint?: ContributionFingerprint;
  /** Coarsened to a day (YYYY-MM-DD) — no user-correlated timestamps. */
  day: string;
  installId: string;
}

export interface ContributionRecord extends UnsignedContribution {
  /** base64 SPKI DER of the install's public key — lets the server verify + derive installId. */
  publicKey: string;
  signature: string;
}

/** Origin only — strips any path AND query string (INV-6: no user-identifying URLs). */
export function originOnly(input: string): string {
  try {
    return new URL(input).origin;
  } catch {
    return input;
  }
}

/** Coarsen an epoch-ms timestamp to a UTC day. */
export function coarsenDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Turn a (public, value-free) candidate into an anonymized contribution. Deliberately
 * DROPS: any value, the full URL / query string, the authenticated flag, and the precise
 * timestamp. Keeps only structural signals (INV-6 Class C).
 */
export function anonymize(pattern: CandidatePattern, installId: string): UnsignedContribution {
  const out: UnsignedContribution = {
    origin: originOnly(pattern.origin),
    kind: pattern.kind,
    day: coarsenDay(pattern.observedAt),
    installId,
  };
  if (pattern.widgetKind) out.widgetKind = pattern.widgetKind;
  if (pattern.fingerprint) {
    const fp: ContributionFingerprint = {};
    if (pattern.fingerprint.role) fp.role = pattern.fingerprint.role;
    if (pattern.fingerprint.name) fp.name = pattern.fingerprint.name;
    if (pattern.fingerprint.testId) fp.testId = pattern.fingerprint.testId;
    if (pattern.fingerprint.autocomplete) fp.autocomplete = pattern.fingerprint.autocomplete;
    if (pattern.fingerprint.inputType) fp.inputType = pattern.fingerprint.inputType;
    if (Object.keys(fp).length > 0) out.fingerprint = fp;
  }
  return out;
}
