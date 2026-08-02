/** Health/config probe: reports whether durable quarantine storage is wired. */
export default function handler(_req: unknown, res: any): void {
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
}
