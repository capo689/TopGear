/**
 * POST /api/contributions — accept ONE signed Class C record into quarantine.
 *
 * Mirrors the local stub's contract exactly (apps/commons-ingest/src/validate.ts) so the
 * client is unchanged. Vercel functions must be dependency-free, so the validation order,
 * status codes, and the ed25519 verification are inlined here BYTE-IDENTICALLY to
 * packages/contribution/src/verify.ts; `apps/commons-ingest/src/parity.test.ts` is the
 * drift guard. Durable storage is Vercel Blob; with no token this returns 503 rather than
 * silently dropping data.
 */
import { createHash, createPublicKey, verify as cryptoVerify } from "node:crypto";

const MAX_BYTES = 16 * 1024;

/** Class C fields only. Anything outside this allowlist is rejected (INV-6). */
const ALLOWED = new Set([
  "origin", "kind", "widgetKind", "fingerprint", "day", "installId", "publicKey", "signature",
]);
const ALLOWED_FP = new Set(["role", "name", "testId", "autocomplete", "inputType"]);

// --- inlined from @browser-bridge/contribution (identity.ts + verify.ts) — keep identical ---
function sortKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(sortKeys);
  if (obj && typeof obj === "object") {
    const src = obj as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) out[key] = sortKeys(src[key]);
    return out;
  }
  return obj;
}
function canonicalJSON(obj: unknown): string {
  return JSON.stringify(sortKeys(obj));
}
function deriveInstallId(publicKeyB64Der: string): string {
  return createHash("sha256").update(publicKeyB64Der).digest("hex").slice(0, 32);
}
function verifyEd25519(publicKeyB64Der: string, message: string, signatureB64: string): boolean {
  try {
    const key = createPublicKey({ key: Buffer.from(publicKeyB64Der, "base64"), format: "der", type: "spki" });
    return cryptoVerify(null, Buffer.from(message, "utf8"), key, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}
function verifyContributionSignature(rec: Record<string, unknown>): { ok: true; installId: string } | { ok: false; reason: string } {
  const { publicKey, signature, installId } = rec;
  if (typeof publicKey !== "string" || typeof signature !== "string" || typeof installId !== "string") {
    return { ok: false, reason: "missing publicKey/signature/installId" };
  }
  const derived = deriveInstallId(publicKey);
  if (derived !== installId) return { ok: false, reason: "installId does not match publicKey" };
  const { publicKey: _pk, signature: _sig, ...signed } = rec;
  if (!verifyEd25519(publicKey, canonicalJSON(signed), signature)) {
    return { ok: false, reason: "signature verification failed" };
  }
  return { ok: true, installId: derived };
}
// --- end inlined ---

function json(res: any, status: number, body: unknown): void {
  res.setHeader("content-type", "application/json");
  res.status(status).end(JSON.stringify(body));
}

// OBS-01: structured, REDACTED error signal (functions only, never the daemon). Vercel Logs
// captures this; a log drain / alert integration is the account-gated follow-up. Never log
// the record body or any value (INV-6) — only the error and a minimal non-PII context.
function reportError(fn: string, err: unknown, ctx?: Record<string, unknown>): void {
  try {
    console.error(JSON.stringify({ level: "error", at: "commons-ingest", fn, error: err instanceof Error ? err.message : String(err), ...(ctx ?? {}) }));
  } catch {
    /* logging must never throw */
  }
}

// COST-03: best-effort per-instance rate limit with TWO INDEPENDENT buckets (either trips):
//   1. IP alone (primary), checked BEFORE verification — an attacker rotating the installId
//      string CANNOT escape it, and it protects the ed25519 verify from being the DoS target.
//   2. the VERIFIED installId (secondary), checked after verification — bounds one install's
//      rate even across IPs.
// A composite `ip:installId` key would be defeated by rotating installId, so the buckets are
// namespaced (`ip:` / `id:`) and checked separately. NO durable storage, so this is per warm
// instance only — a distributed flood across instances, or IP rotation, still escapes it.
const RL_WINDOW_MS = 60_000;
const RL_MAX = 60;
const rlHits = new Map<string, number[]>();
function rateLimited(key: string, now: number = Date.now()): boolean {
  const arr = (rlHits.get(key) ?? []).filter((t) => now - t < RL_WINDOW_MS);
  arr.push(now);
  rlHits.set(key, arr);
  if (rlHits.size > 5000) for (const [k, v] of rlHits) if (v.every((t) => now - t >= RL_WINDOW_MS)) rlHits.delete(k);
  return arr.length > RL_MAX;
}
function clientIp(req: any): string {
  const xff = req?.headers?.["x-forwarded-for"];
  const first = Array.isArray(xff) ? xff[0] : typeof xff === "string" ? xff.split(",")[0] : undefined;
  return (first || req?.headers?.["x-real-ip"] || "unknown").toString().trim();
}

export default async function handler(req: any, res: any): Promise<void> {
  try {
    return await handle(req, res);
  } catch (err) {
    reportError("contributions", err);
    return json(res, 500, { error: "internal error" });
  }
}

async function handle(req: any, res: any): Promise<void> {
  if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });

  const raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? "");
  if (raw.length > MAX_BYTES) return json(res, 413, { error: "record too large" });

  let rec: Record<string, unknown>;
  try {
    rec = typeof req.body === "object" && req.body !== null ? req.body : JSON.parse(raw);
  } catch {
    return json(res, 400, { error: "invalid json" });
  }

  // COST-03 primary: rate-limit on IP ALONE, before the expensive verify. installId is NOT
  // in this key — rotating it must not mint a fresh bucket.
  const ip = clientIp(req);
  if (rateLimited(`ip:${ip}`)) return json(res, 429, { error: "rate limited" });

  if (!rec.origin || !rec.installId || !rec.signature || !rec.publicKey) {
    return json(res, 400, { error: "missing fields", needed: ["origin", "installId", "publicKey", "signature"] });
  }
  // Reject anything outside the Class C allowlist — defense in depth against a client
  // that ever tries to send content, values, or full URLs.
  const extra = Object.keys(rec).filter((k) => !ALLOWED.has(k));
  if (extra.length) return json(res, 422, { error: "disallowed fields", fields: extra });
  if (rec.fingerprint && typeof rec.fingerprint === "object") {
    const bad = Object.keys(rec.fingerprint as object).filter((k) => !ALLOWED_FP.has(k));
    if (bad.length) return json(res, 422, { error: "disallowed fingerprint fields", fields: bad });
  }
  if (typeof rec.origin === "string" && (rec.origin.includes("?") || rec.origin.split("/").length > 3)) {
    return json(res, 422, { error: "origin must be scheme://host only" });
  }

  // Authorization (AUTHZ-01/AUTH-01): verify the signature and DERIVE the installId from
  // the key — a forged installId or bad signature can never be stored. Runs BEFORE the
  // storage check so a forger gets 401 whether or not storage exists (no oracle).
  const verified = verifyContributionSignature(rec);
  if (!verified.ok) return json(res, 401, { error: "unauthorized", detail: verified.reason });
  const installId = verified.installId;

  // COST-03 secondary: an independent bucket on the VERIFIED installId, bounding one
  // install's rate across IPs.
  if (rateLimited(`id:${installId}`)) return json(res, 429, { error: "rate limited" });

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return json(res, 503, {
      error: "quarantine storage not configured",
      detail: "set BLOB_READ_WRITE_TOKEN; records are never accepted without durable storage",
    });
  }

  // Store under the DERIVED installId, never the body's claim.
  const key = `quarantine/${installId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.json`;
  const put = await fetch(`https://blob.vercel-storage.com/${key}`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-content-type": "application/json",
      "x-api-version": "7",
      "x-add-random-suffix": "0",
    },
    body: JSON.stringify(rec),
  });
  if (!put.ok) {
    reportError("contributions", new Error("quarantine write failed"), { status: put.status });
    return json(res, 502, { error: "quarantine write failed", status: put.status });
  }

  // PIPE-02: do not trust put.ok. Read the object back and confirm it actually persisted
  // with the expected owner, rather than assuming a 200 means durable success.
  try {
    const putBody = (await put.json()) as { url?: string; downloadUrl?: string };
    const readUrl = putBody.downloadUrl || putBody.url;
    if (!readUrl) return json(res, 502, { error: "quarantine write unverifiable", detail: "no object url returned" });
    const check = await fetch(readUrl, { headers: { "x-api-version": "7" } });
    if (!check.ok) return json(res, 502, { error: "quarantine readback failed", status: check.status });
    const stored = (await check.json()) as { installId?: string };
    if (!stored || stored.installId !== installId) {
      reportError("contributions", new Error("quarantine verification mismatch"));
      return json(res, 502, { error: "quarantine verification mismatch" });
    }
  } catch (err) {
    reportError("contributions", err, { phase: "readback" });
    return json(res, 502, { error: "quarantine readback failed" });
  }

  return json(res, 202, { accepted: true });
}
