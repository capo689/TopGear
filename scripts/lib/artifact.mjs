/**
 * THE canonical distributable — one definition, imported by the builder and by every gate.
 *
 * The gate-integrity rule (docs/engineering/STANDING_LAW.md) is about THIS path, not about "a bundle built the same
 * way". A gate that builds its own throwaway proves the code compiles; it does not prove that
 * the file we hand people works. Four times now a gate has certified something other than the
 * thing that ships, so the resolution lives here and the default is never a temp directory.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

/** The distributable's real path — what a person installs. */
export const DISTRIBUTABLE = join(homedir(), "Desktop", "scratchpad", "browser-bridge.mcpb");

/**
 * Resolve which artifact a gate should exercise.
 *   (default)          → THE distributable at its real path; missing is a hard error.
 *   <path>             → an explicit artifact (still a real file on disk).
 *   --ephemeral        → build a throwaway. Explicit opt-in ONLY, and it announces loudly
 *                        that the run does NOT gate the shipped artifact.
 */
export function resolveArtifact(argv, root) {
  const positional = argv.find((a) => !a.startsWith("--"));
  const flagIdx = argv.indexOf("--artifact");
  const explicit = flagIdx >= 0 ? argv[flagIdx + 1] : undefined;

  if (argv.includes("--ephemeral")) {
    const out = join(mkdtempSync(join(tmpdir(), "bb-gate-")), "browser-bridge.mcpb");
    console.log("⚠  --ephemeral: building a THROWAWAY bundle.");
    console.log("⚠  This run does NOT gate the shipped artifact. It proves the code compiles.\n");
    execFileSync("node", [join(root, "scripts/build-mcpb.mjs"), out], { cwd: root, stdio: "inherit" });
    return describe(out, "ephemeral (NOT the shipped artifact)");
  }

  const path = explicit ?? (positional && positional.endsWith(".mcpb") ? positional : DISTRIBUTABLE);
  if (!existsSync(path)) {
    console.error(`\nNo artifact at ${path}`);
    console.error(path === DISTRIBUTABLE ? "Build the distributable first:  pnpm build && node scripts/build-mcpb.mjs" : "");
    process.exit(2);
  }
  return describe(path, path === DISTRIBUTABLE ? "THE distributable" : "explicit path");
}

function describe(path, kind) {
  const bytes = readFileSync(path);
  return {
    path,
    kind,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    built: statSync(path).mtime.toISOString(),
    size: bytes.length,
  };
}
