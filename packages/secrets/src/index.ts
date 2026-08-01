import { createHash } from "node:crypto";

/**
 * @browser-bridge/secrets — the Secrets Broker (INV-4, T3). Resolves SecretRefs to
 * values that are used ONLY to fill fields and NEVER enter model context, logs, error
 * payloads, or crash dumps. Read-back of a secret field compares hashes, never values.
 */

export function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export interface SecretBroker {
  has(ref: string): boolean;
  /** Resolve a ref to its value. The caller must never log or return this to a model. */
  resolve(ref: string): string | undefined;
  /** Hash of the value for read-back verification (never the value itself). */
  hash(ref: string): string | undefined;
}

/**
 * In-memory broker for M1. Values are provided out-of-band (the human-types fallback,
 * or a future keychain integration at M5). `toString`/`toJSON` are overridden so the
 * broker can never be accidentally serialized into a log or model payload.
 */
export class InMemorySecretBroker implements SecretBroker {
  private readonly store = new Map<string, string>();

  set(ref: string, value: string): void {
    this.store.set(ref, value);
  }

  has(ref: string): boolean {
    return this.store.has(ref);
  }

  resolve(ref: string): string | undefined {
    return this.store.get(ref);
  }

  hash(ref: string): string | undefined {
    const value = this.store.get(ref);
    return value === undefined ? undefined : hashValue(value);
  }

  toString(): string {
    return "[SecretBroker]";
  }

  toJSON(): string {
    return "[SecretBroker]";
  }
}
