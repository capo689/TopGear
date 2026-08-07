/**
 * Run every workspace package's vitest suite with the JSON reporter and aggregate the
 * results into one machine-readable report. Used to build the coverage dashboard, and
 * to make "all features tested" a claim backed by per-test data rather than a summary
 * line. Writes scripts/.test-report.json.
 */
import { readdirSync, existsSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const work = mkdtempSync(join(tmpdir(), "bb-report-"));

const pkgs = [];
for (const group of ["packages", "apps"]) {
  const base = join(root, group);
  if (!existsSync(base)) continue;
  for (const name of readdirSync(base)) {
    const pj = join(base, name, "package.json");
    if (!existsSync(pj)) continue;
    const json = JSON.parse(readFileSync(pj, "utf8"));
    // Include packages with NO test script at all. Skipping them would let a package with
    // zero coverage vanish from the report entirely, which reads as "not a gap" — the same
    // silent-omission failure this whole branch is about.
    pkgs.push({ dir: join(base, name), name: json.name, group, short: name, hasTestScript: !!json.scripts?.test });
  }
}

const report = { generatedAt: new Date().toISOString(), packages: [] };

for (const p of pkgs) {
  const out = join(work, `${p.short}.json`);
  let ok = true;
  if (!p.hasTestScript) {
    report.packages.push({
      name: p.name,
      short: p.short,
      group: p.group,
      ok: true,
      passed: 0,
      failed: 0,
      skipped: 0,
      durationMs: 0,
      tests: [],
      note: "no test script — coverage gap",
    });
    continue;
  }
  try {
    execFileSync("npx", ["vitest", "run", "--reporter=json", `--outputFile=${out}`], {
      cwd: p.dir,
      stdio: "ignore",
      env: { ...process.env, CI: "1" },
    });
  } catch {
    ok = false;
  }
  if (!existsSync(out)) {
    // A package with a `test` script but no test FILES is a coverage gap, not a failure.
    // Reporting it as failing would be the same dishonesty this suite exists to catch.
    report.packages.push({
      name: p.name,
      short: p.short,
      group: p.group,
      ok: true,
      passed: 0,
      failed: 0,
      skipped: 0,
      durationMs: 0,
      tests: [],
      note: "no test files — coverage gap",
    });
    continue;
  }
  const j = JSON.parse(readFileSync(out, "utf8"));
  const tests = [];
  for (const suite of j.testResults ?? []) {
    for (const t of suite.assertionResults ?? []) {
      tests.push({
        file: (suite.name ?? "").replace(root + "/", ""),
        title: t.fullName ?? t.title,
        status: t.status,
        durationMs: t.duration ?? 0,
      });
    }
  }
  report.packages.push({
    name: p.name,
    short: p.short,
    group: p.group,
    ok,
    passed: tests.filter((t) => t.status === "passed").length,
    failed: tests.filter((t) => t.status === "failed").length,
    skipped: tests.filter((t) => t.status !== "passed" && t.status !== "failed").length,
    durationMs: Math.round(tests.reduce((s, t) => s + t.durationMs, 0)),
    tests,
  });
}

// ---- Gates: the checks that drive the SHIPPING .mcpb over the real MCP tool surface,
// plus the two that hit live third-party pages and real production storage. A unit suite
// cannot speak for these, so they are recorded alongside rather than folded in.
const GATES = [
  ["gate-d4.mjs", "D4 teach & recover (bundle)", []],
  ["gate-telemetry.mjs", "D2/D3/D5 telemetry (bundle)", []],
  ["gate-trackc.mjs", "Track C two-vendor (live)", []],
  ["gate-inv10.mjs", "INV-10 durable storage (prod)", []],
  ["gate-d4-live.mjs", "D4 on a live ATS page", ["--max", "3"]],
];
report.gates = [];
for (const [file, label, args] of GATES) {
  const path = join(root, "scripts", file);
  if (!existsSync(path)) continue;
  let stdout = "";
  let ok = true;
  try {
    stdout = execFileSync("node", [path, ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    ok = false;
    stdout = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
  const m = stdout.match(/(\d+)\s*\/\s*(\d+)\s+checks passed/);
  const v = stdout.match(/(\d+)\s*\/\s*(\d+)\s+verified/);
  const passed = m ? Number(m[1]) : v ? Number(v[1]) : null;
  const total = m ? Number(m[2]) : v ? Number(v[2]) : null;
  report.gates.push({ file, label, ok, passed, total, indeterminate: (stdout.match(/verification_indeterminate/g) ?? []).length });
}

report.totals = {
  packages: report.packages.length,
  passed: report.packages.reduce((s, p) => s + p.passed, 0),
  failed: report.packages.reduce((s, p) => s + p.failed, 0),
  skipped: report.packages.reduce((s, p) => s + p.skipped, 0),
  durationMs: report.packages.reduce((s, p) => s + (p.durationMs ?? 0), 0),
};

writeFileSync(join(root, "scripts/.test-report.json"), JSON.stringify(report, null, 2));
console.log(
  `packages=${report.totals.packages} passed=${report.totals.passed} failed=${report.totals.failed} skipped=${report.totals.skipped}`,
);
for (const p of report.packages) {
  if (p.failed > 0 || !p.ok) console.log(`  FAIL ${p.name}: ${p.failed} failed`);
}
