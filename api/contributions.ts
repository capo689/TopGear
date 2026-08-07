/**
 * POST /api/contributions — accept ONE signed Class C record into quarantine.
 *
 * Mirrors the local stub's contract exactly (apps/commons-ingest/src/validate.ts) so the
 * client is unchanged. The validation order, status codes, and the ed25519 verification are
 * inlined here BYTE-IDENTICALLY to packages/contribution/src/verify.ts;
 * `apps/commons-ingest/src/parity.test.ts` is the drift guard.
 *
 * STORAGE: Postgres (Supabase), table `browser_bridge.contributions`. Object storage was
 * abandoned — you cannot query a bucket, and aggregation IS the commons. With no
 * SUPABASE_DB_URL this returns 503 rather than silently dropping data (INV-10).
 *
 * The connection MUST use the least-privilege role `browser_bridge_app` (select/insert/delete
 * on that one table, no UPDATE, no access to any other schema) — never service_role and never
 * the postgres superuser. This endpoint is a PUBLIC UNAUTHENTICATED WRITE, so its database
 * identity is the isolation boundary for every other tenant of the project.
 */
import { createHash, createPublicKey, verify as cryptoVerify } from "node:crypto";
import { Pool } from "pg";

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

/**
 * Type check the allowlisted fields. The store is now a TYPED table, not an opaque blob, so a
 * non-string scalar (or a non-object fingerprint) has to be rejected at the boundary rather
 * than discovered as a 502 from Postgres. Same check, same status, in the stub — parity guards
 * the pair.
 */
const SCALARS = ["origin", "kind", "widgetKind", "day", "installId", "publicKey", "signature"];
function badlyTypedFields(rec: Record<string, unknown>): string[] {
  const bad = SCALARS.filter((k) => rec[k] !== undefined && typeof rec[k] !== "string");
  const fp = rec.fingerprint;
  if (fp !== undefined) {
    if (typeof fp !== "object" || fp === null || Array.isArray(fp)) bad.push("fingerprint");
    else for (const [k, v] of Object.entries(fp as Record<string, unknown>)) {
      if (typeof v !== "string") bad.push(`fingerprint.${k}`);
    }
  }
  return bad;
}

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

// COST-03: TWO independent best-effort buckets, each keyed on a SINGLE value (never a
// composite). Behaviourally identical to packages/contribution/src/rate-limit.ts (Vercel
// functions are dependency-free); parity guards the pair. Per warm instance only — a
// distributed flood across instances still escapes it. Returns 0 (allowed) or a positive
// Retry-After in seconds. Unconditional oldest-key eviction bounds memory + per-request cost.
function createRateLimiter(windowMs = 60_000, max = 60, maxKeys = 10_000): (key: string, now?: number) => number {
  const hits = new Map<string, number[]>();
  return (key: string, now: number = Date.now()): number => {
    const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (arr.length >= max) {
      hits.set(key, arr); // do not push past the cap — bounds a hot key's array; window drains
      return Math.max(1, Math.ceil((windowMs - (now - (arr[0] ?? now))) / 1000));
    }
    arr.push(now);
    hits.set(key, arr);
    while (hits.size > maxKeys) hits.delete(hits.keys().next().value as string);
    return 0;
  };
}
// Trusted client IP only: platform headers first; x-forwarded-for is client-influenceable, so
// consulted last and only its RIGHTMOST (closest-proxy) entry — never the client-set leftmost.
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
  res.setHeader("retry-after", String(retryAfter)); // INV-7 good citizen
  json(res, 429, { error: "rate limited" });
}
const ipLimiter = createRateLimiter(); // bucket 1: trusted IP, before verify (DoS bound)
const idLimiter = createRateLimiter(); // bucket 2: verified installId, after verify

/**
 * One pool per warm instance. `ssl` is set EXPLICITLY rather than left to the URL's sslmode:
 * the role password crosses this connection, so the server certificate is VERIFIED against
 * Supabase's pinned root above. Do not put sslmode in SUPABASE_DB_URL — the explicit option
 * here wins and this stays deterministic.
 */
/**
 * Supabase's PUBLIC root CA (not a secret — it is a published certificate).
 *
 * MEASURED, not assumed: the Supavisor pooler presents a SELF-SIGNED chain, so verifying
 * against the system CA store fails outright ("self-signed certificate in certificate chain").
 * The role password crosses this connection, so the answer is to pin Supabase's root rather
 * than to set rejectUnauthorized:false and accept any certificate. With this CA the handshake
 * verifies and the connection proceeds to normal Postgres auth.
 */
