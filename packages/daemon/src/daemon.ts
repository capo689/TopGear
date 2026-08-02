import { randomUUID } from "node:crypto";
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
import { CapabilityStore, systemClock, type Clock } from "@browser-bridge/policy";
import { AuditLogger, stdoutSink, type AuditSink } from "@browser-bridge/audit";
import { InMemorySecretBroker } from "@browser-bridge/secrets";
import { Session, BatchCapError } from "@browser-bridge/execution";
import { Scheduler, TaskBudget } from "@browser-bridge/scheduler";
import { InMemoryHarvestStore, type HarvestRecord } from "@browser-bridge/harvest-store";
import { PatternRunner, CrawlPolicy } from "@browser-bridge/pattern-runner";
import { InMemorySiteMemory } from "@browser-bridge/site-memory";
import type { BrowserBackend, BrowserPage, ScreenshotRoi, ScreenshotResult } from "@browser-bridge/backend";

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
}

export interface AttachResult {
  sessionId: string;
  capabilities: Capabilities;
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

  constructor(private readonly opts: DaemonOptions) {
    this.clock = opts.clock ?? systemClock;
    this.auditSink = opts.auditSink ?? stdoutSink;
    this.scheduler = opts.scheduler ?? new Scheduler({ maxGlobalConcurrency: 3, perOriginConcurrency: 3 });
  }

  private capabilitiesHandshake(): Capabilities {
    return { schemaVersion: SCHEMA_VERSION, vision: true, modes: ["semantic", "hybrid"], advancedCssSelectors: false };
  }

  async attach(req: AttachRequest): Promise<AttachResult> {
    const page = await this.opts.backend.attach(req.url);
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
    return { sessionId, capabilities: this.capabilitiesHandshake() };
  }

  private get(sessionId: string): SessionEntry {
    const entry = this.sessions.get(sessionId);
    if (!entry) throw new UnknownSessionError(sessionId);
    return entry;
  }

  view(sessionId: string, scope: ViewScope): Promise<SemanticView> {
    return this.get(sessionId).session.view(scope);
  }

  async act(sessionId: string, batch: ActionBatch): Promise<BatchResult> {
    try {
      return await this.get(sessionId).session.act(batch);
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

  fillRecord(sessionId: string, req: FillRecordRequest): Promise<FillRecordResult> {
    return this.get(sessionId).session.fillRecord(req);
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
  listPendingConfirmations(_sessionId: string): Record<string, never> {
    // The confirm UI reads pending capabilities from its own channel in M1; this hook
    // exists so the model tool can request a surface without authoring anything.
    return {};
  }

  /** Called by the inspector confirm UI (never the model) when a human approves. */
  approveConfirmation(sessionId: string, capabilityId: string): boolean {
    return this.get(sessionId).capabilities.approve(capabilityId);
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
