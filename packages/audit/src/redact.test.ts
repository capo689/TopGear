import { describe, it, expect } from "vitest";
import { scrubText, looksLikeSecret, redactValue, REDACTED } from "./redact.js";

describe("scrubText", () => {
  it("redacts a serialized SecretRef", () => {
    const out = scrubText('using {"secretRef":"kc:password"} now');
    expect(out).not.toContain("kc:password");
    expect(out).toContain(REDACTED);
  });

  it("redacts sensitive key=value pairs", () => {
    const out = scrubText("password=hunter2 and pin: 4321");
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("4321");
  });

  it("redacts bearer tokens", () => {
    const out = scrubText("Authorization: Bearer abc.def.ghijklmnop");
    expect(out).not.toContain("abc.def.ghijklmnop");
  });

  it("redacts long opaque blobs", () => {
    const token = "A1b2C3d4E5f6G7h8I9j0K1l2M3n4"; // 28 chars
    const out = scrubText(`token is ${token}`);
    expect(out).not.toContain(token);
    expect(out).toContain("[redacted-token]");
  });

  it("leaves ordinary labels intact", () => {
    expect(scrubText("Submit application")).toBe("Submit application");
  });
});

describe("looksLikeSecret", () => {
  it("flags secret-shaped text and clears ordinary text", () => {
    expect(looksLikeSecret("password=hunter2")).toBe(true);
    expect(looksLikeSecret("Read more")).toBe(false);
  });
});

describe("redactValue", () => {
  it("always returns the redaction placeholder", () => {
    expect(redactValue("anything")).toBe(REDACTED);
    expect(redactValue({ secretRef: "kc:x" })).toBe(REDACTED);
  });
});
