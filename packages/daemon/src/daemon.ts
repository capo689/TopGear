import { randomUUID } from "node:crypto";
import { startConfirmServer, type ConfirmServerHandle } from "./confirm-server.js";
import {
  SCHEMA_VERSION,
  type TaskGrant,
  type ViewScope,
  type ActionBatch,
  type SemanticView,
  type BatchResult,
  type Capabilities,
  type ConfirmationCapability,
  type FillRecordRequest,
  type FillRecordResult,
  type RunPatternRequest,
  type RunPatternResult,
  type HarvestRequest,
  type HarvestResult,
  type HarvestRecordDTO,
} from "@browser-bridge/protocol";
import { CapabilityStore, systemClock, describeConfirmation, type Clock, type ConfirmationDisplay } from "@browser-bridge/policy";
import { AuditLogger, stdoutSink, type AuditSink } from "@browser-bridge/audit";
import { InMemorySecretBroker } from "@browser-bridge/secrets";
import { Session, BatchCapError } from "@browser-bridge/execution";
import { Scheduler, TaskBudget } from "@browser-bridge/scheduler";
import { InMemoryHarvestStore, type HarvestRecord } from "@browser-bridge/harvest-store";
import { PatternRunner, CrawlPolicy } from "@browser-bridge/pattern-runner";
import { InMemorySiteMemory } from "@browser-bridge/site-memory";
import type { BrowserBackend, BrowserPage, ScreenshotRoi, ScreenshotResult } from "@browser-bridge/backend";
import { EvalTelemetry } from "./eval-telemetry.js";

interface SessionEntry {
  session: Session;
  page: BrowserPage;
  capabilities: CapabilityStore;
  secrets: InMemorySecretBroker;
  grant: TaskGrant;
}

export interface DaemonOptions {
  backend: BrowserBackend;
  /** Isolated backend for bulk harvest (plan §8). If absent, run_pattern is unavailable. */
  harvestBackend?: BrowserBackend;
  clock?: Clock;
  auditSink?: AuditSink;
  scheduler?: Scheduler;
}

export interface AttachRequest {
  grant: TaskGrant;
  url?: string;
  /** Scope for the initial view returned by attach (defaults to full). */
  scope?: ViewScope;
}

export interface AttachResult {
  sessionId: string;
  capabilities: Capabilities;
  /**
   * The first SemanticView, captured at attach (field-fix #3). attach already navigates
   * and captures the page, so returning the view here collapses attach+first-view into a
   * single model turn instead of forcing a separate bridge_view round-trip.
   */
  initialView: SemanticView;
}

export class UnknownSessionError extends Error {
  constructor(sessionId: string) {
    super(`unknown session: ${sessionId}`);
    this.name = "UnknownSessionError";
  }
}

/**
 * The daemon: one process, many sessions. Each session binds a TaskGrant at attach and
 * every batch is checked against it (INV-9). No model is trusted; all policy runs here
 * (INV-5). The backend is injected (CDP/Playwright now, extension relay too).
 */
export class Daemon {
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly clock: Clock;
  private readonly auditSink: AuditSink;
  private readonly harvestStore = new InMemoryHarvestStore();
  private readonly siteMemory = new InMemorySiteMemory();
  private readonly scheduler: Scheduler;
  private readonly evalSink = EvalTelemetry.fromEnv(); // live-tier recorder; off unless BB_EVAL_LOG set
  private evalRunSeq = 0; // each attach starts a new run; per-session run identity below
  private readonly evalRuns = new Map<string, { runIndex: number; targetUrl: string }>();
  /** The out-of-band approval channel (INV-9). Undefined until startConfirmChannel(). */
  private confirmServer: ConfirmServerHandle | undefined;

  constructor(private readonly opts: DaemonOptions) {
    this.clock = opts.clock ?? systemClock;
    this.auditSink = opts.auditSink ?? stdoutSink;
    this.scheduler = opts.scheduler ?? new Scheduler({ maxGlobalConcurrency: 3, perOriginConcurrency: 3 });
  }

  private capabilitiesHandshake(): Capabilities {
    return { schemaVersion: SCHEMA_VERSION, vision: true, modes: ["semantic", "hybrid"], advancedCssSelectors: false };
  }

