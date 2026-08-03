/**
 * The contribution + purge validation contract. This is the SAME logic as the Vercel
 * functions (`api/contributions.ts`, `api/purge.ts`) — kept in lockstep by the parity
 * test. Vercel functions must be dependency-free, so the validation ORDER and status
 * codes are duplicated there rather than imported; `parity.test.ts` is the drift guard.
 * The ed25519 verification itself is imported from @browser-bridge/contribution here (so
 * client and stub agree by construction) and inlined byte-identically in the Vercel copy.
 */
import { verifyContributionSignature, verifyPurgeProof } from "@browser-bridge/contribution";

export interface ValidationResult {
  status: number;
  body: unknown;
  /** On a 202, the installId DERIVED from the verified key — the authoritative owner. */
  installId?: string;
}

const MAX_BYTES = 16 * 1024;
const ALLOWED = new Set(["origin", "kind", "widgetKind", "fingerprint", "day", "installId", "publicKey", "signature"]);
const ALLOWED_FP = new Set(["role", "name", "testId", "autocomplete", "inputType"]);

export function validateContribution(
  rawLength: number,
  rec: Record<string, unknown> | null,
  opts: { storageConfigured: boolean },
): ValidationResult {
  if (rawLength > MAX_BYTES) return { status: 413, body: { error: "record too large" } };
  if (rec === null) return { status: 400, body: { error: "invalid json" } };
  if (!rec.origin || !rec.installId || !rec.signature || !rec.publicKey) {
    return { status: 400, body: { error: "missing fields", needed: ["origin", "installId", "publicKey", "signature"] } };
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
  // Authorization (AUTHZ-01/AUTH-01): the signature must verify and installId must derive
  // from the key. This runs BEFORE the storage check so a forger gets 401 regardless of
  // whether storage exists (no oracle). A forged/absent signature can never be stored.
  const v = verifyContributionSignature(rec);
  if (!v.ok) return { status: 401, body: { error: "unauthorized", detail: v.reason } };
  // installId is returned as soon as verify passes (503 AND 202), so the caller can apply the
  // verified-installId rate-limit bucket at the same point the Vercel function does.
  if (!opts.storageConfigured) {
    return { status: 503, body: { error: "quarantine storage not configured" }, installId: v.installId };
  }
  return { status: 202, body: { accepted: true }, installId: v.installId };
}

/**
 * Purge validation (AUTHZ-02/AUTH-02): only a valid signed ownership proof authorizes a
 * purge, and it can only purge the installId DERIVED from the proof's key.
 */
export function validatePurge(
  proof: Record<string, unknown> | null,
  opts: { storageConfigured: boolean },
): ValidationResult {
  if (proof === null) return { status: 400, body: { error: "invalid json" } };
  const v = verifyPurgeProof(proof);
  if (!v.ok) return { status: 401, body: { error: "unauthorized", detail: v.reason } };
  if (!opts.storageConfigured) return { status: 503, body: { error: "quarantine storage not configured" }, installId: v.installId };
  return { status: 200, body: { purged: 0 }, installId: v.installId };
}
