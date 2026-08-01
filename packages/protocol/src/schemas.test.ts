import { describe, it, expect } from "vitest";
import {
  SemanticView,
  Action,
  ActionBatch,
  TaskGrant,
  ConfirmationCapability,
  BatchResult,
  FailureDetail,
  ViewScope,
  isSecretRef,
  SCHEMA_VERSION,
} from "./index.js";

describe("SemanticView", () => {
  const base = {
    sessionId: "s1",
    pageId: "p1",
    revision: 3,
    url: "https://example.com/apply",
    origin: "https://example.com",
    title: "Apply",
    loading: "idle",
    scope: { kind: "visible_form" },
    elements: [{ ref: "e1", role: "textbox", name: "Email", editable: true }],
    forms: [{ ref: "f1", fields: ["e1"], action: "https://example.com/submit" }],
    alerts: [],
    trust: { pageContent: "untrusted" },
  };

  it("round-trips a valid view", () => {
    const parsed = SemanticView.parse(base);
    expect(parsed.revision).toBe(3);
    expect(parsed.trust.pageContent).toBe("untrusted");
  });

  it("rejects a view whose trust flag is not untrusted (INV-2)", () => {
    const bad = { ...base, trust: { pageContent: "trusted" } };
    expect(SemanticView.safeParse(bad).success).toBe(false);
  });

  it("rejects redacted-secret confusion only structurally, not semantically", () => {
    const redacted = {
      ...base,
      elements: [{ ref: "e2", role: "textbox", name: "Password", valueRedacted: true }],
    };
    expect(SemanticView.safeParse(redacted).success).toBe(true);
  });
});

describe("Action", () => {
  it("accepts a fill with a plain string", () => {
    const a = Action.parse({ op: "fill", target: { name: "Email" }, value: "a@b.com" });
    expect(a.op).toBe("fill");
  });

  it("accepts a fill with a SecretRef and never carries a raw value", () => {
    const a = Action.parse({ op: "fill", target: { name: "Password" }, value: { secretRef: "kc:pw" } });
    expect(a.op).toBe("fill");
    if (a.op === "fill") expect(isSecretRef(a.value)).toBe(true);
  });

  it("accepts a nested if batch", () => {
    const batch = ActionBatch.parse({
      actions: [
        { op: "fill", target: { name: "Country" }, value: "US" },
        { op: "wait", condition: { type: "element_state", target: { name: "State" }, state: "enabled" } },
        {
          op: "if",
          condition: { type: "element_present", target: { name: "State" } },
          then: [{ op: "select", target: { name: "State" }, value: "OR" }],
        },
      ],
    });
    expect(batch.actions).toHaveLength(3);
  });

  it("rejects an unknown op", () => {
    expect(Action.safeParse({ op: "teleport", target: {} }).success).toBe(false);
  });
});

describe("ViewScope", () => {
  it("accepts a content scope with a section region", () => {
    const s = ViewScope.parse({ kind: "content", region: { kind: "section", heading: "Pricing" } });
    expect(s.kind).toBe("content");
  });
});

describe("authorization types", () => {
  it("round-trips a TaskGrant", () => {
    const g = TaskGrant.parse({
      taskId: "t1",
      allowedOrigins: ["https://example.com"],
      allowedRiskTiers: ["low", "medium"],
      sensitiveDataDestinations: ["https://example.com"],
      budgets: { maxPages: 10 },
      expiresAt: "2026-08-01T00:00:00.000Z",
    });
    expect(g.allowedRiskTiers).toContain("medium");
  });

  it("round-trips a daemon-built ConfirmationCapability", () => {
    const c = ConfirmationCapability.parse({
      capabilityId: "nonce-1",
      action: { op: "click", summary: "Submit the application to example.com", origin: "https://example.com" },
      origin: "https://example.com",
      pageRevision: 7,
      sensitiveFields: ["ssn"],
      expiresAt: "2026-08-01T00:05:00.000Z",
    });
    expect(c.pageRevision).toBe(7);
  });
});

describe("FailureDetail + BatchResult", () => {
  it("discriminates a grant_denied failure", () => {
    const f = FailureDetail.parse({ reason: "grant_denied", needed: { tier: "high" } });
    expect(f.reason).toBe("grant_denied");
    if (f.reason === "grant_denied") expect(f.needed.tier).toBe("high");
  });

  it("round-trips a batch result with a confirmation interruption", () => {
    const r = BatchResult.parse({
      status: "interrupted",
      revision: 7,
      completed: 2,
      results: [
        { target: "Email", status: "verified" },
        { target: "Submit", status: "failed", failure: { reason: "capability_required" } },
      ],
      interruption: {
        kind: "confirmation_required",
        pendingConfirmation: {
          capabilityId: "nonce-2",
          action: { op: "click", summary: "Submit to example.com", origin: "https://example.com" },
          origin: "https://example.com",
          pageRevision: 7,
          sensitiveFields: [],
          expiresAt: "2026-08-01T00:05:00.000Z",
        },
      },
    });
    expect(r.status).toBe("interrupted");
    expect(r.interruption?.pendingConfirmation?.capabilityId).toBe("nonce-2");
  });
});

describe("version", () => {
  it("exports a schema version string", () => {
    expect(typeof SCHEMA_VERSION).toBe("string");
  });
});
