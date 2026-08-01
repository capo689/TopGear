import type { Action, FailureDetail, NormalizedAction, RiskTier, TaskGrant } from "@browser-bridge/protocol";
import { classifyRisk, type RiskContext } from "./risk.js";
import { normalizeAction, type NormalizeContext } from "./normalize.js";
import type { CapabilityStore } from "./capability.js";

export function originAllowed(grant: TaskGrant, origin: string): boolean {
  return grant.allowedOrigins.includes(origin);
}

export function tierAllowed(grant: TaskGrant, tier: RiskTier): boolean {
  return grant.allowedRiskTiers.includes(tier);
}

export function sensitiveDestinationAllowed(grant: TaskGrant, destination: string): boolean {
  return grant.sensitiveDataDestinations.includes(destination);
}

export function grantExpired(grant: TaskGrant, now: number): boolean {
  const exp = Date.parse(grant.expiresAt);
  return Number.isFinite(exp) && now > exp;
}

/** Redacted audit note — codes and daemon reasons only, never raw values (INV-4/T7). */
export interface AuditNote {
  code: string;
  reasons: string[];
}

export type AuthorizeResult =
  | { decision: "allow"; tier: RiskTier; audit: AuditNote }
  | { decision: "deny"; tier: RiskTier; failure: FailureDetail; audit: AuditNote }
  | {
      decision: "needs_confirmation";
      tier: RiskTier;
      normalized: NormalizedAction;
      failure: FailureDetail;
      audit: AuditNote;
    };

export interface ActionExecContext {
  /** Origin the action executes against. */
  origin: string;
  /** Current time in ms (from the daemon clock). */
  now: number;
  /** Current page revision, for capability binding. */
  pageRevision: number;
  risk?: RiskContext;
  normalize?: NormalizeContext;
  /** True when this action moves sensitive-tagged values (a fill IS transmission). */
  transmitsSensitive?: boolean;
  /** Origin receiving the sensitive values, if different from `origin`. */
  sensitiveDestination?: string;
}

export interface AuthorizeInput {
  action: Action;
  grant: TaskGrant;
  ctx: ActionExecContext;
  capabilities: CapabilityStore;
  /** A capability the model re-issued alongside a previously-gated high-risk action. */
  providedCapabilityId?: string;
}

/**
 * The single authorization decision every action passes through — directly issued,
 * inside an `if`, a reflex, or a replay all hit this identically (INV-5). Order:
 * expiry → origin → exfiltration destination → tier. High risk ALWAYS requires a
 * fresh single-use confirmation capability (INV-9); low/medium are gated by the grant.
 */
export function authorize(input: AuthorizeInput): AuthorizeResult {
  const { action, grant, ctx, capabilities } = input;
  const risk = classifyRisk(action, ctx.risk);
  const tier = risk.tier;
  const baseReasons = risk.reasons;

  if (grantExpired(grant, ctx.now)) {
    return {
      decision: "deny",
      tier,
      failure: { reason: "grant_denied", needed: {} },
      audit: { code: "grant_expired", reasons: baseReasons },
    };
  }

  if (!originAllowed(grant, ctx.origin)) {
    return {
      decision: "deny",
      tier,
      failure: { reason: "grant_denied", needed: { origin: ctx.origin } },
      audit: { code: "origin_not_allowed", reasons: baseReasons },
    };
  }

  if (ctx.transmitsSensitive) {
    const destination = ctx.sensitiveDestination ?? ctx.origin;
    if (!sensitiveDestinationAllowed(grant, destination)) {
      return {
        decision: "deny",
        tier,
        failure: { reason: "grant_denied", needed: { origin: destination } },
        audit: { code: "sensitive_destination_not_allowed", reasons: baseReasons },
      };
    }
  }

  // High risk is NEVER ungated, regardless of the grant's tier ceiling (INV-9).
  if (tier === "high") {
    if (!input.providedCapabilityId) {
      const normalized = normalizeAction(action, ctx.normalize ?? { origin: ctx.origin });
      return {
        decision: "needs_confirmation",
        tier,
        normalized,
        failure: { reason: "capability_required" },
        audit: { code: "confirmation_required", reasons: baseReasons },
      };
    }
    const consumed = capabilities.consume(input.providedCapabilityId, {
      origin: ctx.origin,
      pageRevision: ctx.pageRevision,
    });
    if (!consumed.ok) {
      return {
        decision: "deny",
        tier,
        failure: { reason: "capability_invalid" },
        audit: { code: `capability_${consumed.reason}`, reasons: baseReasons },
      };
    }
    return { decision: "allow", tier, audit: { code: "capability_consumed", reasons: baseReasons } };
  }

  // Low / medium: gated by the grant's tier ceiling.
  if (!tierAllowed(grant, tier)) {
    return {
      decision: "deny",
      tier,
      failure: { reason: "grant_denied", needed: { tier } },
      audit: { code: "tier_not_allowed", reasons: baseReasons },
    };
  }

  return {
    decision: "allow",
    tier,
    audit: { code: tier === "medium" ? "allow_medium_audited" : "allow_low", reasons: baseReasons },
  };
}