  async attach(req: AttachRequest): Promise<AttachResult> {
    // D2: the cold navigation happens HERE, and it used to be invisible — `attach` recorded a
    // hardcoded pageLoadMs of 0, so wall-minus-page-load did not exist for the one call that
    // does the most page loading. Attach the tab WITHOUT navigating, then time the goto
    // ourselves, so the number means the same thing it means in `act` (plan §4.6: goto +
    // post-navigation re-capture) and excludes tab-open overhead, which is not page load.
    const tAttach = performance.now();
    const page = await this.opts.backend.attach();
    let navMs = 0;
    if (req.url !== undefined) {
      const tNav = performance.now();
      await page.goto(req.url);
      navMs += performance.now() - tNav;
    }
    const sessionId = randomUUID();
    const capabilities = new CapabilityStore(this.clock);
    const secrets = new InMemorySecretBroker();
    const audit = new AuditLogger(this.auditSink, this.clock).child(sessionId);
    const session = new Session({
      sessionId,
      page,
      grant: req.grant,
      capabilities,
      audit,
      secrets,
      clock: this.clock,
      resolveIntent: (currentUrl, intent) => {
        try {
          return this.siteMemory.getLink(new URL(currentUrl).origin, intent);
        } catch {
          return undefined;
        }
      },
    });
    this.sessions.set(sessionId, { session, page, capabilities, secrets, grant: req.grant });
    // Each attach STARTS A NEW RUN (a fresh runIndex, in-process). targetUrl comes from the
    // attach call the daemon already has — NOT from a frozen env, which would merge every run.
    const run = { runIndex: this.evalRunSeq++, targetUrl: req.url ?? page.url() };
    this.evalRuns.set(sessionId, run);
    const tCapture = performance.now();
    const initialView = await session.view(req.scope ?? { kind: "full" });
    // The post-navigation re-capture is page-load time by the same definition `act` uses —
    // but ONLY when we navigated; on a warm attach it is ordinary bridge work.
    if (req.url !== undefined) navMs += performance.now() - tCapture;
    this.evalSink?.record({
      // wallMs spans the WHOLE attach call, so pageLoadMs is always a subset of it and
      // wall-minus-page-load can never go negative.
      ...run, sessionId, tool: "attach", wallMs: Math.round(performance.now() - tAttach), pageLoadMs: Math.round(navMs),
      fieldsAttempted: 0, fieldsVerified: 0, interrupted: false, status: "attached",
    });
    return { sessionId, capabilities: this.capabilitiesHandshake(), initialView };
  }

  /** The run identity (runIndex + targetUrl) for a session, so every event on it groups correctly. */
  private evalRun(sessionId: string): { runIndex: number; targetUrl: string } {
    return this.evalRuns.get(sessionId) ?? { runIndex: 0, targetUrl: "" };
  }

  private get(sessionId: string): SessionEntry {
    const entry = this.sessions.get(sessionId);
    if (!entry) throw new UnknownSessionError(sessionId);
    return entry;
  }

  async view(sessionId: string, scope: ViewScope): Promise<SemanticView> {
    const t0 = performance.now();
    const view = await this.get(sessionId).session.view(scope);
    this.evalSink?.record({
      ...this.evalRun(sessionId), sessionId, tool: "view", wallMs: Math.round(performance.now() - t0), pageLoadMs: 0,
      fieldsAttempted: 0, fieldsVerified: 0, interrupted: false, status: "viewed",
    });
    return view;
  }

  async act(sessionId: string, batch: ActionBatch): Promise<BatchResult> {
    try {
      const t0 = performance.now();
      const result = await this.get(sessionId).session.act(batch);
      this.evalSink?.record({
        ...this.evalRun(sessionId), sessionId, tool: "act", wallMs: Math.round(performance.now() - t0), pageLoadMs: result.pageLoadMs ?? 0,
        fieldsAttempted: result.results.length, fieldsVerified: result.completed,
        interrupted: result.status === "interrupted", status: result.status,
      });
      return result;
    } catch (err) {
      if (err instanceof BatchCapError) {
        // Surface cap violations as a rejected result with the teaching message.
        return {
          status: "rejected",
          revision: 0,
          completed: 0,
          results: [{ target: err.cap.code, status: "failed", failure: { reason: "verification_mismatch", expected: `<= ${err.cap.limit}`, observed: `${err.cap.found}` } }],
        };
      }
      throw err;
    }
  }

  /**
   * D3: `fill_record` is the MEASURED part of every benchmark run, and it emitted nothing —
   * a full run left exactly one event in the log (the attach). It now records like `act`.
   *
   * `fieldsAttempted` counts every field the RECORD asked for (matched + unmatched), not just
   * the ones that found a home. Counting only matched fields would report 20/20 for a 33-field
   * record that silently skipped 13 — a flattering denominator, which is the metric-gaming this
   * project treats as a defect.
   */
  async fillRecord(sessionId: string, req: FillRecordRequest): Promise<FillRecordResult> {
    const t0 = performance.now();
    const result = await this.get(sessionId).session.fillRecord(req);
    this.evalSink?.record({
      ...this.evalRun(sessionId), sessionId, tool: "fill_record",
      wallMs: Math.round(performance.now() - t0), pageLoadMs: result.batch.pageLoadMs ?? 0,
      fieldsAttempted: result.matched.length + result.unmatched.length,
      fieldsVerified: result.batch.completed,
      interrupted: result.batch.status === "interrupted", status: result.batch.status,
    });
    return result;
  }

  screenshot(sessionId: string, roi: ScreenshotRoi): Promise<ScreenshotResult> {
    return this.get(sessionId).page.screenshot(roi);
  }