const SUPABASE_ROOT_CA = `-----BEGIN CERTIFICATE-----
MIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL
BQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l
dyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh
c2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow
azELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD
YXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug
Um9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW
QyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q
DmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2
GtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi
cvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4
O4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt
NaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX
uXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt
aUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU
tVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b
VW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6
jB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx
Cea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2
CMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P
o/bKiIz+Fq8=
-----END CERTIFICATE-----`;

let pool: Pool | undefined;
function getPool(connectionString: string): Pool {
  pool ??= new Pool({
    connectionString,
    ssl: { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true },
    max: 4, // Fluid reuses an instance across concurrent requests; a max of 1 would serialize
    connectionTimeoutMillis: 5_000, // the function's maxDuration is 10s
    idleTimeoutMillis: 10_000,
  });
  return pool;
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

  // COST-03 primary bucket: trusted IP, checked FIRST (before size + parse). Malformed and
  // oversize input is the CHEAPEST attack to mount and legitimate clients send almost none,
  // so the limiter must count them; the limiter is O(1), so there is no work-avoidance reason
  // to gate it behind the cheap checks. Order: method → IP bucket → size → parse → verify → id.
  const ip = clientIp(req);
  const ipRetry = ipLimiter(ip);
  if (ipRetry) return tooMany(res, ipRetry);

  const raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? "");
  if (raw.length > MAX_BYTES) return json(res, 413, { error: "record too large" });

  let rec: Record<string, unknown>;
  try {
    rec = typeof req.body === "object" && req.body !== null ? req.body : JSON.parse(raw);
  } catch {
    return json(res, 400, { error: "invalid json" });
  }

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
  const mistyped = badlyTypedFields(rec);
  if (mistyped.length) return json(res, 422, { error: "field types", fields: mistyped });
  if (typeof rec.origin === "string" && (rec.origin.includes("?") || rec.origin.split("/").length > 3)) {
    return json(res, 422, { error: "origin must be scheme://host only" });
  }

  // Authorization (AUTHZ-01/AUTH-01): verify the signature and DERIVE the installId from
  // the key — a forged installId or bad signature can never be stored. Runs BEFORE the
  // storage check so a forger gets 401 whether or not storage exists (no oracle).
  const verified = verifyContributionSignature(rec);
  if (!verified.ok) return json(res, 401, { error: "unauthorized", detail: verified.reason });
  const installId = verified.installId;

  // COST-03 secondary bucket: the VERIFIED installId, bounding one install's rate across IPs.
  const idRetry = idLimiter(installId);
  if (idRetry) return tooMany(res, idRetry);

  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    return json(res, 503, {
      error: "quarantine storage not configured",
      detail: "set SUPABASE_DB_URL; records are never accepted without durable storage",
    });
  }

  // PIPE-02: do not trust the write. INSERT ... RETURNING gives the row the database actually
  // committed, so the readback is the same statement rather than a second round trip — and the
  // stored owner is asserted against the DERIVED installId, never the body's claim.
  let stored: { id: string; install_id: string } | undefined;
  try {
    const result = await getPool(dbUrl).query(
      `INSERT INTO browser_bridge.contributions
         (install_id, origin, kind, widget_kind, fingerprint, day, public_key, signature)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
       RETURNING id, install_id`,
      [
        installId, // DERIVED from the verified key
        rec.origin as string,
        (rec.kind as string) ?? null,
        (rec.widgetKind as string) ?? null,
        rec.fingerprint === undefined ? null : JSON.stringify(rec.fingerprint),
        (rec.day as string) ?? null,
        rec.publicKey as string,
        rec.signature as string,
      ],
    );
    stored = result.rows[0] as { id: string; install_id: string } | undefined;
  } catch (err) {
    reportError("contributions", err, { phase: "insert" });
    return json(res, 502, { error: "quarantine write failed" });
  }
  if (!stored) {
    reportError("contributions", new Error("insert returned no row"));
    return json(res, 502, { error: "quarantine write unverifiable" });
  }
  if (stored.install_id !== installId) {
    reportError("contributions", new Error("quarantine verification mismatch"));
    return json(res, 502, { error: "quarantine verification mismatch" });
  }

  return json(res, 202, { accepted: true });
}
