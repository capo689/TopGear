import { generateKeyPairSync, sign as cryptoSign, createHash, type KeyObject } from "node:crypto";

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
  private readonly privateKey: KeyObject;

  constructor() {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    this.privateKey = privateKey;
    const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
    this.installId = createHash("sha256").update(pem).digest("hex").slice(0, 16);
  }

  sign(record: unknown): string {
    return cryptoSign(null, Buffer.from(canonicalJSON(record), "utf8"), this.privateKey).toString("base64");
  }
}
