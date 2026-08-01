/**
 * Protocol schema version. Negotiated at attach; mismatches are rejected clearly
 * (INV-8 capability handshake). Bump on any breaking change to a boundary type.
 */
export const SCHEMA_VERSION = "0.1.0-m0" as const;
export type SchemaVersion = typeof SCHEMA_VERSION;
