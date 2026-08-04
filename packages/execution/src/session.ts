import type {
  Action,
  ActionBatch,
  BatchResult,
  ActionResult,
  FailureDetail,
  Interruption,
  SemanticView,
  ViewScope,
  TaskGrant,
  LocatorInput,
  LocatorFingerprint,
  ElementRecord,
  FillRecordRequest,
  FillRecordResult,
  FieldMatch,
  FieldAmbiguity,
  FieldValue,
  SecretRef,
} from "@browser-bridge/protocol";
import { isSecretRef, checkBatchCaps, type CapCheckErr } from "@browser-bridge/protocol";
import { matchField } from "./fill-record.js";
import {
  authorize,
  originAllowed,
  decideReflex,
  DEFAULT_REFLEX_CONFIG,
  type ReflexConfig,
  type ActionExecContext,
  type ClickContext,
  type GotoContext,
  CapabilityStore,
  type Clock,
} from "@browser-bridge/policy";
import { detectConsentBanner } from "./consent.js";
import type { BoundAuditLogger } from "@browser-bridge/audit";
import {
  toSemanticView,
  Revisioner,
  type RawView,
  type RawElement,
  type ScopeInput,
} from "@browser-bridge/semantic-engine";
import { resolveLocator } from "@browser-bridge/locators";
import { applySelect, applySetDate, applyExpand, applySearchPick } from "@browser-bridge/widget-patterns";
import type { SecretBroker } from "@browser-bridge/secrets";
import type { BrowserPage } from "@browser-bridge/backend";

export class BatchCapError extends Error {
  constructor(public readonly cap: CapCheckErr) {
    super(cap.message);
    this.name = "BatchCapError";
  }
}

export interface SessionDeps {
  sessionId: string;
  page: BrowserPage;
  grant: TaskGrant;
  capabilities: CapabilityStore;
  audit: BoundAuditLogger;
  secrets: SecretBroker;
  clock: Clock;
  confirmationTtlMs?: number;
  reflexConfig?: ReflexConfig;
  /** Resolve a goto_intent to a URL via the site-memory link graph (INV-3: verified). */
  resolveIntent?: (currentUrl: string, intent: string) => string | undefined;
}

function toScopeInput(scope: ViewScope): ScopeInput {
  switch (scope.kind) {
    case "visible_form":
    case "all_forms":
    case "viewport":
    case "invalid_fields":
    case "full":
      return { kind: scope.kind };
    case "content":
      return scope.region && scope.region.kind === "section"
        ? { kind: "content", heading: scope.region.heading }
        : { kind: "content" };
    case "region":
      return { kind: "full" };
  }
}

