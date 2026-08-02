import { describe, it, expect } from "vitest";
import { generateAuditFixtures, runClassificationAudit, renderAuditReport } from "./audit.js";

/**
 * The M2 R1 gate: 100 contribution records from mixed public/intranet/authenticated
 * fixtures, ZERO Class A/B leakage. This is the classification audit from plan §14.
 */
describe("classification audit (R1 gate)", () => {
  const fixtures = generateAuditFixtures(100);
  const result = runClassificationAudit(fixtures);

  it("inspects 100 records", () => {
    expect(result.total).toBe(100);
  });

  it("leaks ZERO Class A/B data into contributions", () => {
    // If this ever fails, the human-readable report shows exactly which record leaked.
    expect(result.leaks, renderAuditReport(result)).toHaveLength(0);
  });

  it("actually filtered — some records were withheld as Class A and Class B", () => {
    expect(result.byClass.A).toBeGreaterThan(0);
    expect(result.byClass.B).toBeGreaterThan(0);
    expect(result.byClass.C).toBeGreaterThan(0);
    expect(result.contributed.length).toBe(result.byClass.C);
  });

  it("contributed records carry only public origins, no values, no query, day-granular", () => {
    for (const rec of result.contributed) {
      const s = JSON.stringify(rec);
      expect(s).not.toContain("token=");
      expect(s).not.toContain("alice@example.com");
      expect(s).not.toContain("user typed value");
      expect(rec.origin).not.toContain("?");
      expect(rec.origin).not.toContain("/account");
      expect(rec.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("withholds a PUBLIC origin whose auth status is unknown (R1 finding)", () => {
    // news.org is a public TLD but its auth status is unknown → must never be contributed.
    expect(result.contributed.some((r) => r.origin === "https://news.org")).toBe(false);
  });

  it("produces a human-readable report for the reviewer", () => {
    const report = renderAuditReport(result);
    expect(report).toContain("Classification audit: 100 records");
    expect(report).toContain("0 leaks");
  });
});
