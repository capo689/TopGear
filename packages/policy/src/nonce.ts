import { randomUUID } from "node:crypto";

/**
 * Injectable source of single-use nonces for capability IDs. Injectable so tests can
 * assert single-use semantics against known IDs without relying on randomness.
 */
export interface NonceSource {
  next(): string;
}

export const cryptoNonce: NonceSource = {
  next: () => randomUUID(),
};

/** A deterministic nonce source for tests: cap-0, cap-1, ... */
export function sequentialNonce(prefix = "cap"): NonceSource {
  let i = 0;
  return {
    next: () => `${prefix}-${i++}`,
  };
}
