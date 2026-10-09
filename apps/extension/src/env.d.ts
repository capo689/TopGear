// Minimal ambient declaration so the relay source typechecks without pulling the full
// @types/chrome. The real extension is bundled (WXT) and loaded in Chrome; that live
// path is verified manually (see docs/engineering/MILESTONE_STATUS.md).
declare const chrome: {
  runtime: {
    connectNative(app: string): { postMessage(m: unknown): void; onMessage: { addListener(cb: (m: unknown) => void): void }; onDisconnect: { addListener(cb: () => void): void } };
    onMessage: { addListener(cb: (m: unknown, sender: { id?: string; tab?: { id?: number } }, send: (r: unknown) => void) => boolean | void): void };
    sendMessage(m: unknown): Promise<unknown>;
    id: string;
  };
  scripting: { executeScript(opts: unknown): Promise<unknown> };
  tabs: { sendMessage(tabId: number, m: unknown): Promise<unknown> };
  action: { onClicked: { addListener(cb: (tab: { id?: number }) => void): void } };
};
