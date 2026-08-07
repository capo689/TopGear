/**
 * Pure framing/parsing for the native-messaging shim, extracted so the trust hinge can be
 * tested. No I/O, no sockets, no process globals — `shim.ts` wires these to real streams.
 *
 * Both directions are STREAMING and must survive arbitrary chunk boundaries: a 4-byte
 * length header can arrive split across two reads, and several frames can arrive in one.
 * Getting that wrong desynchronises the stream permanently rather than dropping a single
 * message, which is why it is worth testing directly rather than only end to end.
 */

/** Chrome native-messaging frame: 4-byte little-endian length + UTF-8 JSON. */
export function frameForChrome(obj: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(obj), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  return Buffer.concat([header, json]);
}

/**
 * Incremental reader for Chrome's framed stream. Feed it whatever bytes arrived; it
 * returns the messages that are now complete and retains the partial remainder.
 *
 * A body that is not valid JSON is DROPPED rather than throwing: one malformed frame must
 * not take down the stream, and its length header still tells us exactly how far to skip,
 * so the stream stays in sync.
 */
export function createFrameReader(): { push(chunk: Buffer): unknown[]; pending(): number } {
  let buf = Buffer.alloc(0);
  return {
    push(chunk: Buffer): unknown[] {
      buf = Buffer.concat([buf, chunk]);
      const out: unknown[] = [];
      while (buf.length >= 4) {
        const length = buf.readUInt32LE(0);
        if (buf.length < 4 + length) break;
        const body = buf.subarray(4, 4 + length).toString("utf8");
        buf = buf.subarray(4 + length);
        try {
          out.push(JSON.parse(body));
        } catch {
          // malformed frame: skipped, stream stays aligned
        }
      }
      return out;
    },
    pending: () => buf.length,
  };
}

/**
 * Incremental reader for the daemon's newline-delimited JSON. Same contract: complete
 * messages out, partial line retained. Blank lines are ignored; a malformed line is
 * dropped rather than thrown, for the same reason as above.
 */
export function createLineReader(): { push(chunk: string | Buffer): unknown[]; pending(): number } {
  let buf = "";
  return {
    push(chunk: string | Buffer): unknown[] {
      buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      const out: unknown[] = [];
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        try {
          out.push(JSON.parse(line));
        } catch {
          // malformed line: skipped
        }
      }
      return out;
    },
    pending: () => buf.length,
  };
}
