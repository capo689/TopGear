import { generateKeyPairSync, sign as cryptoSign, createHash, type KeyObject } from "node:crypto";

/**
 * Derive the installId from the public key (base64 SPKI DER). The SAME function runs on
 * the server so a forged installId cannot be stored: the server recomputes this from the
 * key it just verified and ignores any installId the body claims (AUTHZ-01).
 */
export function deriveInstallId(publicKeyB64Der: string): string {
  return createHash("sha256").update(publicKeyB64Der).digest("hex").slice(0, 16);
}

function sortKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(sortKeys);
  if (obj && typeof obj === "object") {
    const src = obj as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) out[key] = sortKeys(src[key]);
    return out;
  }
  return obj;
}

/** Canonical (key-sorted) JSON so signatures are stable across field ordering. */
export function canonicalJSON(obj: unknown): string {
  return JSON.stringify(sortKeys(obj));
}

/**
 * The per-install signing identity (§16 decision 4: device-bound, revocable). The
 * installId is derived from the public key — it is NOT a user identity, and rotating the
 * key revokes the install (its unpromoted contributions are purged). The private key
 * never leaves the machine and never enters any contribution record.
 */
export class InstallIdentity {
  readonly installId: string;
  /** base64 SPKI DER — travels in every record so the server can verify the signature. */
  readonly publicKey: string;
  private readonly privateKey: KeyObject;

  constructor() {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    this.privateKey = privateKey;
    this.publicKey = publicKey.export({ type: "spki", format: "der" }).toString("base64");
    this.installId = deriveInstallId(this.publicKey);
  }

  sign(record: unknown): string {
    return cryptoSign(null, Buffer.from(canonicalJSON(record), "utf8"), this.privateKey).toString("base64");
  }

  /**
   * A single-purpose signed ownership proof for purge (AUTHZ-02): the server verifies it,
   * derives the installId from the key, and purges ONLY that install. A caller who does not
   * hold the private key cannot forge it, so no one can wipe another install's records.
   */
  purgeProof(): PurgeProof {
    return { publicKey: this.publicKey, installId: this.installId, signature: this.sign({ action: "purge", installId: this.installId }) };
  }
}

/** A signed ownership proof carried by a purge request. */
export interface PurgeProof {
  publicKey: string;
  installId: string;
  signature: string;
}
