import { createServer, type Server, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { validateResult, type RelayCommand, type RelayResult, type RelayOp } from "@browser-bridge/relay";

/**
 * The daemon-side end of the relay chain (plan §2): a Unix-socket listener the native
 * shim connects to. Commands go daemon → shim → SW → content script; results come back.
 * Commands are multiplexed by correlationId. Every result is re-validated on receipt
 * (INV: content scripts are less trusted than the daemon).
 */
export interface RelayTransport {
  send(op: RelayOp, args: Record<string, unknown>): Promise<RelayResult>;
}

export interface SocketRelay {
  socketPath: string;
  transport: RelayTransport;
  /** Resolves when the shim connects. */
  ready(): Promise<void>;
  close(): Promise<void>;
}

export function startSocketRelay(socketPath: string, nonce: string, timeoutMs = 15_000): SocketRelay {
  const pending = new Map<string, (r: RelayResult) => void>();
  let client: Socket | null = null;
  let resolveReady: (() => void) | null = null;
  const readyPromise = new Promise<void>((res) => (resolveReady = res));
  let buffer = "";

  const server: Server = createServer((sock) => {
    client = sock;
    resolveReady?.();
    sock.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (!line.trim()) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        const checked = validateResult(parsed);
        if (!checked.ok) continue;
        const resolve = pending.get(checked.value.correlationId);
        if (resolve) {
          pending.delete(checked.value.correlationId);
          resolve(checked.value);
        }
      }
    });
    sock.on("close", () => {
      if (client === sock) client = null;
    });
  });
  server.listen(socketPath);

  const transport: RelayTransport = {
    send(op, args) {
      return new Promise<RelayResult>((resolve, reject) => {
        if (!client) return reject(new Error("no extension connected"));
        const correlationId = randomUUID();
        const command: RelayCommand = { kind: "command", correlationId, nonce, op, args };
        pending.set(correlationId, resolve);
        const timer = setTimeout(() => {
          if (pending.delete(correlationId)) reject(new Error(`relay timeout for ${op}`));
        }, timeoutMs);
        const wrapped = (r: RelayResult) => {
          clearTimeout(timer);
          resolve(r);
        };
        pending.set(correlationId, wrapped);
        client.write(JSON.stringify(command) + "\n");
      });
    },
  };

  return {
    socketPath,
    transport,
    ready: () => readyPromise,
    close: () =>
      new Promise<void>((res) => {
        client?.end();
        server.close(() => res());
      }),
  };
}
