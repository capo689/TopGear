/**
 * POST /api/purge — retroactively purge an install's quarantined records.
 *
 * The kill switch's remote half (plan §9.3): consent-off must purge quarantined,
 * unpromoted contributions. Mirrors the local stub's contract.
 */
function json(res: any, status: number, body: unknown): void {
  res.setHeader("content-type", "application/json");
  res.status(status).end(JSON.stringify(body));
}

export default async function handler(req: any, res: any): Promise<void> {
  if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });

  let body: { installId?: string };
  try {
    body = typeof req.body === "object" && req.body !== null ? req.body : JSON.parse(req.body ?? "{}");
  } catch {
    return json(res, 400, { error: "invalid json" });
  }
  const installId = body.installId;
  if (!installId || typeof installId !== "string") return json(res, 400, { error: "missing installId" });

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
