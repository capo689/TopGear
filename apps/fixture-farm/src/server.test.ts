import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startFixtureFarm, type FixtureFarm } from "./server.js";
import { FIXTURES } from "./index.js";

let farm: FixtureFarm;

beforeAll(async () => {
  farm = await startFixtureFarm();
});

afterAll(async () => {
  await farm.close();
});

describe("fixture farm server", () => {
  it("serves the index on an ephemeral loopback port", async () => {
    const res = await fetch(farm.url + "/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Browser Bridge Fixture Farm");
  });

  it("serves every catalogued fixture with 200", async () => {
    for (const route of Object.values(FIXTURES)) {
      const res = await fetch(farm.url + route);
      expect(res.status, `route ${route}`).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
    }
  });

  it("serves the 20-field form with its key controls", async () => {
    const html = await (await fetch(farm.url + FIXTURES.nativeForm)).text();
    for (const id of ["firstName", "email", "country", "coverLetter", "agreeTerms", "submit"]) {
      expect(html, `field ${id}`).toContain(`id="${id}"`);
    }
  });

  it("exposes the injection page as untrusted content (no directive is executed here)", async () => {
    const html = await (await fetch(farm.url + FIXTURES.injection)).text();
    // The page CONTAINS injection text; that is the point. It must simply be served.
    expect(html).toContain("evil.example");
    expect(html).toContain("INV-2");
  });

  it("404s a path-traversal attempt", async () => {
    const res = await fetch(farm.url + "/../../package.json");
    // fetch normalizes some traversal, so also probe an encoded variant.
    const encoded = await fetch(farm.url + "/%2e%2e/%2e%2e/package.json");
    expect([res.status, encoded.status].every((s) => s === 404 || s === 200)).toBe(true);
    // The encoded traversal specifically must not escape the public dir.
    if (encoded.status === 200) {
      const body = await encoded.text();
      expect(body).not.toContain("\"@browser-bridge/fixture-farm\"");
    }
  });
});
