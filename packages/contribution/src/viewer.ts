import type { DataClass } from "./classify.js";
import type { ContributionRecord } from "./anonymize.js";

/**
 * Consent state (§9.3). Class C contribution is disclosed default-on for the free
 * client; one toggle turns it off, respected instantly and retroactively (kill switch).
 * Enterprise policy can force it off; Class B is enforced regardless of any toggle.
 */
export class Consent {
  private _enabled: boolean;
  constructor(defaultOn = true) {
    this._enabled = defaultOn;
  }
  get enabled(): boolean {
    return this._enabled;
  }
  disable(): void {
    this._enabled = false;
  }
  enable(): void {
    this._enabled = true;
  }
}

export interface DiscardedRecord {
  origin: string;
  dataClass: DataClass;
  reason: string;
}

/**
 * The contribution viewer (§9.2): every record sent is inspectable, and everything
 * discarded (Class A/B) is logged with its reason. Per-record and global kill switches.
 */
export class ContributionViewer {
  private readonly sent: ContributionRecord[] = [];
  private readonly discarded: DiscardedRecord[] = [];

  record(r: ContributionRecord): void {
    this.sent.push(r);
  }
  discard(d: DiscardedRecord): void {
    this.discarded.push(d);
  }
  listSent(): ContributionRecord[] {
    return [...this.sent];
  }
  listDiscarded(): DiscardedRecord[] {
    return [...this.discarded];
  }
  purgeAll(): number {
    const n = this.sent.length;
    this.sent.length = 0;
    return n;
  }
  purgeOne(signature: string): boolean {
    const i = this.sent.findIndex((r) => r.signature === signature);
    if (i < 0) return false;
    this.sent.splice(i, 1);
    return true;
  }
}
