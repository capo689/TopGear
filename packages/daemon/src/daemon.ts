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
} from "@browser-bridge/protocol";
import { CapabilityStore, systemClock, type Clock } from "@browser-bridge/policy";
import { AuditLogger, stdoutSink, type AuditSink } from "@browser-bridge/audit";
import { InMemorySecretBroker } from "@browser-bridge/secrets";
import { Session, BatchCapError } from "@browser-bridge/execution";
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
  clock?: Clock;
  auditSink?: AuditSink;
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

  constructor(private readonly opts: DaemonOptions) {
    this.clock = opts.clock ?? systemClock;
    this.auditSink = opts.auditSink ?? stdoutSink;
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
    const session = new Session({ sessionId, page, grant: req.grant, capabilities, audit, secrets, clock: this.clock });
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

  screenshot(sessionId: string, roi: ScreenshotRoi): Promise<ScreenshotResult> {
    return this.get(sessionId).page.screenshot(roi);
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
