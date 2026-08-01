import { describe, it, expect } from "vitest";
import { InMemorySecretBroker, hashValue } from "./index.js";

describe("InMemorySecretBroker", () => {
  it("resolves a ref to its value but never serializes it", () => {
    const broker = new InMemorySecretBroker();
    broker.set("kc:pw", "hunter2");
    expect(broker.resolve("kc:pw")).toBe("hunter2");
    expect(JSON.stringify({ broker })).not.toContain("hunter2");
    expect(String(broker)).toBe("[SecretBroker]");
  });

  it("exposes a hash for read-back, not the value", () => {
    const broker = new InMemorySecretBroker();
    broker.set("kc:pw", "hunter2");
    expect(broker.hash("kc:pw")).toBe(hashValue("hunter2"));
    expect(broker.hash("kc:pw")).not.toContain("hunter2");
  });

  it("reports missing refs", () => {
    const broker = new InMemorySecretBroker();
    expect(broker.has("nope")).toBe(false);
    expect(broker.resolve("nope")).toBeUndefined();
  });
});
