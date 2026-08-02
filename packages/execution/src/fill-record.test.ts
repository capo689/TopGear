import { describe, it, expect } from "vitest";
import { matchField, tokenize } from "./fill-record.js";
import type { RawElement } from "@browser-bridge/semantic-engine";

function el(ref: string, role: string, name: string, autocomplete?: string): RawElement {
  return {
    ref,
    role,
    tag: role === "checkbox" ? "input" : "input",
    name,
    fingerprint: { role, name, ...(autocomplete ? { autocomplete } : {}) },
  };
}

describe("tokenize", () => {
  it("splits camelCase and punctuation", () => {
    expect(tokenize("firstName")).toEqual(["first", "name"]);
    expect(tokenize("Postal code")).toEqual(["postal", "code"]);
  });
});

describe("matchField (deterministic, no model)", () => {
  const fields = [el("e1", "textbox", "First name", "given-name"), el("e2", "textbox", "Email", "email"), el("e3", "textbox", "Company")];

  it("matches a camelCase key to the right field", () => {
    const m = matchField("firstName", "Ada", fields);
    expect(m.status).toBe("matched");
    expect(m.element?.ref).toBe("e1");
  });

  it("matches by autocomplete token", () => {
    const m = matchField("email", "a@b.com", fields);
    expect(m.status).toBe("matched");
    expect(m.element?.ref).toBe("e2");
  });

  it("reports unmatched when nothing scores", () => {
    expect(matchField("astrologicalSign", "Leo", fields).status).toBe("unmatched");
  });

  it("surfaces ambiguity when two fields share a label", () => {
    const dup = [el("a", "textbox", "Phone"), el("b", "textbox", "Phone")];
    const m = matchField("phone", "555", dup);
    expect(m.status).toBe("ambiguous");
    expect(m.candidates).toHaveLength(2);
  });

  it("routes a boolean value only to checkbox/radio", () => {
    const mixed = [el("t", "textbox", "Remote"), el("c", "checkbox", "Remote")];
    const m = matchField("remote", true, mixed);
    expect(m.status).toBe("matched");
    expect(m.element?.ref).toBe("c");
  });
});
