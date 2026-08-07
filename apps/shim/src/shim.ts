#!/usr/bin/env node
import { createConnection } from "node:net";
import { SCHEMA_VERSION } from "@browser-bridge/protocol";
import { validateResult } from "@browser-bridge/relay";
import { frameForChrome, createFrameReader, createLineReader } from "./framing.js";

/**
 * Dev-mode native-messaging host (plan §2, §13). Chrome speaks to this over stdio using
 * length-prefixed frames; the daemon speaks over an authed local socket. The shim is a
 * trust hinge: it re-validates results from the extension before forwarding to the
 * daemon. The daemon is authoritative for commands (and the service worker re-validates
 * them on receipt — defense in depth). The signed Rust/Go production shim lands at M6.
 *
 * NOTE: the live end-to-end path (Chrome ↔ shim ↔ daemon socket) is verified manually;
 * see MILESTONE_STATUS.md.
 */
const SOCKET_PATH = process.env.BB_SOCKET ?? "/tmp/browser-bridge.sock";

function writeToChrome(obj: unknown): void {
  process.stdout.write(frameForChrome(obj));
}

const daemon = createConnection(SOCKET_PATH);
daemon.on("connect", () => {
  daemon.write(JSON.stringify({ kind: "handshake", schemaVersion: SCHEMA_VERSION, shimVersion: "0.1.0" }) + "\n");
});

// Daemon → shim (newline-delimited JSON) → Chrome (framed).
const fromDaemon = createLineReader();
daemon.on("data", (chunk: Buffer) => {
  for (const msg of fromDaemon.push(chunk)) writeToChrome(msg);
});
daemon.on("error", (err) => {
  process.stderr.write(`shim: daemon socket error: ${String(err)}\n`);
});

// Chrome → shim (framed) → daemon (newline-delimited JSON), validating on the way.
const fromChrome = createFrameReader();
process.stdin.on("data", (chunk: Buffer) => {
  for (const parsed of fromChrome.push(chunk)) {
    // The trust hinge: anything that does not validate is dropped here and never reaches
    // the daemon socket.
    const checked = validateResult(parsed);
    if (checked.ok) daemon.write(JSON.stringify(checked.value) + "\n");
  }
});
