#!/usr/bin/env node
import { createConnection } from "node:net";
import { SCHEMA_VERSION } from "@browser-bridge/protocol";
import { validateResult } from "@browser-bridge/relay";

/**
 * Dev-mode native-messaging host (plan §2, §13). Chrome speaks to this over stdio using
 * length-prefixed frames; the daemon speaks over an authed local socket. The shim is a
 * trust hinge: it re-validates results from the extension before forwarding to the
 * daemon. The daemon is authoritative for commands (and the service worker re-validates
 * them on receipt — defense in depth). The signed Rust/Go production shim lands at M6.
 *
 * NOTE: the live end-to-end path (Chrome ↔ shim ↔ daemon socket) is verified manually;
 * see docs/engineering/MILESTONE_STATUS.md.
 */
const SOCKET_PATH = process.env.BB_SOCKET ?? "/tmp/browser-bridge.sock";

// --- Chrome native-messaging framing: 4-byte LE length + UTF-8 JSON ---
function frameForChrome(obj: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(obj), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  return Buffer.concat([header, json]);
}

function writeToChrome(obj: unknown): void {
  process.stdout.write(frameForChrome(obj));
}

const daemon = createConnection(SOCKET_PATH);
daemon.on("connect", () => {
  daemon.write(JSON.stringify({ kind: "handshake", schemaVersion: SCHEMA_VERSION, shimVersion: "0.1.0" }) + "\n");
});

// Daemon → shim (newline-delimited JSON) → Chrome (framed).
let daemonBuffer = "";
daemon.on("data", (chunk: Buffer) => {
  daemonBuffer += chunk.toString("utf8");
  let idx: number;
  while ((idx = daemonBuffer.indexOf("\n")) >= 0) {
    const line = daemonBuffer.slice(0, idx);
    daemonBuffer = daemonBuffer.slice(idx + 1);
    if (line.trim()) writeToChrome(JSON.parse(line));
  }
});
daemon.on("error", (err) => {
  process.stderr.write(`shim: daemon socket error: ${String(err)}\n`);
});

// Chrome → shim (framed) → daemon (newline-delimited JSON), validating on the way.
let chromeBuffer = Buffer.alloc(0);
process.stdin.on("data", (chunk: Buffer) => {
  chromeBuffer = Buffer.concat([chromeBuffer, chunk]);
  while (chromeBuffer.length >= 4) {
    const length = chromeBuffer.readUInt32LE(0);
    if (chromeBuffer.length < 4 + length) break;
    const body = chromeBuffer.subarray(4, 4 + length).toString("utf8");
    chromeBuffer = chromeBuffer.subarray(4 + length);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      continue;
    }
    const checked = validateResult(parsed);
    if (checked.ok) daemon.write(JSON.stringify(checked.value) + "\n");
  }
});
