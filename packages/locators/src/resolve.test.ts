import { describe, it, expect } from "vitest";
import { resolveLocator, reresolveFingerprint } from "./resolve.js";
import type { RawElement, RawView } from "@browser-bridge/semantic-engine";

function el(ref: string, role: string, name: string, extra: Partial<RawElement> = {}): RawElement {
  return {
    ref,
    role,
    tag: "input",
    name,
    fingerprint: {
      role,
      name,
      structuralFingerprint: `form/${ref}`,
      ...(extra.fingerprint ?? {}),
    },
    ...extra,
  };
}

function view(elements: RawElement[]): RawView {
  return { url: "https://x", origin: "https://x", title: "", loading: "idle", elements, forms: [], alerts: [], signature: "" };
}

describe("resolveLocator", () => {
  const v = view([el("e1", "textbox", "Email"), el("e2", "textbox", "Company"), el("e3", "button", "Submit")]);

  it("takes the fast path when the ref is still present", () => {
    const r = resolveLocator({ ref: "e2" }, v);
    expect(r.status).toBe("resolved");
    if (r.status === "resolved") expect(r.confidence).toBe(1);
  });

  it("resolves by role + name", () => {
    const r = resolveLocator({ role: "textbox", name: "Email" }, v);
    expect(r.status).toBe("resolved");
    if (r.status === "resolved") expect(r.ref).toBe("e1");
  });

  it("returns not_found when nothing matches", () => {
    expect(resolveLocator({ name: "Nonexistent" }, v).status).toBe("not_found");
  });

  it("falls through to scoring when the ref is stale but the name still matches", () => {
    const r = resolveLocator({ ref: "gone", name: "Company" }, v);
    expect(r.status).toBe("resolved");
    if (r.status === "resolved") expect(r.ref).toBe("e2");
  });

  it("returns an ambiguity band when two candidates score within the gap", () => {
    const ambiguous = view([el("a", "button", "Delete"), el("b", "button", "Delete")]);
    const r = resolveLocator({ role: "button", name: "Delete" }, ambiguous);
    expect(r.status).toBe("ambiguous");
    if (r.status === "ambiguous") expect(r.candidates).toHaveLength(2);
  });
});

describe("reresolveFingerprint — rerender survival", () => {
  it("re-resolves by fingerprint after the node is replaced and its structure changed", () => {
    const original = el("old", "textbox", "Email", {
      fingerprint: { role: "textbox", name: "Email", stableAttributes: { id: "email" }, structuralFingerprint: "form/0/1" },
    });

    // The page rerendered: a NEW ref, a different structural position, same identity.
    const rerendered = view([
      el("new", "textbox", "Email", {
        fingerprint: { role: "textbox", name: "Email", stableAttributes: { id: "email" }, structuralFingerprint: "wrapper/2/0/1" },
      }),
      el("x", "button", "Submit"),
    ]);

    const r = reresolveFingerprint(original.fingerprint, rerendered);
    expect(r.status).toBe("resolved");
    if (r.status === "resolved") expect(r.ref).toBe("new");
  });
});
