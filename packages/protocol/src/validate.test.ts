import { describe, it, expect } from "vitest";
import { checkBatchCaps, checkByteCap } from "./validate.js";
import { PROTOCOL_CAPS } from "./caps.js";
import type { Action } from "./action.js";

const click = (name: string): Action => ({ op: "click", target: { name } });
const anyIf = (then: Action[], els?: Action[]): Action => ({
  op: "if",
  condition: { type: "url_matches", urlGlob: "*" },
  then,
  ...(els ? { else: els } : {}),
});

describe("checkBatchCaps", () => {
  it("accepts a normal flat batch", () => {
    const r = checkBatchCaps([click("a"), click("b"), click("c")]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.expandedCount).toBe(3);
      expect(r.maxIfDepth).toBe(0);
    }
  });

  it("counts expanded actions through if branches", () => {
    const r = checkBatchCaps([anyIf([click("x"), click("y")], [click("z")])]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.expandedCount).toBe(4); // the if + 2 then + 1 else
      expect(r.maxIfDepth).toBe(1);
    }
  });

  it("rejects too many top-level actions", () => {
    const many = Array.from({ length: PROTOCOL_CAPS.maxActionsPerBatch + 1 }, (_, i) => click(String(i)));
    const r = checkBatchCaps(many);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("too_many_actions");
      expect(r.found).toBe(PROTOCOL_CAPS.maxActionsPerBatch + 1);
      expect(r.limit).toBe(PROTOCOL_CAPS.maxActionsPerBatch);
    }
  });

  it("accepts if-nesting exactly at the depth cap", () => {
    const depth2 = anyIf([anyIf([click("x")])]);
    const r = checkBatchCaps([depth2]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.maxIfDepth).toBe(2);
  });

  it("rejects if-nesting deeper than the cap", () => {
    const depth3 = anyIf([anyIf([anyIf([click("x")])])]);
    const r = checkBatchCaps([depth3]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("if_depth_exceeded");
      expect(r.found).toBe(3);
      expect(r.limit).toBe(2);
    }
  });

  it("rejects too many expanded actions even when top-level is small", () => {
    const then = Array.from({ length: PROTOCOL_CAPS.maxExpandedActions }, (_, i) => click(String(i)));
    const r = checkBatchCaps([anyIf(then)]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("too_many_expanded_actions");
      expect(r.found).toBe(PROTOCOL_CAPS.maxExpandedActions + 1);
    }
  });
});

describe("checkByteCap", () => {
  it("accepts a view under the cap", () => {
    expect(checkByteCap("view", PROTOCOL_CAPS.maxViewResponseBytes).ok).toBe(true);
  });
  it("rejects a view over the cap with a teaching error", () => {
    const r = checkByteCap("view", PROTOCOL_CAPS.maxViewResponseBytes + 1);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("view_too_large");
      expect(r.message).toContain("view");
    }
  });
  it("rejects an oversized screenshot", () => {
    const r = checkByteCap("screenshot", PROTOCOL_CAPS.maxScreenshotResponseBytes + 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("screenshot_too_large");
  });
});
