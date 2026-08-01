import { describe, it, expect } from "vitest";
import { classifyRisk } from "./risk.js";
import type { Action } from "@browser-bridge/protocol";

describe("classifyRisk", () => {
  it("escalates a high-intent labelled click to high", () => {
    const action: Action = { op: "click", target: { name: "Place order" } };
    const r = classifyRisk(action, { click: { origin: "https://shop.com", labelTokens: ["place", "order"] } });
    expect(r.tier).toBe("high");
    expect(r.reasons).toContain("high_intent_label");
  });

  it("escalates a third-party submit to high", () => {
    const action: Action = { op: "click", target: { name: "Continue" } };
    const r = classifyRisk(action, {
      click: { origin: "https://a.com", buttonSemantics: "submit", sameOriginForm: false },
    });
    expect(r.tier).toBe("high");
    expect(r.reasons).toContain("third_party_submit");
  });

  it("escalates a cross-origin POST carrying sensitive values to high (network backstop)", () => {
    const action: Action = { op: "click", target: { name: "Go" } };
    const r = classifyRisk(action, {
      click: { origin: "https://a.com", crossOriginPost: true, carriesSensitiveValues: true },
    });
    expect(r.tier).toBe("high");
  });

  it("treats a same-origin submit as medium", () => {
    const action: Action = { op: "click", target: { name: "Save" } };
    const r = classifyRisk(action, {
      click: { origin: "https://a.com", buttonSemantics: "submit", sameOriginForm: true },
    });
    expect(r.tier).toBe("medium");
  });

  it("treats a plain click as low", () => {
    const action: Action = { op: "click", target: { name: "Read more" } };
    const r = classifyRisk(action, { click: { origin: "https://a.com", buttonSemantics: "link" } });
    expect(r.tier).toBe("low");
  });

  it("treats upload as medium", () => {
    const action: Action = { op: "upload", target: { name: "Resume" }, fileToken: "f1" };
    expect(classifyRisk(action).tier).toBe("medium");
  });

  it("treats new-origin navigation as medium and same-origin as low", () => {
    const action: Action = { op: "goto", url: "https://b.com" };
    expect(classifyRisk(action, { goto: { fromOrigin: "https://a.com", toOrigin: "https://b.com" } }).tier).toBe("medium");
    expect(classifyRisk(action, { goto: { fromOrigin: "https://a.com", toOrigin: "https://a.com" } }).tier).toBe("low");
  });

  it("treats a plain fill as low and a sensitive fill as medium", () => {
    const action: Action = { op: "fill", target: { name: "Email" }, value: "a@b.com" };
    expect(classifyRisk(action).tier).toBe("low");
    expect(classifyRisk(action, { transmitsSensitive: true }).tier).toBe("medium");
  });
});
