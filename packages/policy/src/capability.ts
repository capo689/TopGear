import type { ConfirmationCapability, NormalizedAction } from "@browser-bridge/protocol";
import type { Clock } from "./clock.js";
import { systemClock } from "./clock.js";
import type { NonceSource } from "./nonce.js";
import { cryptoNonce } from "./nonce.js";

export interface MintParams {
  /** Daemon-authored normalized action (never model text — INV-9). */
  action: NormalizedAction;
  origin: string;
  pageRevision: number;
  sensitiveFields: string[];
  ttlMs: number;
}

export interface ConsumeContext {
  origin: string;
  pageRevision: number;
}

export type ConsumeFailureReason =
  | "unknown"
  | "not_approved"
  | "already_consumed"
  | "expired"
  | "origin_mismatch"
  | "revision_mismatch";

export type ConsumeResult =
  | { ok: true; capability: ConfirmationCapability }
  | { ok: false; reason: ConsumeFailureReason };

interface StoredCap {
  capability: ConfirmationCapability;
  approved: boolean;
  consumed: boolean;
  expiresAtMs: number;
}

/**
 * Mints and consumes single-use confirmation capabilities (INV-9, plan §4.5). A
 * capability binds to action + origin + page revision + TTL + nonce. It is consumed on
 * first successful use; a moved page revision or an expired TTL invalidates it. No
 * prior confirmation authorizes a later replay — replays must mint fresh capabilities.
 */
export class CapabilityStore {
  private readonly store = new Map<string, StoredCap>();

  constructor(
    private readonly clock: Clock = systemClock,
    private readonly nonce: NonceSource = cryptoNonce,
  ) {}

  /** Mint an already-approved capability (the daemon does this post-approval). */
  mint(params: MintParams): ConfirmationCapability {
    return this.create(params, true);
  }

  /**
   * Mint a PENDING capability from a blocked action. It cannot be consumed until a human
   * approves it in the confirm UI (`approve`). The model never authors it (INV-9).
   */
  mintPending(params: MintParams): ConfirmationCapability {
    return this.create(params, false);
  }

  /** Human approval from the confirm UI turns a pending capability consumable. */
  approve(capabilityId: string): boolean {
    const entry = this.store.get(capabilityId);
    if (!entry || entry.consumed || this.clock.now() > entry.expiresAtMs) return false;
    entry.approved = true;
    return true;
  }

  private create(params: MintParams, approved: boolean): ConfirmationCapability {
    const capabilityId = this.nonce.next();
    const expiresAtMs = this.clock.now() + params.ttlMs;
    const capability: ConfirmationCapability = {
      capabilityId,
      action: params.action,
      origin: params.origin,
      pageRevision: params.pageRevision,
      sensitiveFields: params.sensitiveFields,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
    this.store.set(capabilityId, { capability, approved, consumed: false, expiresAtMs });
    return capability;
  }

  consume(capabilityId: string, ctx: ConsumeContext): ConsumeResult {
    const entry = this.store.get(capabilityId);
    if (!entry) return { ok: false, reason: "unknown" };
    if (entry.consumed) return { ok: false, reason: "already_consumed" };
    if (!entry.approved) return { ok: false, reason: "not_approved" };
    if (this.clock.now() > entry.expiresAtMs) return { ok: false, reason: "expired" };
    if (entry.capability.origin !== ctx.origin) return { ok: false, reason: "origin_mismatch" };
    if (entry.capability.pageRevision !== ctx.pageRevision) return { ok: false, reason: "revision_mismatch" };
    // Single-use: burn it only on a fully-valid consume.
    entry.consumed = true;
    return { ok: true, capability: entry.capability };
  }

  /** Inspection helper (tests, inspector-ui). */
  isConsumed(capabilityId: string): boolean {
    return this.store.get(capabilityId)?.consumed ?? false;
  }

  /** Drop expired entries; returns the count removed. */
  sweep(): number {
    const now = this.clock.now();
    let removed = 0;
    for (const [id, entry] of this.store) {
      if (entry.consumed || now > entry.expiresAtMs) {
        this.store.delete(id);
        removed += 1;
      }
    }
    return removed;
  }
}
