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

const MAX_BYTES = 16 * 1024;

// COST-03: two independent best-effort buckets, each keyed on a SINGLE value (never a
// composite). Behaviourally identical to packages/contribution/src/rate-limit.ts; parity
// guards the pair. Returns 0 (allowed) or a positive Retry-After in seconds.
function createRateLimiter(windowMs = 60_000, max = 60, maxKeys = 10_000): (key: string, now?: number) => number {
  const hits = new Map<string, number[]>();
  return (key: string, now: number = Date.now()): number => {
    const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (arr.length >= max) {
      hits.set(key, arr);
      return Math.max(1, Math.ceil((windowMs - (now - (arr[0] ?? now))) / 1000));
    }
    arr.push(now);
    hits.set(key, arr);
    while (hits.size > maxKeys) hits.delete(hits.keys().next().value as string);
    return 0;
  };
}
function clientIp(req: any): string {
  const h = req?.headers ?? {};
  const val = (name: string): string | undefined => {
    const v = h[name];
    const s = Array.isArray(v) ? v[v.length - 1] : typeof v === "string" ? v : undefined;
    return s ? s.trim() : undefined;
  };
  const vercel = val("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",").pop()!.trim();
  const real = val("x-real-ip");
  if (real) return real;
  const xff = val("x-forwarded-for");
  if (xff) return xff.split(",").pop()!.trim();
  return "unknown";
}
function tooMany(res: any, retryAfter: number): void {
  res.setHeader("retry-after", String(retryAfter));
  json(res, 429, { error: "rate limited" });
}
const ipLimiter = createRateLimiter(); // bucket 1: trusted IP, before verify
const idLimiter = createRateLimiter(); // bucket 2: verified installId, after verify

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

  // COST-03 primary bucket: trusted IP, checked FIRST (before size + parse) so malformed and
  // oversize input is counted. Order: method → IP bucket → size → parse → verify → id bucket.
  const ip = clientIp(req);
  const ipRetry = ipLimiter(ip);
  if (ipRetry) return tooMany(res, ipRetry);

  const raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? "");
  if (raw.length > MAX_BYTES) return json(res, 413, { error: "record too large" });

  let proof: Record<string, unknown> | null;
  try {
    proof = typeof req.body === "object" && req.body !== null ? req.body : JSON.parse(req.body ?? "{}");
  } catch {
    proof = null;
  }
  if (proof === null) return json(res, 400, { error: "invalid json" });

  // Authorization (AUTHZ-02): only a valid signed ownership proof authorizes a purge, and
  // it can only purge the installId derived from the proof's key.
  const verified = verifyPurgeProof(proof);
  if (!verified.ok) return json(res, 401, { error: "unauthorized", detail: verified.reason });
  const installId = verified.installId;

  // COST-03 secondary bucket: the VERIFIED installId.
  const idRetry = idLimiter(installId);
  if (idRetry) return tooMany(res, idRetry);

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
