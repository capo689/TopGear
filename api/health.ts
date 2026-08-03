/** Health/config probe: reports whether durable quarantine storage is wired. */
export default function handler(_req: unknown, res: any): void {
  try {
    const storage = process.env.BLOB_READ_WRITE_TOKEN ? "vercel-blob" : "unconfigured";
    res.setHeader("content-type", "application/json");
    res.status(200).end(
      JSON.stringify({
        service: "commons-ingest",
        release: "R1",
        storage,
        routes: ["POST /api/contributions", "POST /api/purge"],
      }),
    );
  } catch (err) {
    // OBS-01: even the health probe reports failures in a structured, redacted line.
    try {
      console.error(JSON.stringify({ level: "error", at: "commons-ingest", fn: "health", error: err instanceof Error ? err.message : String(err) }));
    } catch {
      /* logging must never throw */
    }
    res.status(500).end(JSON.stringify({ error: "internal error" }));
  }
}
