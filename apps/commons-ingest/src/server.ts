import { createServer, type Server } from "node:http";
import { type ContributionRecord, createRateLimiter, clientIp } from "@browser-bridge/contribution";
import { validateContribution, validatePurge, MAX_BYTES } from "./validate.js";

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

export function startCommonsIngest(
  options: { port?: number; host?: string; storageConfigured?: boolean } = {},
): Promise<CommonsIngest> {
  const host = options.host ?? "127.0.0.1";
  const storageConfigured = options.storageConfigured ?? true;
  const quarantine: ContributionRecord[] = [];
  // COST-03: the SAME two independent buckets the Vercel functions use, so stub === function
  // (parity.test guards it). Per-server instances → fresh state per startCommonsIngest.
  const ipLimiter = createRateLimiter();
  const idLimiter = createRateLimiter();

  const server = createServer((req, res) => {
    const send = (status: number, body: unknown): void => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const tooMany = (retryAfter: number): void => {
      res.writeHead(429, { "content-type": "application/json", "retry-after": String(retryAfter) });
      res.end(JSON.stringify({ error: "rate limited" }));
    };
    if (req.method !== "POST") return send(405, { error: "method not allowed" });

    void readBody(req).then((raw) => {
      // ORDER (identical to the Vercel functions): size cap → parse → IP bucket → validate/verify
      // → verified-installId bucket. The cheap size + parse checks precede the limiter so
      // obviously-malformed input is never rate-limited (and both implementations agree).
      if (req.url === "/contributions") {
        if (raw.length > MAX_BYTES) return send(413, { error: "record too large" });
        let rec: Record<string, unknown> | null;
        try {
          rec = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          return send(400, { error: "invalid json" });
        }
        const ipRetry = ipLimiter(clientIp(req));
        if (ipRetry) return tooMany(ipRetry);
        const result = validateContribution(raw.length, rec, { storageConfigured });
        if (result.installId) {
          const idRetry = idLimiter(result.installId); // secondary bucket: verified installId
          if (idRetry) return tooMany(idRetry);
        }
        if (result.status === 202 && rec) quarantine.push(rec as unknown as ContributionRecord);
        return send(result.status, result.body);
      }
      if (req.url === "/purge") {
        if (raw.length > MAX_BYTES) return send(413, { error: "record too large" });
        let proof: Record<string, unknown> | null;
        try {
          proof = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          proof = null;
        }
        if (proof === null) return send(400, { error: "invalid json" });
        const ipRetry = ipLimiter(clientIp(req));
        if (ipRetry) return tooMany(ipRetry);
        const result = validatePurge(proof, { storageConfigured });
        if (result.installId) {
          const idRetry = idLimiter(result.installId);
          if (idRetry) return tooMany(idRetry);
        }
        if (result.status !== 200 || !result.installId) return send(result.status, result.body);
        // Purge ONLY the installId derived from the verified proof (AUTHZ-02).
        const before = quarantine.length;
        for (let i = quarantine.length - 1; i >= 0; i--) {
          if (quarantine[i]!.installId === result.installId) quarantine.splice(i, 1);
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
