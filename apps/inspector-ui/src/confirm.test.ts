import { describe, it, expect } from "vitest";
import { describeConfirmation, ConfirmController } from "./confirm.js";
import type { ConfirmationCapability } from "@browser-bridge/protocol";

const cap: ConfirmationCapability = {
  capabilityId: "nonce-1",
  action: { op: "click", summary: "Activate \"Delete account permanently\" on https://app.example.", origin: "https://app.example", formAction: "https://app.example/delete" },
  origin: "https://app.example",
  pageRevision: 4,
  sensitiveFields: ["ssn"],
  expiresAt: "2026-08-01T00:05:00.000Z",
};

describe("describeConfirmation", () => {
  it("renders ONLY daemon-authored fields (never the model's words)", () => {
    const d = describeConfirmation(cap);
    expect(d.summary).toBe(cap.action.summary);
    expect(d.origin).toBe("https://app.example");
    expect(d.destination).toBe("https://app.example/delete");
    expect(d.sensitiveFields).toEqual(["ssn"]);
    expect(d.capabilityId).toBe("nonce-1");
  });
});

describe("ConfirmController", () => {
  it("approve/deny call back with the capability id (only the UI can approve)", async () => {
    const calls: string[] = [];
    const controller = new ConfirmController({
      approve: (id) => {
        calls.push(`approve:${id}`);
      },
      deny: (id) => {
        calls.push(`deny:${id}`);
      },
    });
    await controller.approve(cap);
    await controller.deny(cap);
    expect(calls).toEqual(["approve:nonce-1", "deny:nonce-1"]);
  });
});
