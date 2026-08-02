/**
 * The contribution POST validation contract. This is the SAME logic as the Vercel
 * function (`api/contributions.ts`) — kept in lockstep by the parity test. Vercel
 * functions must be dependency-free, so the logic is duplicated there rather than
 * imported; `parity.test.ts` is the drift guard.
 */
export interface ValidationResult {
  status: number;
  body: unknown;
}

const MAX_BYTES = 16 * 1024;
const ALLOWED = new Set(["origin", "kind", "widgetKind", "fingerprint", "day", "installId", "signature"]);
const ALLOWED_FP = new Set(["role", "name", "testId", "autocomplete", "inputType"]);

export function validateContribution(
  rawLength: number,
  rec: Record<string, unknown> | null,
  opts: { storageConfigured: boolean },
): ValidationResult {
  if (rawLength > MAX_BYTES) return { status: 413, body: { error: "record too large" } };
  if (rec === null) return { status: 400, body: { error: "invalid json" } };
  if (!rec.origin || !rec.installId || !rec.signature) {
    return { status: 400, body: { error: "missing fields", needed: ["origin", "installId", "signature"] } };
  }
  const extra = Object.keys(rec).filter((k) => !ALLOWED.has(k));
  if (extra.length) return { status: 422, body: { error: "disallowed fields", fields: extra } };
  if (rec.fingerprint && typeof rec.fingerprint === "object") {
    const bad = Object.keys(rec.fingerprint as object).filter((k) => !ALLOWED_FP.has(k));
    if (bad.length) return { status: 422, body: { error: "disallowed fingerprint fields", fields: bad } };
  }
  if (typeof rec.origin === "string" && (rec.origin.includes("?") || rec.origin.split("/").length > 3)) {
    return { status: 422, body: { error: "origin must be scheme://host only" } };
  }
  if (!opts.storageConfigured) {
    return { status: 503, body: { error: "quarantine storage not configured" } };
  }
  return { status: 202, body: { accepted: true } };
}
