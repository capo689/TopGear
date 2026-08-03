import { classify, heuristicProbe, type CandidatePattern, type DataClass, type PublicOriginProbe } from "./classify.js";
import { anonymize, type ContributionRecord } from "./anonymize.js";
import { InstallIdentity } from "./identity.js";

/**
 * The M2 classification audit (plan §14 acceptance). Generates a mixed corpus of
 * public / intranet / authenticated / value-bearing patterns and verifies that ZERO
 * Class A or B data reaches a contribution record, and that contributed records carry no
 * values, no query strings, and only public origins.
 */
export function generateAuditFixtures(count: number, seedBaseMs = 1_700_000_000_000): CandidatePattern[] {
  const origins: { origin: string; auth: "unauthenticated" | "authenticated" | "unknown" }[] = [
    { origin: "https://example.com", auth: "unauthenticated" }, // → C
    { origin: "https://shop.io", auth: "unauthenticated" }, // → C
    { origin: "https://news.org", auth: "unknown" }, // public but UNKNOWN auth → B (R1 finding)
    { origin: "http://intranet.local", auth: "unauthenticated" }, // non-public → B
    { origin: "http://10.0.0.5", auth: "unknown" }, // → B
    { origin: "https://admin.internal", auth: "unauthenticated" }, // non-public → B
    { origin: "https://portal.company.com", auth: "authenticated" }, // → B
    { origin: "https://bank.com", auth: "authenticated" }, // → B
  ];
  const out: CandidatePattern[] = [];
  for (let i = 0; i < count; i++) {
    const spec = origins[i % origins.length]!;
    const withValue = i % 11 === 0; // sprinkle Class A patterns
    out.push({
      origin: spec.origin,
      url: `${spec.origin}/account/settings?token=SECRET${i}&user=alice@example.com`,
      kind: "widget",
      widgetKind: "react-select",
      fingerprint: { role: "combobox", name: "Country", autocomplete: "country" },
      observedAt: seedBaseMs + i * 3_600_000,
      authStatus: spec.auth,
      ...(withValue ? { value: `user typed value ${i}` } : {}),
    });
  }
  return out;
}

export interface AuditFinding {
  index: number;
  inputOrigin: string;
  inputUrl?: string;
  dataClass: DataClass;
  contributed: boolean;
  leak?: string;
}

export interface AuditResult {
  total: number;
  contributed: ContributionRecord[];
  findings: AuditFinding[];
  leaks: AuditFinding[];
  byClass: Record<DataClass, number>;
}

export function runClassificationAudit(patterns: CandidatePattern[], probe: PublicOriginProbe = heuristicProbe): AuditResult {
  const identity = new InstallIdentity();
  const findings: AuditFinding[] = [];
  const contributed: ContributionRecord[] = [];
  const byClass: Record<DataClass, number> = { A: 0, B: 0, C: 0 };

  patterns.forEach((pattern, index) => {
    const cls = classify(pattern, probe);
    byClass[cls.dataClass] += 1;
    const finding: AuditFinding = {
      index,
      inputOrigin: pattern.origin,
      ...(pattern.url ? { inputUrl: pattern.url } : {}),
      dataClass: cls.dataClass,
      contributed: cls.dataClass === "C",
    };

    if (cls.dataClass === "C") {
      const unsigned = anonymize(pattern, identity.installId);
      const record: ContributionRecord = { ...unsigned, publicKey: identity.publicKey, signature: identity.sign(unsigned) };
      contributed.push(record);

      // Leak checks against the SERIALIZED record.
      const serialized = JSON.stringify(record);
      if (pattern.value && serialized.includes(pattern.value)) finding.leak = "value leaked";
      else if (serialized.includes("token=") || serialized.includes("user=") || serialized.includes("alice@example.com") || record.origin.includes("?") || record.origin.includes("/account")) {
        finding.leak = "url/query leaked";
      } else if (probe.isPublic(record.origin) !== true) {
        finding.leak = "non-public origin contributed";
      } else if (/\d{2}:\d{2}/.test(serialized)) {
        finding.leak = "precise timestamp leaked";
      }
    }

    findings.push(finding);
  });

  return { total: patterns.length, contributed, findings, leaks: findings.filter((f) => f.leak), byClass };
}

/** Human-readable one-line-per-record report for a reviewer to eyeball (§ testing honesty). */
export function renderAuditReport(result: AuditResult): string {
  const lines = result.findings.map(
    (f) => `#${f.index} ${f.dataClass} ${f.contributed ? "CONTRIBUTED" : "withheld  "} ${f.inputOrigin}${f.leak ? `  ⚠ LEAK: ${f.leak}` : ""}`,
  );
  const header = `Classification audit: ${result.total} records — A:${result.byClass.A} B:${result.byClass.B} C:${result.byClass.C}, ${result.contributed.length} contributed, ${result.leaks.length} leaks`;
  return [header, ...lines].join("\n");
}
