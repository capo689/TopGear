import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import { canonicalJSON, deriveInstallId } from "./identity.js";

/**
 * Server-side verification of the device-bound ed25519 identity (AUTHZ-01/02, AUTH-01/02).
 *
 * The contribution/purge endpoints are UNAUTHENTICATED and public. Without this, anyone who
 * learns an installId can forge contributions under it (commons poisoning, plan T6) or purge
 * its records. Every accepted write must prove possession of the install's private key, and
 * the installId is DERIVED from the verified public key — never trusted from the body.
 *
 * The Vercel functions inline byte-identical copies of this logic (they must be
 * dependency-free); `parity.test.ts` is the drift guard.
 */
export interface VerifyOk {
  ok: true;
  installId: string;
}
export interface VerifyErr {
  ok: false;
  reason: string;
}

function verifyEd25519(publicKeyB64Der: string, message: string, signatureB64: string): boolean {
  try {
    const key = createPublicKey({ key: Buffer.from(publicKeyB64Der, "base64"), format: "der", type: "spki" });
    return cryptoVerify(null, Buffer.from(message, "utf8"), key, Buffer.from(signatureB64, "base64"));
  } catch {
    return false; // malformed key or signature fails closed
  }
}

/**
 * Verify a contribution: (1) installId derives from the public key, and (2) the ed25519
 * signature covers the record's signed body (everything except the publicKey + signature
 * envelope). Returns the DERIVED installId — the authoritative owner for storage.
 */
export function verifyContributionSignature(rec: Record<string, unknown>): VerifyOk | VerifyErr {
  const { publicKey, signature, installId } = rec;
  if (typeof publicKey !== "string" || typeof signature !== "string" || typeof installId !== "string") {
    return { ok: false, reason: "missing publicKey/signature/installId" };
  }
  const derived = deriveInstallId(publicKey);
  if (derived !== installId) return { ok: false, reason: "installId does not match publicKey" };
  const { publicKey: _pk, signature: _sig, ...signed } = rec;
  if (!verifyEd25519(publicKey, canonicalJSON(signed), signature)) {
    return { ok: false, reason: "signature verification failed" };
  }
  return { ok: true, installId: derived };
}

/** How far from the server's clock a purge proof's issuedAt may be (each direction). */
export const PURGE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Verify a purge ownership proof. The signed message binds the action to the installId
 * derived from the key AND a fresh `issuedAt`, so a proof for install A cannot purge
 * install B, cannot be repurposed as a contribution, and is not a permanent purge
 * capability: it is accepted only within ±PURGE_WINDOW_MS of the server's clock. Bounded
 * in-window replay is accepted by design (idempotent purge of the caller's own install).
 */
export function verifyPurgeProof(
  proof: Record<string, unknown>,
  opts: { now?: number; windowMs?: number } = {},
): VerifyOk | VerifyErr {
  const { publicKey, signature, issuedAt } = proof;
  if (typeof publicKey !== "string" || typeof signature !== "string" || typeof issuedAt !== "number") {
    return { ok: false, reason: "missing publicKey/signature/issuedAt" };
  }
  const installId = deriveInstallId(publicKey);
  if (!verifyEd25519(publicKey, canonicalJSON({ action: "purge", installId, issuedAt }), signature)) {
    return { ok: false, reason: "signature verification failed" };
  }
  const now = opts.now ?? Date.now();
  const windowMs = opts.windowMs ?? PURGE_WINDOW_MS;
  if (issuedAt > now + windowMs) return { ok: false, reason: "proof not yet valid" };
  if (issuedAt < now - windowMs) return { ok: false, reason: "proof expired" };
  return { ok: true, installId };
}