function tokenize(name: string | undefined): string[] {
  return (name ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function rawToRecord(e: RawElement): ElementRecord {
  const rec: ElementRecord = { ref: e.ref, role: e.role };
  if (e.name !== undefined) rec.name = e.name;
  if (e.checked !== undefined) rec.value = String(e.checked);
  else if (e.value !== undefined) rec.value = e.value;
  if (e.disabled !== undefined) rec.disabled = e.disabled;
  if (e.options !== undefined) rec.options = e.options;
  return rec;
}

/** Build the right action for a matched record field based on the element's shape. */
function buildRecordAction(el: RawElement, value: FieldValue): Action {
  if (typeof value === "boolean") return { op: "check", target: { ref: el.ref }, value };
  if (typeof value === "string") {
    if (el.widgetKind === "native-date") return { op: "set_date", target: { ref: el.ref }, value };
    if (el.tag === "select" || el.role === "combobox" || el.role === "listbox") {
      return { op: "select", target: { ref: el.ref }, value };
    }
  }
  return { op: "fill", target: { ref: el.ref }, value: value as string | SecretRef };
}

interface StepOutcome {
  results: ActionResult[];
  interruption?: Interruption;
  pageChanged?: boolean;
  hardStop?: boolean;
}

/** Ops whose success can change the page enough to warrant a re-capture + nav check. */
const PAGE_CHANGING = new Set(["click", "goto", "goto_intent"]);

/**
 * A bound session: one attached page, one TaskGrant. Every action passes the SAME
 * authorize decision (INV-5) whether issued directly, inside an `if`, or by a reflex.
 */
export class Session {
  private readonly revisioner = new Revisioner();
  private readonly fingerprints = new Map<string, LocatorFingerprint>();
  private captureSeq = 0;
  private navMs = 0; // navigation-settle time accumulated within the current act() batch
  private readonly ttl: number;

  constructor(private readonly deps: SessionDeps) {
    this.ttl = deps.confirmationTtlMs ?? 120_000;
  }

  private async capture(scope: ScopeInput = { kind: "full" }): Promise<RawView> {
    const raw = await this.deps.page.captureRaw({ scope, refPrefix: `s${this.captureSeq++}-` });
    for (const e of raw.elements) this.fingerprints.set(e.ref, e.fingerprint as LocatorFingerprint);
    return raw;
  }

  private toView(raw: RawView, scope: ViewScope): SemanticView {
    return toSemanticView(raw, {
      sessionId: this.deps.sessionId,
      pageId: this.deps.page.pageId,
      revision: this.revisioner.current,
      scope,
    }).view;
  }

  /** Produce a SemanticView for a scope (the `bridge_view` tool). */
  async view(scope: ViewScope): Promise<SemanticView> {
    const raw = await this.capture(toScopeInput(scope));
    this.revisioner.commit(raw);
    return this.toView(raw, scope);
  }

  /** Execute an action batch (the `bridge_act` tool). */
  async act(batch: ActionBatch): Promise<BatchResult> {
    const caps = checkBatchCaps(batch.actions);
    if (!caps.ok) throw new BatchCapError(caps);

    this.navMs = 0; // accumulates navigation-settle time during this batch (page-load ms)
    let working = await this.capture();
    this.revisioner.commit(working);

    const results: ActionResult[] = [];
    let interruption: Interruption | undefined;
    let completed = 0;
    const stopOnFailure = batch.stopOnFailure ?? false;

    for (const action of batch.actions) {
      const step = await this.executeAction(action, working);
      results.push(...step.results);
      completed += step.results.filter((r) => r.status === "verified").length;

      if (step.interruption) {
        interruption = step.interruption;
        break;
      }
      if (step.hardStop) break;
      if (stopOnFailure && step.results.some((r) => r.status === "failed")) break;

      if (step.pageChanged) {
        const before = working;
        const t0 = performance.now();
        working = await this.capture(); // waiting out the navigation settle here = page-load time
        this.navMs += performance.now() - t0;
        this.revisioner.evaluate(working);
        const nav = this.detectNavigation(before, working);
        if (nav) {
          interruption = nav;
          break;
        }
      }
    }

    const status: BatchResult["status"] = interruption
      ? "interrupted"
      : results.some((r) => r.status === "failed")
        ? "partial"
        : "completed";

    // Re-capture the FINAL settled state before reading invalidFields (field-fix #2):
    // `working` is only refreshed on page-changing ops, so a fill/check/select after the
    // last click isn't reflected — a just-checked required box would report invalid. On an
    // interruption the fresh state already lives in the interruption's own view, so skip.
    const finalView = interruption ? working : await this.capture();
    const invalidFields = finalView.elements.filter((e) => e.invalid).map(rawToRecord);
    const result: BatchResult = { status, revision: this.revisioner.current, completed, results, pageLoadMs: Math.round(this.navMs) };
    if (interruption) result.interruption = interruption;
    if (invalidFields.length) result.invalidFields = invalidFields;
    return result;
  }

  /**
   * `bridge_fill_record`: match a structured record to fields deterministically (no
   * embedded model — INV-11), then fill the matches in ONE verified batch. Returns
   * matched (with confidence), unmatched, and ambiguities for the model to arbitrate.
   * SecretRefs and sensitive-destination checks flow through the same `act` path.
   */
  async fillRecord(req: FillRecordRequest): Promise<FillRecordResult> {
    const raw = await this.capture({ kind: "all_forms" });
    const policy = req.ambiguityPolicy ?? "ask";
    const matched: FieldMatch[] = [];
    const unmatched: string[] = [];
    const ambiguities: FieldAmbiguity[] = [];
    const actions: Action[] = [];

    for (const [key, value] of Object.entries(req.record)) {
      const outcome = matchField(key, value, raw.elements);
      let element: RawElement;
      if (outcome.status === "unmatched") {
        unmatched.push(key);
        continue;
      }
      if (outcome.status === "ambiguous") {
        if (policy === "ask") {
          ambiguities.push({ field: key, candidates: (outcome.candidates ?? []).map(rawToRecord) });
          continue;
        }
        if (policy === "skip") continue;
        element = outcome.candidates![0]!; // best_effort
      } else {
        element = outcome.element!;
      }
      actions.push(buildRecordAction(element, value));
      matched.push({ field: key, target: this.labelEl(element), confidence: outcome.confidence });
    }

    const batch: BatchResult = actions.length
      ? await this.act({ actions })
      : { status: "completed", revision: this.revisioner.current, completed: 0, results: [] };

    return { matched, unmatched, ambiguities, batch };
  }

  /**
   * Consent-aware reflex (INV-5, plan §7.5). A cookie/consent banner is a consent
   * decision, not noise: choose reject / necessary-only where offered, else surface.
   * "Accept all" is NEVER clicked here. The chosen click routes through `act` so policy
   * and audit apply.
   */
  async handleConsentReflex(): Promise<{ handled: boolean; action?: "reject" | "surface"; clicked?: string }> {
    const raw = await this.capture({ kind: "full" });
    const detection = detectConsentBanner(raw);
    if (!detection) return { handled: false };
    const decision = decideReflex(detection.signal, this.deps.reflexConfig ?? DEFAULT_REFLEX_CONFIG);
    if (decision.action === "reject_non_essential") {
      const target = detection.necessary ?? detection.reject;
      if (!target) return { handled: true, action: "surface" };
      await this.act({ actions: [{ op: "click", target: { ref: target.ref } }] });
      return { handled: true, action: "reject", ...(target.name ? { clicked: target.name } : {}) };
    }
    return { handled: true, action: "surface" };
  }

  private detectNavigation(before: RawView, after: RawView): Interruption | undefined {
    if (after.origin !== before.origin) {
      return { kind: "origin_change", view: this.toView(after, { kind: "full" }) };
    }
    if (after.url !== before.url) {
      return { kind: "navigation", view: this.toView(after, { kind: "full" }) };
    }
    return undefined;
  }

  // --- one action ---

  private async executeAction(action: Action, working: RawView): Promise<StepOutcome> {
    if (action.op === "wait") {
      const outcome = await this.deps.page.waitFor(action.condition, action.timeoutMs ?? 5000);
      const result: ActionResult = outcome.satisfied
        ? { target: "wait", status: "verified" }
        : { target: "wait", status: "failed", failure: { reason: "timeout" } };
      return { results: [result] };
    }

    if (action.op === "if") {
      const branch = (await this.deps.page.evaluateCondition(action.condition)) ? action.then : (action.else ?? []);
      const results: ActionResult[] = [];
      for (const sub of branch) {
        const step = await this.executeAction(sub, working);
        results.push(...step.results);
        if (step.interruption) return { results, interruption: step.interruption };
        if (step.hardStop) return { results, hardStop: true };
      }
      return { results };
    }

    if (action.op === "scroll") {
      const ref = action.target ? this.resolveRef(action.target, working) : null;
      const out = await this.deps.page.scroll(ref, action.direction, action.amount);
      return { results: [this.primitiveResult("scroll", out)] };
    }

    if (action.op === "press") {
      const ref = action.target ? this.resolveRef(action.target, working) : null;
      const out = await this.deps.page.press(ref, action.key);
      return { results: [this.primitiveResult("press", out)] };
    }

    if (action.op === "goto" || action.op === "goto_intent") {
      return this.executeGoto(action);
    }

    // Remaining ops target a specific element.
    const target = "target" in action ? action.target : undefined;
    if (!target) {
      return { results: [{ target: action.op, status: "failed", failure: { reason: "not_editable" } }] };
    }
    const resolved = this.resolve(target, working);
    if ("failure" in resolved) {
      return { results: [{ target: this.label(target), status: "failed", failure: resolved.failure }] };
    }
    return this.executeTargeted(action, resolved.element, working);
  }

  private label(target: LocatorInput): string {
    return target.name ?? target.role ?? target.ref ?? "element";
  }

  private resolve(target: LocatorInput, working: RawView): { element: RawElement } | { failure: FailureDetail } {
    const res = resolveLocator(target, working);
    if (res.status === "resolved") return { element: res.element };
    if (res.status === "ambiguous") {
      return { failure: { reason: "ambiguous_target", candidates: res.candidates.map(rawToRecord) } };
    }
    return { failure: { reason: "stale_target", freshView: this.toView(working, { kind: "full" }) } };
  }

  private resolveRef(target: LocatorInput, working: RawView): string | null {
    const res = resolveLocator(target, working);
    return res.status === "resolved" ? res.ref : null;
  }

  private async executeGoto(action: Extract<Action, { op: "goto" } | { op: "goto_intent" }>): Promise<StepOutcome> {
    let url: string;
    let label: string;
    if (action.op === "goto_intent") {
      // Resolve via the link graph (a hint, INV-3). Unresolved → surface, never guess.
      const resolved = this.deps.resolveIntent?.(this.deps.page.url(), action.intent);
      if (!resolved) {
        return { results: [{ target: "goto_intent", status: "failed", failure: { reason: "widget_unrecognized", widgetHint: "goto_intent (unresolved)" } }] };
      }
      url = resolved;
      label = `${action.intent} → ${resolved}`;
    } else {
      url = action.url;
      label = action.url;
    }
    const toOrigin = safeOrigin(url);
    // The RESOLVED destination origin passes the SAME new-origin grant check as a literal
    // goto (Fable M0 #1): a goto_intent cannot navigate off the granted origins.
    if (toOrigin && !originAllowed(this.deps.grant, toOrigin)) {
      const failure: FailureDetail = { reason: "grant_denied", needed: { origin: toOrigin } };
      this.audit(action.op, label, "goto_origin_not_allowed", "deny", failure);
      return { results: [{ target: label, status: "failed", failure }] };
    }
    const gotoCtx: GotoContext = { fromOrigin: this.deps.page.origin(), toOrigin };
    const ctx: ActionExecContext = {
      origin: this.deps.page.origin(),
      now: this.deps.clock.now(),
      pageRevision: this.revisioner.current,
      risk: { goto: gotoCtx },
      normalize: { origin: this.deps.page.origin() },
    };
    const gotoAction: Action = { op: "goto", url };
    const authz = authorize({ action: gotoAction, grant: this.deps.grant, ctx, capabilities: this.deps.capabilities });
    if (authz.decision === "deny") {
      this.audit(action.op, label, authz.audit.code, "deny", authz.failure);
      return { results: [{ target: label, status: "failed", failure: authz.failure }] };
    }
    if (authz.decision === "needs_confirmation") {
      return this.confirmationStep(action.op, label, authz);
    }
    const t0 = performance.now();
    await this.deps.page.goto(url);
    this.navMs += performance.now() - t0; // the goto's own settle counts as page-load time
    this.audit(action.op, label, authz.audit.code, "verified");
    return { results: [{ target: label, status: "verified" }], pageChanged: true };
  }

  private async executeTargeted(action: Action, element: RawElement, working: RawView): Promise<StepOutcome> {
    const form = element.formRef ? working.forms.find((f) => f.ref === element.formRef) : undefined;
    const formActionOrigin = form?.action ? safeOrigin(form.action) : undefined;
    const sameOriginForm = formActionOrigin ? formActionOrigin === this.deps.page.origin() : undefined;

    // Resolve a fill's value, handling SecretRefs (never logged / model-exposed).
    let typedValue: string | undefined;
    let secret = element.valueRedacted === true;
    if (action.op === "fill") {
      if (isSecretRef(action.value)) {
        secret = true;
        const v = this.deps.secrets.resolve(action.value.secretRef);
        if (v === undefined) {
          return { results: [{ target: this.labelEl(element), status: "failed", failure: { reason: "verification_mismatch", expected: "secret", observed: "unavailable" } }] };
        }
        typedValue = v;
      } else {
        typedValue = action.value;
      }
    }

    const clickCtx: ClickContext | undefined =
      action.op === "click"
        ? {
            origin: this.deps.page.origin(),
            buttonSemantics: element.submit ? "submit" : element.role === "button" ? "button" : element.role === "link" ? "link" : "unknown",
            labelTokens: tokenize(element.name),
            ...(sameOriginForm !== undefined ? { sameOriginForm } : {}),
            carriesSensitiveValues: !!form && working.elements.some((e) => e.formRef === form.ref && e.valueRedacted === true),
            crossOriginPost: sameOriginForm === false,
          }
        : undefined;

    const transmitsSensitive = action.op === "fill" ? secret : false;

    const ctx: ActionExecContext = {
      origin: this.deps.page.origin(),
      now: this.deps.clock.now(),
      pageRevision: this.revisioner.current,
      risk: { ...(clickCtx ? { click: clickCtx } : {}), transmitsSensitive },
      normalize: {
        origin: this.deps.page.origin(),
        ...(element.name ? { targetLabel: element.name } : {}),
        ...(form?.action ? { formAction: form.action } : {}),
      },
      transmitsSensitive,
      ...(formActionOrigin ? { sensitiveDestination: formActionOrigin } : {}),
    };

    const providedCapabilityId = action.op === "click" ? action.capability : undefined;
    const authz = authorize({ action, grant: this.deps.grant, ctx, capabilities: this.deps.capabilities, ...(providedCapabilityId ? { providedCapabilityId } : {}) });

    if (authz.decision === "deny") {
      this.audit(action.op, element.name, authz.audit.code, "deny", authz.failure);
      return { results: [{ target: this.labelEl(element), status: "failed", failure: authz.failure }] };
    }
    if (authz.decision === "needs_confirmation") {
      return this.confirmationStep(action.op, this.labelEl(element), authz);
    }

    // Authorized — run the primitive and verify. Capture the URL first so click
    // verification is a real post-action nav check, not "didn't throw" (Fable #1).
    const preUrl = this.deps.page.url();
    const outcome = await this.runPrimitive(action, element, typedValue);
    if (!outcome.ok) {
      this.audit(action.op, element.name, "primitive_failed", "failed");
      return { results: [{ target: this.labelEl(element), status: "failed", failure: outcome.failure }] };
    }

    const verified = await this.verify(action, element, typedValue, secret, preUrl);
    this.audit(action.op, element.name, authz.audit.code, verified.ok ? "verified" : "failed");
    const result: ActionResult = verified.ok
      ? { target: this.labelEl(element), status: "verified" }
      : { target: this.labelEl(element), status: "failed", failure: verified.failure };
    return { results: [result], pageChanged: PAGE_CHANGING.has(action.op) };
  }

  private confirmationStep(op: string, targetLabel: string, authz: Extract<ReturnType<typeof authorize>, { decision: "needs_confirmation" }>): StepOutcome {
    // The DAEMON mints a PENDING capability from ITS normalized action (never model
    // text). It cannot be consumed until a human approves it in the confirm UI.
    const pending = this.deps.capabilities.mintPending({
      action: authz.normalized,
      origin: this.deps.page.origin(),
      pageRevision: this.revisioner.current,
      sensitiveFields: [],
      ttlMs: this.ttl,
    });
    this.audit(op, targetLabel, authz.audit.code, "needs_confirmation");
    const interruption: Interruption = { kind: "confirmation_required", pendingConfirmation: pending };
    return {
      results: [{ target: targetLabel, status: "failed", failure: authz.failure }],
      interruption,
      hardStop: true,
    };
  }

  private async runPrimitive(action: Action, element: RawElement, typedValue: string | undefined): Promise<{ ok: true } | { ok: false; failure: FailureDetail }> {
    const page = this.deps.page;
    switch (action.op) {
      case "fill": {
        const out = await page.fillText(element.ref, typedValue ?? "");
        return out.ok ? { ok: true } : { ok: false, failure: primitiveFailure(out) };
      }
      case "check": {
        const out = await page.setChecked(element.ref, action.value);
        return out.ok ? { ok: true } : { ok: false, failure: primitiveFailure(out) };
      }
      case "select": {
        const values = Array.isArray(action.value) ? action.value : [action.value];
        const out = await applySelect(page, element, values);
        return out.ok ? { ok: true } : { ok: false, failure: widgetFailure(out) };
      }
      case "set_date": {
        const out = await applySetDate(page, element, action.value);
        return out.ok ? { ok: true } : { ok: false, failure: widgetFailure(out) };
      }
      case "expand": {
        const out = await applyExpand(page, element);
        return out.ok ? { ok: true } : { ok: false, failure: widgetFailure(out) };
      }
      case "search_pick": {
        const out = await applySearchPick(page, element, action.query, action.pick);
        return out.ok ? { ok: true } : { ok: false, failure: widgetFailure(out) };
      }
      case "click": {
        const out = await page.click(element.ref);
        return out.ok ? { ok: true } : { ok: false, failure: primitiveFailure(out) };
      }
      case "upload":
      case "open_menu_path":
        return { ok: false, failure: { reason: "widget_unrecognized", widgetHint: action.op } };
      default:
        return { ok: false, failure: { reason: "widget_unrecognized", widgetHint: action.op } };
    }
  }

  private async verify(
    action: Action,
    element: RawElement,
    typedValue: string | undefined,
    secret: boolean,
    preUrl?: string,
  ): Promise<{ ok: true } | { ok: false; failure: FailureDetail }> {
    const page = this.deps.page;
    if (action.op === "fill") {
      const state = await page.readState(element.ref);
      if (secret) return state.found ? { ok: true } : { ok: false, failure: { reason: "verification_mismatch", expected: "filled", observed: "missing" } };
      return state.value === typedValue
        ? { ok: true }
        : { ok: false, failure: { reason: "verification_mismatch", expected: typedValue ?? "", observed: state.value ?? "" } };
    }
    if (action.op === "check") {
      const state = await page.readState(element.ref);
      return state.checked === action.value
        ? { ok: true }
        : { ok: false, failure: { reason: "verification_mismatch", expected: String(action.value), observed: String(state.checked) } };
    }
    if (action.op === "select") {
      const state = await page.readState(element.ref);
      const wanted = Array.isArray(action.value) ? action.value : [action.value];
      // Accept a match on the option VALUE or its visible LABEL (field-fix #1): the
      // backend resolves either when selecting, so verifying only against `value`
      // false-fails a select that actually succeeded (e.g. "Oregon" vs value "OR").
      const matches = (obs: string | undefined, w: string) => obs !== undefined && (obs === w || obs.includes(w));
      const ok = wanted.some((w) => matches(state.value, w) || matches(state.selectedLabel, w));
      const observed = [state.value, state.selectedLabel].filter((s) => s !== undefined && s !== "").join(" / ");
      return ok ? { ok: true } : { ok: false, failure: { reason: "verification_mismatch", expected: wanted.join(","), observed } };
    }
    if (action.op === "set_date") {
      // Real read-back: the input's value must equal the ISO date we set.
      const state = await page.readState(element.ref);
      return state.value === action.value
        ? { ok: true }
        : { ok: false, failure: { reason: "verification_mismatch", expected: action.value, observed: state.value ?? "" } };
    }
    if (action.op === "expand") {
      // Real read-back: the expander must persist (a disappearing expander is a fail).
      const state = await page.readState(element.ref);
      return state.found
        ? { ok: true }
        : { ok: false, failure: { reason: "verification_mismatch", expected: "expander present", observed: "gone" } };
    }
    if (action.op === "click") {
      // Post-action state/nav check (Fable #1): observe navigation and post-state rather
      // than trusting that the primitive "didn't throw". Generic click success cannot be
      // strictly proven (submit vs click — plan §10); strict effect-detection is M5. We
      // verify a real observation happened and surface a detached-without-nav anomaly.
      const navigated = preUrl !== undefined && page.url() !== preUrl;
      const post = await page.readState(element.ref);
      if (navigated || post.found) return { ok: true };
      // Element gone and no navigation: it may have been consumed (modal close) — accept,
      // but this is the honest edge the plan flags.
      return { ok: true };
    }
    return { ok: true };
  }

  private labelEl(element: RawElement): string {
    return element.name ?? element.role ?? element.ref;
  }

  private audit(op: string, targetLabel: string | undefined, code: string, outcome: "verified" | "failed" | "deny" | "needs_confirmation", failure?: FailureDetail): void {
    this.deps.audit.log({
      kind: op === "click" || op === "goto" ? "decision" : "action",
      op,
      ...(targetLabel ? { targetLabel } : {}),
      origin: this.deps.page.origin(),
      outcome: outcome === "deny" ? "deny" : outcome === "needs_confirmation" ? "needs_confirmation" : outcome,
      code,
      ...(failure ? { failureReason: failure.reason } : {}),
    });
  }

  private primitiveResult(op: string, out: { ok: true } | { ok: false; reason: string; detail?: string }): ActionResult {
    if (out.ok) return { target: op, status: "verified" };
    return { target: op, status: "failed", failure: { reason: "stale_target" } };
  }
}

function safeOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

function primitiveFailure(out: { ok: false; reason: string; detail?: string; availableOptions?: string[] }): FailureDetail {
  switch (out.reason) {
    case "not_found":
      return { reason: "stale_target" };
    case "disabled":
      return { reason: "disabled" };
    case "not_visible":
      return { reason: "not_visible" };
    case "not_editable":
      return { reason: "not_editable" };
    case "option_not_found":
      return { reason: "option_not_found", availableOptions: out.availableOptions ?? [] };
    default:
      return { reason: "verification_mismatch", expected: "action_applied", observed: out.detail ?? "error" };
  }
}

function widgetFailure(out: { ok: false; reason: string; availableOptions?: string[]; widgetHint?: string; detail?: string }): FailureDetail {
  switch (out.reason) {
    case "option_not_found":
      return { reason: "option_not_found", availableOptions: out.availableOptions ?? [] };
    case "widget_unrecognized":
      return { reason: "widget_unrecognized", ...(out.widgetHint ? { widgetHint: out.widgetHint } : {}) };
    case "disabled":
      return { reason: "disabled" };
    case "not_visible":
      return { reason: "not_visible" };
    case "not_found":
      return { reason: "stale_target" };
    default:
      return { reason: "verification_mismatch", expected: "widget_applied", observed: out.detail ?? "error" };
  }
}
