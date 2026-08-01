/**
 * Redaction utilities. The audit log records action names, target labels, and outcomes
 * only — never raw values, secrets, cookies, or history (INV-4, T7). These helpers are
 * defense-in-depth: even though the audit event schema structurally excludes value
 * fields, any free-text that slips through is scrubbed here before it is written.
 */

export const REDACTED = "[redacted]";

/** Max length for any free-text field in an audit record. */
const MAX_TEXT = 200;

interface ScrubRule {
  pattern: RegExp;
  replacement: string;
}

const RULES: ScrubRule[] = [
  // SecretRef serialized into text: {"secretRef":"..."} or secretRef=...
  { pattern: /("?secretRef"?\s*[:=]\s*)("[^"]*"|[^\s,}]+)/gi, replacement: `$1${REDACTED}` },
  // Authorization / bearer tokens.
  { pattern: /Bearer\s+[A-Za-z0-9._\-]+/gi, replacement: `Bearer ${REDACTED}` },
  // Sensitive key=value / key: value pairs.
  {
    pattern:
      /\b(password|passwd|pwd|secret|token|api[_-]?key|authorization|auth|cookie|ssn|card(?:[_-]?number)?|cvv|pin)\b(\s*[:=]\s*)(?:"[^"]*"|\S+)/gi,
    replacement: `$1$2${REDACTED}`,
  },
];

// Long opaque blobs (tokens, base64, hex). Only redact 24+ char runs that contain a
// digit — that catches keys/tokens while sparing ordinary long words, correlation-id
// labels, and URL path segments (Fable finding #3: avoid over-redacting audit signal).
const LONG_BLOB = /\b[A-Za-z0-9+/_=-]{24,}\b/g;

/** Scrub secret-shaped substrings from a free-text field and cap its length. */
export function scrubText(input: string): string {
  let out = input;
  for (const rule of RULES) {
    out = out.replace(rule.pattern, rule.replacement);
  }
  out = out.replace(LONG_BLOB, (match) => (/\d/.test(match) ? "[redacted-token]" : match));
  if (out.length > MAX_TEXT) {
    out = out.slice(0, MAX_TEXT) + "…";
  }
  return out;
}

/** True if the text still looks like it contains a secret after scrubbing would run. */
export function looksLikeSecret(input: string): boolean {
  return RULES.some((r) => {
    r.pattern.lastIndex = 0;
    return r.pattern.test(input);
  });
}

/**
 * Placeholder for any value that must never be logged. The audit layer calls this
 * instead of ever emitting a real value.
 */
export function redactValue(_value: unknown): string {
  return REDACTED;
}
