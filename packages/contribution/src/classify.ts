/**
 * Data classification (INV-6). Class A (user content) and Class B (non-public
 * structure) NEVER leave the machine. Only Class C (public structure) is contributed.
 * When public status is uncertain we classify DOWN to B — when unsure, don't contribute.
 */

export type DataClass = "A" | "B" | "C";

/** A structural pattern extracted from site memory. By construction it should carry NO
 * user values — but a stray value is defense-in-depth classified Class A and discarded. */
export interface CandidatePattern {
  origin: string;
  /** Full URL (may carry a query string) — stripped before any contribution. */
  url?: string;
  kind: "widget" | "form-field-map" | "locator" | "link-graph" | "feed";
  widgetKind?: string;
  fingerprint?: {
    role?: string;
    name?: string;
    testId?: string;
    autocomplete?: string;
    inputType?: string;
  };
  /** Epoch ms — coarsened to a day before contribution. */
  observedAt: number;
  /** MUST be absent for a real pattern; if present, this is Class A user content. */
  value?: string;
  /** True if the origin was reached under authentication → Class B. */
  authenticated?: boolean;
}

export interface ClassificationResult {
  dataClass: DataClass;
  reason: string;
}

export interface PublicOriginProbe {
  isPublic(origin: string): boolean | "unknown";
}

const PRIVATE_SUFFIXES = [".local", ".internal", ".lan", ".corp", ".intranet", ".home", ".test", ".localhost"];
const KNOWN_PUBLIC_TLDS = new Set([
  "com", "org", "net", "io", "dev", "app", "co", "gov", "edu", "mil", "info", "biz",
  "uk", "us", "ca", "de", "fr", "jp", "au", "nl", "se", "no", "es", "it", "ai",
]);

function isPrivateHost(host: string): boolean {
  if (host === "localhost") return true;
  if (PRIVATE_SUFFIXES.some((s) => host.endsWith(s))) return true;
  if (!host.includes(".")) return true; // single-label / intranet hostname
  // RFC1918 + loopback IP literals.
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  return false;
}

/**
 * Heuristic prober (no network): private/intranet → not public; a recognizable public
 * TLD → public; anything else → unknown (which classifies DOWN to B). §16 decision 6.
 */
export const heuristicProbe: PublicOriginProbe = {
  isPublic(origin: string): boolean | "unknown" {
    let host: string;
    try {
      host = new URL(origin).hostname.toLowerCase();
    } catch {
      return "unknown";
    }
    if (isPrivateHost(host)) return false;
    const tld = host.split(".").pop() ?? "";
    if (KNOWN_PUBLIC_TLDS.has(tld)) return true;
    return "unknown";
  },
};

export function classify(pattern: CandidatePattern, probe: PublicOriginProbe = heuristicProbe): ClassificationResult {
  // Class A — any user value present. Defense-in-depth: never contribute values.
  if (pattern.value !== undefined && pattern.value !== "") {
    return { dataClass: "A", reason: "carries a user value" };
  }
  // Class B — authenticated / non-public origin structure.
  if (pattern.authenticated) {
    return { dataClass: "B", reason: "authenticated origin" };
  }
  const pub = probe.isPublic(pattern.origin);
  if (pub === true) return { dataClass: "C", reason: "public-origin structure" };
  if (pub === false) return { dataClass: "B", reason: "non-public origin" };
  return { dataClass: "B", reason: "public status unknown — classified down" };
}
