import type { Action, RiskTier } from "@browser-bridge/protocol";

/**
 * Signals about a click, supplied by the daemon from page semantics. The risk
 * classifier runs on ALL clicks (plan §10 T2 honesty requirement) because "submit"
 * cannot be perfectly distinguished from "click" — SPAs commit via fetch() from
 * arbitrary handlers. This classifier is one layer; the network backstop is another.
 */
export interface ClickContext {
  /** Origin the click executes against. */
  origin: string;
  /** Button semantics, when known. */
  buttonSemantics?: "submit" | "button" | "link" | "menuitem" | "unknown";
  /** Normalized tokens from the accessible name / nearby text. */
  labelTokens?: string[];
  /** Would this click transmit sensitive-tagged values? */
  carriesSensitiveValues?: boolean;
  /** Does the daemon observe a cross-origin POST tied to this click? */
  crossOriginPost?: boolean;
  /** Is the target form's action same-origin? */
  sameOriginForm?: boolean;
}

/** Navigation context for goto actions. */
export interface GotoContext {
  fromOrigin: string;
  toOrigin: string;
}

export interface RiskContext {
  click?: ClickContext;
  goto?: GotoContext;
  /** True when the action moves sensitive-tagged values (a fill IS transmission). */
  transmitsSensitive?: boolean;
}

export interface RiskAssessment {
  tier: RiskTier;
  /** Daemon-authored rationale tokens (never model text); feed audit + confirm UI. */
  reasons: string[];
}

/**
 * Label tokens that indicate a genuinely high-consequence action. Deliberately NOT
 * "submit"/"save"/"continue"/"confirm" — those are ordinary form controls and would
 * over-gate every same-origin form. High intent is financial, destructive, or
 * publish/send. Third-party submits are caught separately by button semantics.
 */
const HIGH_INTENT_TOKENS = new Set([
  "buy",
  "purchase",
  "pay",
  "checkout",
  "order",
  "delete",
  "remove",
  "destroy",
  "transfer",
  "wire",
  "withdraw",
  "deposit",
  "publish",
  "send",
  "donate",
  "authorize",
]);

function tokensHitHighIntent(tokens: readonly string[] | undefined): boolean {
  if (!tokens) return false;
  return tokens.some((t) => HIGH_INTENT_TOKENS.has(t.toLowerCase()));
}

function classifyClick(ctx: ClickContext): RiskAssessment {
  const reasons: string[] = [];

  // Network backstop signal: a cross-origin POST carrying sensitive values is high.
  if (ctx.crossOriginPost && ctx.carriesSensitiveValues) {
    reasons.push("cross_origin_post_with_sensitive_values");
    return { tier: "high", reasons };
  }

  const highIntent = tokensHitHighIntent(ctx.labelTokens);
  const thirdPartySubmit = ctx.buttonSemantics === "submit" && ctx.sameOriginForm === false;

  if (highIntent) reasons.push("high_intent_label");
  if (thirdPartySubmit) reasons.push("third_party_submit");

  if (highIntent || thirdPartySubmit) {
    return { tier: "high", reasons };
  }

  if (ctx.buttonSemantics === "submit") {
    // A same-origin submit is a state change but reversible-ish: medium + audit.
    reasons.push("same_origin_submit");
    return { tier: "medium", reasons };
  }

  reasons.push("plain_click");
  return { tier: "low", reasons };
}

/**
 * Classify an action into a risk tier (plan §10 T2). Conservative v0: unknown-shaped
 * clicks default low, but ANY high-intent or third-party-submit signal escalates to
 * high, and sensitive transmission is never silently allowed.
 */
export function classifyRisk(action: Action, ctx: RiskContext = {}): RiskAssessment {
  switch (action.op) {
    case "click":
      return classifyClick(ctx.click ?? { origin: "" });

    case "upload":
      return { tier: "medium", reasons: ["upload"] };

    case "goto": {
      if (ctx.goto && ctx.goto.fromOrigin !== ctx.goto.toOrigin) {
        return { tier: "medium", reasons: ["new_origin_navigation"] };
      }
      return { tier: "low", reasons: ["same_origin_navigation"] };
    }

    case "fill":
    case "check":
    case "select":
    case "set_date":
    case "search_pick": {
      // Data entry is a draft by default (low), but transmitting sensitive values is
      // medium and must clear the exfiltration destination check in the grant layer.
      if (ctx.transmitsSensitive) return { tier: "medium", reasons: ["sensitive_value_entry"] };
      return { tier: "low", reasons: ["data_entry"] };
    }

    case "press":
    case "scroll":
    case "expand":
    case "open_menu_path":
    case "goto_intent":
    case "wait":
    case "if":
      return { tier: "low", reasons: ["structural"] };

    default: {
      // Exhaustiveness guard: a new op must be classified deliberately, not defaulted.
      const _never: never = action;
      void _never;
      return { tier: "high", reasons: ["unclassified_op"] };
    }
  }
}
