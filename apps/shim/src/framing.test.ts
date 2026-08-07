import { describe, it, expect } from "vitest";
import { validateResult } from "@browser-bridge/relay";
import { frameForChrome, createFrameReader, createLineReader } from "./framing.js";

/**
 * The shim had no tests at all, despite being a documented trust hinge: everything the
 * extension sends is re-validated here before it can reach the daemon socket.
 *
 * The cases that matter most are the boring ones. Both directions are streaming, so a
 * length header can arrive split across reads and several messages can arrive in one.
 * Mishandling that does not drop one message — it desynchronises the stream permanently,
 * and every subsequent message is garbage.
 */

describe("frameForChrome", () => {
  it("writes a 4-byte little-endian length followed by the UTF-8 JSON body", () => {
    const f = frameForChrome({ a: 1 });
    const body = JSON.stringify({ a: 1 });
    expect(f.readUInt32LE(0)).toBe(Buffer.byteLength(body, "utf8"));
    expect(f.subarray(4).toString("utf8")).toBe(body);
  });

  it("uses BYTE length, not character length, for multi-byte content", () => {
    // "é" is 2 bytes in UTF-8. A character-length header truncates the body and
    // desynchronises everything after it.
    const f = frameForChrome({ s: "café ☕" });
    const body = JSON.stringify({ s: "café ☕" });
    expect(f.readUInt32LE(0)).toBe(Buffer.byteLength(body, "utf8"));
    expect(f.readUInt32LE(0)).not.toBe(body.length);
    expect(JSON.parse(f.subarray(4).toString("utf8"))).toEqual({ s: "café ☕" });
  });
});

describe("createFrameReader (Chrome → shim)", () => {
  it("reads a whole frame delivered in one chunk", () => {
    const r = createFrameReader();
    expect(r.push(frameForChrome({ k: "v" }))).toEqual([{ k: "v" }]);
    expect(r.pending()).toBe(0);
  });

  it("reassembles a frame split across chunks, including mid-header", () => {
    const r = createFrameReader();
    const f = frameForChrome({ hello: "world" });
    // Split inside the 4-byte length header — the nastiest boundary.
    expect(r.push(f.subarray(0, 2))).toEqual([]);
    expect(r.push(f.subarray(2, 6))).toEqual([]);
    expect(r.push(f.subarray(6))).toEqual([{ hello: "world" }]);
    expect(r.pending()).toBe(0);
  });

  it("returns every message when several frames arrive in one chunk", () => {
    const r = createFrameReader();
    const chunk = Buffer.concat([frameForChrome({ n: 1 }), frameForChrome({ n: 2 }), frameForChrome({ n: 3 })]);
    expect(r.push(chunk)).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  it("retains a trailing partial frame instead of losing or mangling it", () => {
    const r = createFrameReader();
    const whole = frameForChrome({ n: 1 });
    const partial = frameForChrome({ n: 2 });
    expect(r.push(Buffer.concat([whole, partial.subarray(0, 5)]))).toEqual([{ n: 1 }]);
    expect(r.pending()).toBeGreaterThan(0);
    expect(r.push(partial.subarray(5))).toEqual([{ n: 2 }]);
  });

  it("drops a malformed frame but stays in sync for the next one", () => {
    const r = createFrameReader();
    const bad = Buffer.from("not json", "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32LE(bad.length, 0);
    const chunk = Buffer.concat([header, bad, frameForChrome({ ok: true })]);
    // The bad frame is skipped; the good one after it still arrives intact.
    expect(r.push(chunk)).toEqual([{ ok: true }]);
  });

  it("round-trips multi-byte content through frame and reader", () => {
    const r = createFrameReader();
    expect(r.push(frameForChrome({ s: "café ☕ 日本" }))).toEqual([{ s: "café ☕ 日本" }]);
  });
});

describe("createLineReader (daemon → shim)", () => {
  it("reads complete newline-delimited messages", () => {
    const r = createLineReader();
    expect(r.push('{"a":1}\n{"b":2}\n')).toEqual([{ a: 1 }, { b: 2 }]);
    expect(r.pending()).toBe(0);
  });

  it("holds a partial line until its newline arrives", () => {
    const r = createLineReader();
    expect(r.push('{"a":')).toEqual([]);
    expect(r.push("1}\n")).toEqual([{ a: 1 }]);
  });

  it("ignores blank lines and drops a malformed line without killing the stream", () => {
    const r = createLineReader();
    expect(r.push('\n\nnot json\n{"good":true}\n')).toEqual([{ good: true }]);
  });
});

describe("the trust hinge", () => {
  it("rejects a frame that parses as JSON but is not a valid relay result", () => {
    const r = createFrameReader();
    const [parsed] = r.push(frameForChrome({ totally: "bogus" }));
    // Parsing succeeds — validation is what must stop it reaching the daemon.
    expect(parsed).toEqual({ totally: "bogus" });
    expect(validateResult(parsed).ok).toBe(false);
  });

  it("rejects a structurally-plausible message with a bad field type", () => {
    const r = createFrameReader();
    const [parsed] = r.push(frameForChrome({ id: 12345, ok: "yes" }));
    expect(validateResult(parsed).ok).toBe(false);
  });
});
