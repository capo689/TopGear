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
  return createHash("sha256").update(publicKeyB64Der).digest("hex").slice(0, 16);
}
function verifyEd25519(publicKeyB64Der: string, message: string, signatureB64: string): boolean {
  try {
    const key = createPublicKey({ key: Buffer.from(publicKeyB64Der, "base64"), format: "der", type: "spki" });
    return cryptoVerify(null, Buffer.from(message, "utf8"), key, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}
function verifyPurgeProof(proof: Record<string, unknown>): { ok: true; installId: string } | { ok: false; reason: string } {
  const { publicKey, signature } = proof;
  if (typeof publicKey !== "string" || typeof signature !== "string") {
    return { ok: false, reason: "missing publicKey/signature" };
  }
  const installId = deriveInstallId(publicKey);
  if (!verifyEd25519(publicKey, canonicalJSON({ action: "purge", installId }), signature)) {
    return { ok: false, reason: "signature verification failed" };
  }
  return { ok: true, installId };
}
// --- end inlined ---

function json(res: any, status: number, body: unknown): void {
  res.setHeader("content-type", "application/json");
  res.status(status).end(JSON.stringify(body));
}

export default async function handler(req: any, res: any): Promise<void> {
  if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });

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

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return json(res, 503, { error: "quarantine storage not configured" });

  const listed = await fetch(
    `https://blob.vercel-storage.com/?prefix=${encodeURIComponent(`quarantine/${installId}/`)}&limit=1000`,
    { headers: { authorization: `Bearer ${token}`, "x-api-version": "7" } },
  );
  if (!listed.ok) return json(res, 502, { error: "quarantine list failed", status: listed.status });
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
