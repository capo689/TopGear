import { contentScriptAccepts, type RelayCommand, type RelayResult } from "@browser-bridge/relay";
import { pageExtractor, readElementState, type ExtractOptions } from "@browser-bridge/semantic-engine";

/**
 * Content script (LEAST-trusted context). It runs in the page's tab and executes the
 * daemon's commands against the DOM, but it ONLY honors commands delivered by the
 * service worker via chrome.runtime — never anything from the page (`window.postMessage`
 * is ignored). See @browser-bridge/relay for the trust guard.
 *
 * Input dispatch here is user-action emulation (synthetic events). Trusted CDP input is
 * the separately-consented deep-control mode (chrome.debugger), not this path.
 */

function q(ref: string): HTMLElement | null {
  return document.querySelector(`[data-bb-ref="${ref}"]`);
}

function fire(el: Element, type: string): void {
  el.dispatchEvent(new Event(type, { bubbles: true }));
}

async function run(cmd: RelayCommand): Promise<RelayResult> {
  const args = cmd.args as Record<string, unknown>;
  const ok = (data?: unknown): RelayResult => ({ kind: "result", correlationId: cmd.correlationId, ok: true, data });
  const fail = (error: string): RelayResult => ({ kind: "result", correlationId: cmd.correlationId, ok: false, error });

  switch (cmd.op) {
    case "captureRaw":
      return ok(pageExtractor(args as unknown as ExtractOptions));
    case "readState":
      return ok(readElementState(String(args.ref)));
    case "fillText": {
      const el = q(String(args.ref)) as HTMLInputElement | null;
      if (!el) return fail("not_found");
      el.focus();
      el.value = String(args.value);
      fire(el, "input");
      fire(el, "change");
      return ok();
    }
    case "click": {
      const el = q(String(args.ref));
      if (!el) return fail("not_found");
      el.click();
      return ok();
    }
    case "url":
      return ok(location.href);
    default:
      return fail(`unsupported op in content script: ${cmd.op}`);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Trust boundary: only accept validated commands delivered via the runtime channel.
  const accepted = contentScriptAccepts("runtime", message);
  if (!accepted.ok) {
    sendResponse({ kind: "result", correlationId: "unknown", ok: false, error: accepted.error });
    return true;
  }
  run(accepted.value).then(sendResponse);
  return true; // async response
});
