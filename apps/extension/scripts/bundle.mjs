import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

// Bundle the MV3 extension into load-unpacked-ready JS. The service worker is an ES
// module; the content script is injected as a classic script (IIFE).
mkdirSync("dist", { recursive: true });

await build({
  entryPoints: ["src/service-worker.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome116",
  outfile: "dist/service-worker.js",
  legalComments: "none",
});

await build({
  entryPoints: ["src/content-script.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome116",
  outfile: "dist/content-script.js",
  legalComments: "none",
});

copyFileSync("manifest.json", "dist/manifest.json");
process.stdout.write("extension bundled → apps/extension/dist/ (load-unpacked this folder)\n");
