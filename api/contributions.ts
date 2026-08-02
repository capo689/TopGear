/**
 * POST /api/contributions — accept ONE signed Class C record into quarantine.
 *
 * Mirrors the local stub's contract exactly (apps/commons-ingest/src/server.ts) so the
 * client is unchanged. Performs a shape guard only; deep validation, signature
 * verification, and quorum promotion are R2. Durable storage is Vercel Blob; when no
 * token is configured this returns 503 rather than silently dropping data.
 */
const MAX_BYTES = 16 * 1024;

/** Class C fields only. Anything outside this allowlist is rejected (INV-6). */
const ALLOWED = new Set([
  "origin", "kind", "widgetKind", "fingerprint", "day", "installId", "signature",
]);
const ALLOWED_FP = new Set(["role", "name", "testId", "autocomplete", "inputType"]);

function json(res: any, status: number, body: unknown): void {
  res.setHeader("content-type", "application/json");
  res.status(status).end(JSON.stringify(body));
}

export default async function handler(req: any, res: any): Promise<void> {
  if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });

  const raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? "");
  if (raw.length > MAX_BYTES) return json(res, 413, { error: "record too large" });

  let rec: Record<string, unknown>;
  try {
    rec = typeof req.body === "object" && req.body !== null ? req.body : JSON.parse(raw);
  } catch {
    return json(res, 400, { error: "invalid json" });
  }

  if (!rec.origin || !rec.installId || !rec.signature) {
    return json(res, 400, { error: "missing fields", needed: ["origin", "installId", "signature"] });
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

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return json(res, 503, {
      error: "quarantine storage not configured",
      detail: "set BLOB_READ_WRITE_TOKEN; records are never accepted without durable storage",
    });
  }

  const key = `quarantine/${rec.installId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.json`;
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
  if (!put.ok) return json(res, 502, { error: "quarantine write failed", status: put.status });

  return json(res, 202, { accepted: true });
}
