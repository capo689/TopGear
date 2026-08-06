#!/usr/bin/env node
/**
 * INV-10 — the collection gate, verified against REAL production infrastructure.
 *
 * "The endpoint returned 202" is not the same as "the record is durably stored", so this
 * proves storage by OBSERVING the record again from outside, not by trusting a status code:
 *
 *   1. mint a FRESH install identity (used once, so anything found under it is ours)
 *   2. build ONE real Class C record — structure of a PUBLIC origin, no values, no query
 *      string, day-granular (INV-6) — sign it, POST it
 *   3. POST a signed purge proof for the SAME install. The endpoint LISTS that install's
 *      quarantined objects and returns how many it removed. `purged === 1` is the readback:
 *      the record was there, durably, under the installId derived from our key.
 *   4. purge again → `purged === 0`, confirming step 3 actually deleted rather than reported.
 *
 * Step 3/4 also exercise the kill switch on real infrastructure, and leave the commons clean:
 * the test record does not linger in the corpus.
 *
 * Usage: node scripts/gate-inv10.mjs [baseUrl]
 */
import { InstallIdentity, canonicalJSON } from "../packages/contribution/dist/index.js";

const BASE = process.argv[2] ?? "https://top-gear-git-main-capo689s-projects.vercel.app";

const checks = [];
const check = (label, pass, detail) => {
  checks.push({ pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}\n      ${detail}`);
};

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let payload;
  try {
    payload = await res.json();
  } catch {
    payload = { error: "non-JSON response" };
  }
  return { status: res.status, payload };
}

console.log(`\nINV-10 against ${BASE}\n`);

const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
console.log(`health: ${JSON.stringify(health)}\n`);
if (health.storage === "unconfigured") {
  console.log("BLOCKED — durable quarantine storage is not provisioned (BLOB_READ_WRITE_TOKEN unset).");
  console.log("The endpoint returns 503 by design rather than silently dropping data, so INV-10");
  console.log("CANNOT be verified yet. This is an honest blocked, not a pass.\n");
  process.exit(2);
}

const identity = new InstallIdentity();
console.log(`fresh install identity: ${identity.installId} (used once, so anything under it is ours)\n`);

// One real Class C record: structure of a PUBLIC origin. No values, no query string, day only.
const unsigned = {
  origin: "https://job-boards.greenhouse.io",
  kind: "field",
  widgetKind: "react-select",
  fingerprint: { role: "combobox", name: "Disability Status", autocomplete: "off" },
  day: new Date().toISOString().slice(0, 10),
  installId: identity.installId,
};
const record = { ...unsigned, publicKey: identity.publicKey, signature: identity.sign(unsigned) };

// Nothing user-identifying may be in the payload — assert it rather than assume it (INV-6).
const serialized = canonicalJSON(unsigned);
check(
  "the record carries structure only: no values, no query string, day-granular",
  !serialized.includes("?") && unsigned.day.length === 10 && unsigned.origin.split("/").length === 3,
  serialized,
);

const submit = await post("/api/contributions", record);
check("POST /api/contributions accepts the signed record (202)", submit.status === 202 && submit.payload.accepted === true, `${submit.status} ${JSON.stringify(submit.payload)}`);

// The readback: the platform must be able to FIND it again under our derived installId.
const purge = await post("/api/purge", identity.purgeProof());
check(
  "READBACK: a signed purge finds exactly the 1 record we stored (durable, not just 202)",
  purge.status === 200 && purge.payload.purged === 1,
  `${purge.status} ${JSON.stringify(purge.payload)}`,
);

const again = await post("/api/purge", identity.purgeProof());
check("the purge actually deleted (a second purge finds 0)", again.status === 200 && again.payload.purged === 0, `${again.status} ${JSON.stringify(again.payload)}`);

// A forged identity must not be able to store anything (the gate is authorization, not shape).
const forger = new InstallIdentity();
const forged = { ...unsigned, publicKey: forger.publicKey, signature: identity.sign(unsigned) };
const rejected = await post("/api/contributions", forged);
check("negative control: a record whose signature does not match its key is rejected 401", rejected.status === 401, `${rejected.status} ${JSON.stringify(rejected.payload)}`);

const failed = checks.filter((c) => !c.pass).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
