import { createServer, type Server } from "node:http";
import type { ContributionRecord } from "@browser-bridge/contribution";

/**
 * The quarantine intake (plan §2 cloud/ingest — "deliberately trivial"). This local stub
 * exposes the SAME two routes the future Vercel endpoint will serve, so the client is
 * unchanged when the real endpoint lands (§16 decision 3):
 *   POST /contributions   → accept one signed Class C record into quarantine
 *   POST /purge           → { installId } retroactively purge an install's records
 * It performs NO promotion — that is R2. It just quarantines.
 */
export interface CommonsIngest {
  url: string;
  port: number;
  server: Server;
  readonly quarantine: ContributionRecord[];
  close(): Promise<void>;
}

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export function startCommonsIngest(options: { port?: number; host?: string } = {}): Promise<CommonsIngest> {
  const host = options.host ?? "127.0.0.1";
  const quarantine: ContributionRecord[] = [];

  const server = createServer((req, res) => {
    const send = (status: number, body: unknown): void => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method !== "POST") return send(405, { error: "method not allowed" });

    void readBody(req).then((raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return send(400, { error: "invalid json" });
      }
      if (req.url === "/contributions") {
        // Minimal shape guard; deep validation/quorum is R2's promotion pipeline.
        const rec = parsed as Partial<ContributionRecord>;
        if (!rec.origin || !rec.installId || !rec.signature) return send(400, { error: "missing fields" });
        quarantine.push(rec as ContributionRecord);
        return send(202, { accepted: true });
      }
      if (req.url === "/purge") {
        const { installId } = parsed as { installId?: string };
        if (!installId) return send(400, { error: "missing installId" });
        const before = quarantine.length;
        for (let i = quarantine.length - 1; i >= 0; i--) {
          if (quarantine[i]!.installId === installId) quarantine.splice(i, 1);
        }
        return send(200, { purged: before - quarantine.length });
      }
      return send(404, { error: "not found" });
    });
  });

  return new Promise((resolve) => {
    server.listen(options.port ?? 0, host, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : (options.port ?? 0);
      resolve({
        url: `http://${host}:${port}`,
        port,
        server,
        quarantine,
        close: () => new Promise<void>((done, fail) => server.close((e) => (e ? fail(e) : done()))),
      });
    });
  });
}
