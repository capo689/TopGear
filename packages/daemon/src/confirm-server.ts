import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { describeConfirmation, type ConfirmationDisplay } from "@browser-bridge/policy";
import type { ConfirmationCapability } from "@browser-bridge/protocol";

/**
 * The out-of-band approval channel for INV-9.
 *
 * The invariant says a human approves a DAEMON-authored description of a blocked action,
 * and the model cannot mint its own permission. Every piece of that existed except the
 * channel: capabilities were minted pending, `approveConfirmation` worked, the dialog was
 * written and tested — and nothing connected them, so in practice no high-risk action
 * could ever be approved by anyone. The invariant was true only because the path was
 * unreachable.
 *
 * Deliberately narrow, because this is an authorization surface:
 *   - binds 127.0.0.1 ONLY, never 0.0.0.0, on an ephemeral port
 *   - every request needs a token generated per daemon run and never written to disk
 *   - the token is compared in constant time, so a wrong token leaks nothing by timing
 *   - no CORS headers, so a web page in the user's browser cannot call it
 *   - approve/deny are POST only; a GET cannot be triggered by a stray link or an <img>
 *   - it serves DATA, not model text: the payload is `describeConfirmation`'s output
 *
 * It is not an API for the model. The model's only reach is `bridge_confirm`, which asks
 * the daemon to surface what it already built and returns the URL a human should open.
 */

export interface ConfirmServerDeps {
  /** Pending capabilities for a session, straight from the CapabilityStore. */
  listPending(sessionId: string): ConfirmationCapability[];
  approve(sessionId: string, capabilityId: string): boolean;
  deny(sessionId: string, capabilityId: string): boolean;
}

export interface ConfirmServerHandle {
  /** e.g. http://127.0.0.1:53017 — the origin a human opens. */
  url: string;
  token: string;
  port: number;
  close(): Promise<void>;
}

/** Constant-time compare, so a near-miss token cannot be found by timing the response. */
function tokenMatches(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function startConfirmServer(deps: ConfirmServerDeps, port = 0): Promise<ConfirmServerHandle> {
  const token = randomBytes(24).toString("hex");

  const server: Server = createServer((req, res) => {
    const send = (code: number, body: unknown): void => {
      const json = JSON.stringify(body);
      res.writeHead(code, {
        "content-type": "application/json",
        // This surface is for a local human, never a web page. No CORS, and no sniffing.
        "x-content-type-options": "nosniff",
        "cache-control": "no-store",
      });
      res.end(json);
    };

    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const supplied = req.headers["x-bb-token"];
    const given = Array.isArray(supplied) ? (supplied[0] ?? "") : (supplied ?? url.searchParams.get("token") ?? "");
    if (!tokenMatches(String(given), token)) {
      send(401, { error: "unauthorized" });
      return;
    }

    const sessionId = url.searchParams.get("sessionId") ?? "";
    if (!sessionId) {
      send(400, { error: "sessionId required" });
      return;
    }

    if (req.method === "GET" && url.pathname === "/pending") {
      const pending: ConfirmationDisplay[] = deps.listPending(sessionId).map(describeConfirmation);
      send(200, { pending });
      return;
    }

    // State-changing routes are POST-only: a GET approve could be fired by a link or an
    // image tag the user never knowingly loaded.
    if (req.method === "POST" && (url.pathname === "/approve" || url.pathname === "/deny")) {
      const capabilityId = url.searchParams.get("capabilityId") ?? "";
      if (!capabilityId) {
        send(400, { error: "capabilityId required" });
        return;
      }
      const ok =
        url.pathname === "/approve" ? deps.approve(sessionId, capabilityId) : deps.deny(sessionId, capabilityId);
      // `false` means unknown, already consumed, or expired — all of which mean the human
      // is looking at something stale. Say so rather than reporting a hollow success.
      send(ok ? 200 : 409, ok ? { ok: true } : { ok: false, error: "capability is unknown, expired, or already used" });
      return;
    }

    send(404, { error: "not found" });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });

  const addr = server.address();
  const boundPort = typeof addr === "object" && addr ? addr.port : port;
  return {
    url: `http://127.0.0.1:${boundPort}`,
    token,
    port: boundPort,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