  /** `bridge_run_pattern`: harvest URLs under the session's grant + crawl policy (§8). */
  async runPattern(sessionId: string, req: RunPatternRequest): Promise<RunPatternResult> {
    const entry = this.get(sessionId);
    if (!this.opts.harvestBackend) {
      throw new Error("harvest unavailable: no isolated backend configured");
    }
    const crawl = new CrawlPolicy({ allowedOrigins: entry.grant.allowedOrigins });
    const budget = new TaskBudget({
      ...(req.budget?.maxPages !== undefined ? { maxPages: req.budget.maxPages } : entry.grant.budgets.maxPages !== undefined ? { maxPages: entry.grant.budgets.maxPages } : {}),
      ...(req.budget?.maxDownloadBytes !== undefined ? { maxDownloadBytes: req.budget.maxDownloadBytes } : {}),
    });
    const runner = new PatternRunner({ backend: this.opts.harvestBackend, scheduler: this.scheduler, store: this.harvestStore, crawl, budget });
    return runner.run({ urls: req.urls });
  }

  /** `bridge_harvest`: query the local Class A corpus (content stays on the machine). */
  harvest(_sessionId: string, req: HarvestRequest): HarvestResult {
    const toDTO = (r: HarvestRecord, withText: boolean): HarvestRecordDTO => ({
      url: r.url,
      ...(r.title !== undefined ? { title: r.title } : {}),
      ...(withText ? { text: r.text } : {}),
      harvestedAt: r.harvestedAt,
    });
    if (req.mode === "search") {
      const results = this.harvestStore.search(req.query ?? "", req.limit);
      return { count: results.length, records: results.map((x) => toDTO(x.record, true)) };
    }
    if (req.mode === "export") {
      const chunks = this.harvestStore.exportChunks(req.chunkSize ?? 20);
      return { count: this.harvestStore.count(), chunks: chunks.map((c) => c.map((r) => toDTO(r, true))) };
    }
    // list: metadata only, no full text
    return { count: this.harvestStore.count(), records: this.harvestStore.list().map((r) => toDTO(r, false)) };
  }

  /**
   * `bridge_confirm`: surface pending confirmations to the confirm UI. It cannot
   * describe or create a confirmation — only request the UI show what the daemon built.
   */
  listPendingConfirmations(sessionId: string): {
    pending: ConfirmationDisplay[];
    approvalUrl?: string;
    hint: string;
  } {
    // Returns the DAEMON's own description of each blocked action, not the model's words
    // (INV-9) — `describeConfirmation` lives in `policy`, beside the store that minted the
    // capability, so the model has no way to influence what a human is shown.
    const pending = this.get(sessionId).capabilities.listPending().map(describeConfirmation);
    if (pending.length === 0) {
      return { pending, hint: "Nothing is awaiting approval." };
    }
    const url = this.confirmServer
      ? `${this.confirmServer.url}/pending?sessionId=${encodeURIComponent(sessionId)}&token=${this.confirmServer.token}`
      : undefined;
    return {
      pending,
      ...(url ? { approvalUrl: url } : {}),
      hint: url
        ? "A person must open this URL and approve or deny. You cannot approve on their behalf."
        : "A person must approve this out of band. The approval channel is not running — start the daemon with the confirm server enabled.",
    };
  }

  /** Called by the inspector confirm UI (never the model) when a human approves. */
  approveConfirmation(sessionId: string, capabilityId: string): boolean {
    return this.get(sessionId).capabilities.approve(capabilityId);
  }

  /** Called by the inspector confirm UI when a human refuses. Burns the capability. */
  denyConfirmation(sessionId: string, capabilityId: string): boolean {
    return this.get(sessionId).capabilities.deny(capabilityId);
  }

  /**
   * Start the loopback approval channel. Separate from the constructor so a test or a
   * headless run can decline to open a socket; when it is not running,
   * listPendingConfirmations says so rather than implying approval is possible.
   */
  async startConfirmChannel(port = 0): Promise<{ url: string; token: string }> {
    if (!this.confirmServer) {
      this.confirmServer = await startConfirmServer(
        {
          listPending: (sid) => this.get(sid).capabilities.listPending(),
          approve: (sid, cid) => this.approveConfirmation(sid, cid),
          deny: (sid, cid) => this.denyConfirmation(sid, cid),
        },
        port,
      );
    }
    return { url: this.confirmServer.url, token: this.confirmServer.token };
  }

  async stopConfirmChannel(): Promise<void> {
    await this.confirmServer?.close();
    this.confirmServer = undefined;
  }

  /** Provision a secret value out-of-band (human-types fallback for M1). */
  setSecret(sessionId: string, ref: string, value: string): void {
    this.get(sessionId).secrets.set(ref, value);
  }

  /** Record a link-graph hint so goto_intent can resolve it (its origin is re-checked). */
  recordLink(sessionId: string, intent: string, url: string): void {
    this.siteMemory.putLink({ origin: this.get(sessionId).page.origin(), intent, url });
  }

  async detach(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    await entry.page.close();
    this.sessions.delete(sessionId);
  }

  async shutdown(): Promise<void> {
    for (const entry of this.sessions.values()) await entry.page.close().catch(() => undefined);
    this.sessions.clear();
    await this.opts.backend.shutdown();
  }
}
