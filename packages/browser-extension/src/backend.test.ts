import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFixtureFarm, type FixtureFarm, FIXTURES } from "@browser-bridge/fixture-farm";
import { createPlaywrightBackend } from "@browser-bridge/browser-playwright";
import type { BrowserBackend, BrowserPage } from "@browser-bridge/backend";
import { startSocketRelay, ExtensionBackend, type SocketRelay } from "./index.js";

/**
 * Proves the extension DATA PATH end-to-end headlessly: the daemon drives a page over a
 * REAL Unix socket with the REAL relay framing, and a fake extension (socket client)
 * executes the commands against real Chromium. The only unproven-here link is Chrome
 * loading the bundle + native-messaging registration — those are the human steps in
 * INSTALL.md.
 */
let farm: FixtureFarm;
let playwright: BrowserBackend;
let realTab: BrowserPage;
let relay: SocketRelay;

// A stand-in for the shim + service worker + content script: it receives relay commands
// on the socket and runs them against the real Chromium tab.
async function dispatch(cmd: { op: string; correlationId: string; args: Record<string, unknown> }, page: BrowserPage) {
  const a = cmd.args;
  const ok = (data?: unknown) => ({ kind: "result", correlationId: cmd.correlationId, ok: true, ...(data !== undefined ? { data } : {}) });
  const fail = (error: string) => ({ kind: "result", correlationId: cmd.correlationId, ok: false, error });
  try {
    switch (cmd.op) {
      case "captureRaw": return ok(await page.captureRaw(a as never));
      case "readState": return ok(await page.readState(String(a.ref)));
      case "fillText": { const r = await page.fillText(String(a.ref), String(a.value)); return r.ok ? ok() : fail(r.reason); }
      case "setChecked": { const r = await page.setChecked(String(a.ref), Boolean(a.checked)); return r.ok ? ok() : fail(r.reason); }
      case "selectOption": { const r = await page.selectOption(String(a.ref), a.values as string[]); return r.ok ? ok() : fail(r.reason); }
      case "click": { const r = await page.click(String(a.ref)); return r.ok ? ok() : fail(r.reason); }
      case "url": return ok(page.url());
      default: return fail(`unsupported: ${cmd.op}`);
    }
  } catch (e) {
    return fail(String(e));
  }
}

let fakeExt: ReturnType<typeof connect>;

beforeAll(async () => {
  farm = await startFixtureFarm();
  playwright = await createPlaywrightBackend({ headless: true });
  realTab = await playwright.attach(farm.url + FIXTURES.nativeForm);

  const socketPath = join(tmpdir(), `bb-ext-${Date.now()}.sock`);
  relay = startSocketRelay(socketPath, "test-nonce");

  fakeExt = connect(socketPath);
  let buffer = "";
  fakeExt.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (!line.trim()) continue;
      const cmd = JSON.parse(line);
      void dispatch(cmd, realTab).then((r) => fakeExt.write(JSON.stringify(r) + "\n"));
    }
  });
  await relay.ready();
}, 60_000);

afterAll(async () => {
  fakeExt?.end();
  await relay?.close();
  await realTab?.close();
  await playwright?.shutdown();
  await farm?.close();
});

describe("ExtensionBackend over the real relay socket", () => {
  it("captures a view and fills fields through the daemon → socket → extension → tab chain", async () => {
    const backend = new ExtensionBackend(relay.transport);
    const page = await backend.attach();

    const raw = await page.captureRaw({ scope: { kind: "all_forms" }, refPrefix: "x-" });
    expect(raw.elements.length).toBeGreaterThanOrEqual(20);
    expect(page.url()).toContain("native-form"); // url cache populated over the relay

    const email = raw.elements.find((e) => e.name === "Email")!;
    expect((await page.fillText(email.ref, "ada@example.com")).ok).toBe(true);
    expect((await page.readState(email.ref)).value).toBe("ada@example.com");

    const agree = raw.elements.find((e) => e.name?.includes("agree to the terms"))!;
    expect((await page.setChecked(agree.ref, true)).ok).toBe(true);
    expect((await page.readState(agree.ref)).checked).toBe(true);
  }, 30_000);

  it("returns a typed not_found through the relay for a missing ref", async () => {
    const backend = new ExtensionBackend(relay.transport);
    const page = await backend.attach();
    const outcome = await page.fillText("no-such-ref", "x");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("not_found");
  }, 30_000);
});
