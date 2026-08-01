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

  it("hard-404s a path-traversal attempt and never serves a file outside public/", async () => {
    // fetch() normalizes "/../.." client-side, so also probe an encoded variant that
    // reaches the server verbatim. Both MUST 404 — a 200 here would mean escape.
    const plain = await fetch(farm.url + "/../../package.json");
    const encoded = await fetch(farm.url + "/%2e%2e/%2e%2e/package.json");
    expect(plain.status).toBe(404);
    expect(encoded.status).toBe(404);
  });
});
