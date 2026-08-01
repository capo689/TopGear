import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, normalize, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** public/ sits beside src/ (dev) and beside dist/ (built) — ../public works for both. */
const PUBLIC_DIR = fileURLToPath(new URL("../public", import.meta.url));

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

export interface FixtureFarm {
  url: string;
  port: number;
  server: Server;
  close(): Promise<void>;
}

export interface FixtureFarmOptions {
  /** 0 (default) picks an ephemeral port — safe for parallel tests. */
  port?: number;
  host?: string;
}

function resolveFile(urlPath: string): string | null {
  const clean = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  let rel = normalize(clean);
  if (rel === "/" || rel === "" || rel === ".") rel = "/index.html";
  let filePath = join(PUBLIC_DIR, rel);

  // Path-traversal guard: the resolved path must stay inside PUBLIC_DIR.
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + sep)) return null;

  if (existsSync(filePath)) {
    if (existsSync(join(filePath, "index.html"))) return join(filePath, "index.html");
    return filePath;
  }
  if (existsSync(filePath + ".html")) return filePath + ".html";
  return null;
}

/**
 * Start the fixture farm on loopback. Deterministic, fully self-contained (no external
 * assets or third-party scripts), so tests exercise the real relay/execution path
 * against stable pages.
 */
export function startFixtureFarm(options: FixtureFarmOptions = {}): Promise<FixtureFarm> {
  const host = options.host ?? "127.0.0.1";

  const server = createServer((req, res) => {
    const target = resolveFile(req.url ?? "/");
    if (target === null) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }
    readFile(target)
      .then((body) => {
        res.writeHead(200, {
          "content-type": CONTENT_TYPES[extname(target)] ?? "application/octet-stream",
          "cache-control": "no-store",
        });
        res.end(body);
      })
      .catch(() => {
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        res.end("error");
      });
  });

  return new Promise((resolve) => {
    server.listen(options.port ?? 0, host, () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : (options.port ?? 0);
      resolve({
        url: `http://${host}:${port}`,
        port,
        server,
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((err) => (err ? fail(err) : done()));
          }),
      });
    });
  });
}
