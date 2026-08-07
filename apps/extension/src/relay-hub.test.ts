import { describe, it, expect, vi } from "vitest";
import { createRelayHub } from "./relay-hub.js";

/**
 * The MV3 service worker is the relay's trusted hub and had no tests at all. These cover
 * its security properties directly, not incidentally: both validation hops, the operate
 * grant, and nonce binding.
 */

const NONCE = "n-abcdef123456";
const command = (over: Record<string, unknown> = {}) => ({
  kind: "command",
  correlationId: "c-1",
  nonce: NONCE,
  op: "readState",
  args: { ref: "s1-e1" },
  ...over,
});

function hub(opts: { tabId?: number | null; tabResult?: unknown } = {}) {
  const post = vi.fn<(msg: unknown) => void>();
  const sendToTab = vi.fn<(tabId: number, command: unknown) => Promise<unknown>>(
    async () => opts.tabResult ?? { kind: "result", correlationId: "c-1", ok: true },
  );
  const h = createRelayHub({
    post,
    sendToTab,
    getOperateTabId: () => (opts.tabId === undefined ? 7 : opts.tabId),
  });
  return { h, post, sendToTab };
}

describe("relay hub — the operate grant", () => {
  it("refuses every command until the user has granted Operate on a tab", async () => {
    const { h, post, sendToTab } = hub({ tabId: null });
    await h.onNativeMessage(command());

    expect(sendToTab).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ ok: false, error: "no operate grant" }));
  });

  it("forwards to the granted tab once a grant exists", async () => {
    const { h, sendToTab } = hub({ tabId: 42 });
    await h.onNativeMessage(command());

    expect(sendToTab).toHaveBeenCalledOnce();
    expect(sendToTab.mock.calls[0]?.[0]).toBe(42);
  });
});

describe("relay hub — hop 1, the native port", () => {
  it("rejects a command carrying the wrong nonce", async () => {
    const { h, post, sendToTab } = hub();
    await h.onNativeMessage(command()); // adopts NONCE
    post.mockClear();
    sendToTab.mockClear();

    await h.onNativeMessage(command({ nonce: "n-attacker00000", correlationId: "c-2" }));

    expect(sendToTab).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  });

  it("rejects a malformed message rather than forwarding it to the page", async () => {
    const { h, post, sendToTab } = hub();
    await h.onNativeMessage({ not: "a command" });

    expect(sendToTab).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  });

  it("binds the session nonce ONCE and never rebinds it", async () => {
    const { h, post, sendToTab } = hub();
    await h.onNativeMessage(command());
    expect(h.nonce()).toBe(NONCE);

    post.mockClear();
    sendToTab.mockClear();
    // A later message offering a different nonce must not rebind the session — otherwise
    // anything that reached the port could re-key it and then pass validation.
    await h.onNativeMessage(command({ nonce: "n-rebind0000000", correlationId: "c-3" }));

    expect(h.nonce()).toBe(NONCE);
    expect(sendToTab).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  });
});

describe("relay hub — hop 2, the content script", () => {
  it("does not pass through a result that fails validation", async () => {
    const { h, post } = hub({ tabResult: { totally: "bogus" } });
    await h.onNativeMessage(command());

    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, error: "invalid result from content script" }),
    );
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ totally: "bogus" }));
  });

  it("does not let the content script forge a result for a different correlationId", async () => {
    const { h, post } = hub({ tabResult: { kind: "result", correlationId: "c-SOMEONE-ELSE", ok: true } });
    await h.onNativeMessage(command({ correlationId: "c-1" }));

    // Whatever survives validation, the worker must never report success against a
    // correlationId the daemon did not ask about.
    const posted = post.mock.calls.at(-1)?.[0] as { correlationId?: string; ok?: boolean };
    expect(posted.correlationId === "c-SOMEONE-ELSE" && posted.ok === true).toBe(false);
  });

  it("passes a valid result straight back to the daemon", async () => {
    const valid = { kind: "result", correlationId: "c-1", ok: true };
    const { h, post } = hub({ tabResult: valid });
    await h.onNativeMessage(command());

    expect(post).toHaveBeenCalledWith(expect.objectContaining({ correlationId: "c-1", ok: true }));
  });
});
