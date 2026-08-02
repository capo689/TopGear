import { describe, it, expect } from "vitest";
import { parseRobots, robotsAllows, CrawlPolicy } from "./crawl.js";

describe("robots", () => {
  it("parses User-agent:* Disallow rules and matches by prefix", () => {
    const rules = parseRobots("User-agent: *\nDisallow: /harvest/secret\nDisallow: /private\n");
    expect(rules.disallow).toEqual(["/harvest/secret", "/private"]);
    expect(robotsAllows(rules, "/harvest/1")).toBe(true);
    expect(robotsAllows(rules, "/harvest/secret")).toBe(false);
    expect(robotsAllows(rules, "/private/x")).toBe(false);
  });
});

describe("CrawlPolicy", () => {
  const policy = new CrawlPolicy({
    allowedOrigins: ["https://ok.example"],
    robots: parseRobots("User-agent: *\nDisallow: /secret\n"),
  });

  it("allows an in-grant, robots-permitted URL", () => {
    expect(policy.check("https://ok.example/page").allowed).toBe(true);
  });
  it("refuses an origin outside the grant (covers auth walls)", () => {
    const d = policy.check("https://other.example/page");
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe("origin_not_in_grant");
  });
  it("refuses a robots-disallowed path", () => {
    const d = policy.check("https://ok.example/secret/x");
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe("robots_disallow");
  });
});
