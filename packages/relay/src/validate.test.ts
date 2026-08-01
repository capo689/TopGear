import { describe, it, expect } from "vitest";
import {
  validateCommand,
  validateResult,
  contentScriptAccepts,
  serviceWorkerAcceptsCommand,
  serviceWorkerAcceptsResult,
} from "./validate.js";

const goodCommand = { kind: "command", correlationId: "c1", nonce: "n1", op: "captureRaw", args: {} };

describe("relay message validation", () => {
  it("accepts a well-formed command and rejects malformed ones", () => {
    expect(validateCommand(goodCommand).ok).toBe(true);
    expect(validateCommand({ ...goodCommand, op: "evilOp" }).ok).toBe(false);
    expect(validateCommand({ ...goodCommand, nonce: undefined }).ok).toBe(false);
    expect(validateCommand("not even an object").ok).toBe(false);
  });

  it("validates results", () => {
    expect(validateResult({ kind: "result", correlationId: "c1", ok: true }).ok).toBe(true);
    expect(validateResult({ kind: "result" }).ok).toBe(false);
  });
});

describe("trust boundaries (T5)", () => {
  it("content script honors runtime commands but IGNORES page-originated ones", () => {
    expect(contentScriptAccepts("runtime", goodCommand).ok).toBe(true);
    // A page-world script trying to forge a command is rejected outright.
    expect(contentScriptAccepts("page", goodCommand).ok).toBe(false);
  });

  it("service worker only accepts commands from the native port with the right nonce", () => {
    expect(serviceWorkerAcceptsCommand("native-port", goodCommand, "n1").ok).toBe(true);
    expect(serviceWorkerAcceptsCommand("native-port", goodCommand, "different-nonce").ok).toBe(false);
    // A content script or page cannot originate an authenticated command.
    expect(serviceWorkerAcceptsCommand("runtime", goodCommand, "n1").ok).toBe(false);
    expect(serviceWorkerAcceptsCommand("page", goodCommand, "n1").ok).toBe(false);
  });

  it("service worker only accepts results from the content script (runtime)", () => {
    const result = { kind: "result", correlationId: "c1", ok: true };
    expect(serviceWorkerAcceptsResult("runtime", result).ok).toBe(true);
    expect(serviceWorkerAcceptsResult("page", result).ok).toBe(false);
  });
});
