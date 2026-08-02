import { describe, it, expect } from "vitest";
import { InMemorySiteMemory, verifyWidgetHint, fingerprintKey, type WidgetHint } from "./index.js";

describe("InMemorySiteMemory", () => {
  it("caches and retrieves widget hints per origin", () => {
    const mem = new InMemorySiteMemory();
    const hint: WidgetHint = { origin: "https://x.com", fingerprintKey: "combobox|Country||f/0", widgetKind: "react-select" };
    mem.putWidget(hint);
    expect(mem.getWidget("https://x.com", "combobox|Country||f/0")?.widgetKind).toBe("react-select");
    expect(mem.getWidget("https://other.com", "combobox|Country||f/0")).toBeUndefined();
  });

  it("tracks hit/miss stats and exposes all hints for contribution", () => {
    const mem = new InMemorySiteMemory();
    mem.putWidget({ origin: "https://x.com", fingerprintKey: "k", widgetKind: "radix" });
    mem.recordHit("https://x.com");
    mem.recordHit("https://x.com");
    mem.recordMiss("https://x.com");
    expect(mem.stats("https://x.com")).toEqual({ hits: 2, misses: 1 });
    expect(mem.all()).toHaveLength(1);
  });

  it("clears an origin (retroactive, for the kill switch path)", () => {
    const mem = new InMemorySiteMemory();
    mem.putWidget({ origin: "https://x.com", fingerprintKey: "k", widgetKind: "mui" });
    mem.clearOrigin("https://x.com");
    expect(mem.getWidget("https://x.com", "k")).toBeUndefined();
  });
});

describe("verifyWidgetHint (INV-3: hints are verified, lying hints fail closed)", () => {
  const hint: WidgetHint = { origin: "https://x.com", fingerprintKey: "k", widgetKind: "react-select" };
  it("accepts a hint that still matches the live page", () => {
    expect(verifyWidgetHint(hint, "react-select")).toBe(true);
  });
  it("rejects a hint that disagrees with the live page", () => {
    expect(verifyWidgetHint(hint, "mui")).toBe(false);
    expect(verifyWidgetHint(hint, undefined)).toBe(false);
  });
});

describe("fingerprintKey", () => {
  it("is stable across equal fingerprints", () => {
    const a = fingerprintKey({ role: "combobox", name: "Country", structuralFingerprint: "f/0" });
    const b = fingerprintKey({ role: "combobox", name: "Country", structuralFingerprint: "f/0" });
    expect(a).toBe(b);
  });
});
