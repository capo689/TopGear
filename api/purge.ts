/**
 * POST /api/purge — retroactively purge an install's quarantined records.
 *
 * The kill switch's remote half (plan §9.3): consent-off must purge quarantined,
 * unpromoted contributions. Requires a signed ownership proof (AUTHZ-02/AUTH-02): the
 * caller proves possession of the install's private key, and only the installId DERIVED
 * from that key is purged — anyone who merely learns an installId can no longer wipe it.
 * The ed25519 verification is inlined byte-identically to
 * packages/contribution/src/verify.ts; parity.test.ts is the drift guard.
 */
import { createHash, createPublicKey, verify as cryptoVerify } from "node:crypto";

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
const PURGE_WINDOW_MS = 5 * 60 * 1000;
function verifyPurgeProof(proof: Record<string, unknown>): { ok: true; installId: string } | { ok: false; reason: string } {
  const { publicKey, signature, issuedAt } = proof;
  if (typeof publicKey !== "string" || typeof signature !== "string" || typeof issuedAt !== "number") {
    return { ok: false, reason: "missing publicKey/signature/issuedAt" };
  }
  const installId = deriveInstallId(publicKey);
  if (!verifyEd25519(publicKey, canonicalJSON({ action: "purge", installId, issuedAt }), signature)) {
    return { ok: false, reason: "signature verification failed" };
  }
  const now = Date.now();
  if (issuedAt > now + PURGE_WINDOW_MS) return { ok: false, reason: "proof not yet valid" };
  if (issuedAt < now - PURGE_WINDOW_MS) return { ok: false, reason: "proof expired" };
  return { ok: true, installId };
}
// --- end inlined ---

function json(res: any, status: number, body: unknown): void {
  res.setHeader("content-type", "application/json");
  res.status(status).end(JSON.stringify(body));
}

// OBS-01: structured, redacted error signal (functions only). Never log proof/keys.
function reportError(fn: string, err: unknown, ctx?: Record<string, unknown>): void {
  try {
    console.error(JSON.stringify({ level: "error", at: "commons-ingest", fn, error: err instanceof Error ? err.message : String(err), ...(ctx ?? {}) }));
  } catch {
    /* logging must never throw */
  }
}

// COST-03: best-effort per-instance rate limit (see api/contributions.ts + DECISIONS).
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
    reportError("purge", err);
    return json(res, 500, { error: "internal error" });
  }
}

async function handle(req: any, res: any): Promise<void> {
  if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });

  let proof: Record<string, unknown> | null;
  try {
    proof = typeof req.body === "object" && req.body !== null ? req.body : JSON.parse(req.body ?? "{}");
  } catch {
    proof = null;
  }
  if (proof === null) return json(res, 400, { error: "invalid json" });

  // COST-03: rate-limit before verification, keyed IP + claimed installId.
  const ip = clientIp(req);
  const claimedId = typeof proof.installId === "string" ? proof.installId : "unknown";
  if (rateLimited(`${ip}:${claimedId}`)) return json(res, 429, { error: "rate limited" });

  // Authorization (AUTHZ-02): only a valid signed ownership proof authorizes a purge, and
  // it can only purge the installId derived from the proof's key.
  const verified = verifyPurgeProof(proof);
  if (!verified.ok) return json(res, 401, { error: "unauthorized", detail: verified.reason });
  const installId = verified.installId;

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return json(res, 503, { error: "quarantine storage not configured" });

  const listed = await fetch(
    `https://blob.vercel-storage.com/?prefix=${encodeURIComponent(`quarantine/${installId}/`)}&limit=1000`,
    { headers: { authorization: `Bearer ${token}`, "x-api-version": "7" } },
  );
  if (!listed.ok) {
    reportError("purge", new Error("quarantine list failed"), { status: listed.status });
    return json(res, 502, { error: "quarantine list failed", status: listed.status });
  }
  const { blobs = [] } = (await listed.json()) as { blobs?: { url: string }[] };

  let purged = 0;
  for (const b of blobs) {
    const del = await fetch("https://blob.vercel-storage.com/delete", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-api-version": "7" },
      body: JSON.stringify({ urls: [b.url] }),
    });
    if (del.ok) purged += 1;
  }
  return json(res, 200, { purged });
}
