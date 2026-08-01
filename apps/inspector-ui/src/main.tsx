import { createRoot } from "react-dom/client";
import type { ConfirmationCapability } from "@browser-bridge/protocol";
import { ConfirmDialog } from "./App.js";
import { ConfirmController, type ConfirmCallbacks } from "./confirm.js";

/**
 * Mount the confirm dialog for a pending, daemon-built confirmation. In the live app the
 * capability and callbacks come from the daemon's local channel; the callbacks call the
 * daemon's approveConfirmation (the only approval path). The live end-to-end mount is
 * verified manually (see MILESTONE_STATUS.md).
 */
export function mountConfirm(
  container: HTMLElement,
  capability: ConfirmationCapability,
  callbacks: ConfirmCallbacks,
): void {
  const controller = new ConfirmController(callbacks);
  createRoot(container).render(<ConfirmDialog capability={capability} controller={controller} />);
}
