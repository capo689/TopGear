import { useState } from "react";
import type { ConfirmationCapability } from "@browser-bridge/protocol";
import { describeConfirmation, ConfirmController } from "./confirm.js";

/**
 * The confirm dialog. It renders the daemon's normalized description verbatim and never
 * any model-supplied text (INV-9). Approve/Deny call the controller, which is the ONLY
 * path that can approve a capability — the model cannot.
 */
export function ConfirmDialog({
  capability,
  controller,
}: {
  capability: ConfirmationCapability;
  controller: ConfirmController;
}): JSX.Element {
  const display = describeConfirmation(capability);
  const [outcome, setOutcome] = useState<string | null>(null);

  if (outcome) return <p className="outcome">{outcome}</p>;

  return (
    <section className="confirm">
      <h2>{display.title}</h2>
      <p className="summary">{display.summary}</p>
      <dl>
        <dt>Origin</dt>
        <dd>{display.origin}</dd>
        {display.destination ? (
          <>
            <dt>Destination</dt>
            <dd>{display.destination}</dd>
          </>
        ) : null}
        {display.sensitiveFields.length > 0 ? (
          <>
            <dt>Sensitive fields</dt>
            <dd>{display.sensitiveFields.join(", ")}</dd>
          </>
        ) : null}
        <dt>Expires</dt>
        <dd>{display.expiresAt}</dd>
      </dl>
      <div className="actions">
        <button
          type="button"
          onClick={() => {
            void controller.approve(capability);
            setOutcome("Approved");
          }}
        >
          Approve
        </button>
        <button
          type="button"
          onClick={() => {
            void controller.deny(capability);
            setOutcome("Denied");
          }}
        >
          Deny
        </button>
      </div>
    </section>
  );
}
