/**
 * Health/config probe: reports whether durable quarantine storage is wired.
 * "disabled" means COMMONS_INGEST_ENABLED is not "true", so nothing is accepted at all.
 *
 * "unconfigured" means exactly one thing — SUPABASE_DB_URL is absent, so POST /api/contributions
 * will 503 rather than accept a record it cannot durably store (INV-10). It reports only the
 * PRESENCE of the setting, never any part of the connection string (INV-4).
 */
export default function handler(_req: unknown, res: any): void {
  try {
    const storage = process.env.COMMONS_INGEST_ENABLED !== "true" ? "disabled" : process.env.SUPABASE_DB_URL ? "supabase-postgres" : "unconfigured";
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
