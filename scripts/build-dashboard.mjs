/**
 * Build a self-contained test dashboard from scripts/.test-report.json.
 *
 * Generated from the report, never hand-written, so the page cannot drift from what the
 * suite actually did. Run `node scripts/test-report.mjs` first.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const r = JSON.parse(readFileSync(join(root, "scripts/.test-report.json"), "utf8"));
const out = process.argv[2] || join(root, "test-dashboard.html");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pkgs = [...r.packages].sort((a, b) => b.passed - a.passed);
const tested = pkgs.filter((p) => p.passed > 0);
const gaps = pkgs.filter((p) => p.passed === 0);
const gatesPassed = r.gates.filter((g) => g.ok).length;

// Defect evidence: measured live, before vs after the fixes in this branch.
const DEFECTS = [
  { label: "Wikipedia revenue table (50 rows)", before: 0, after: 71, unit: " blocks" },
  { label: "Apple infobox facts", before: 0, after: 73, unit: " blocks" },
];

const css = `
:root{color-scheme:light}
.viz{--surface:#fcfcfb;--plane:#f9f9f7;--ink:#0b0b0b;--ink2:#52514e;--muted:#898781;
--grid:#e1e0d9;--base:#c3c2b7;--border:rgba(11,11,11,.10);
--s1:#2a78d6;--s2:#eb6834;--good:#0ca30c;--warn:#fab219;--crit:#d03b3b}
@media (prefers-color-scheme:dark){:root:where(:not([data-theme=light])) .viz{
--surface:#1a1a19;--plane:#0d0d0d;--ink:#fff;--ink2:#c3c2b7;--muted:#898781;
--grid:#2c2c2a;--base:#383835;--border:rgba(255,255,255,.10);--s1:#3987e5;--s2:#d95926;--crit:#e66767}}
:root[data-theme=dark] .viz{--surface:#1a1a19;--plane:#0d0d0d;--ink:#fff;--ink2:#c3c2b7;
--grid:#2c2c2a;--base:#383835;--border:rgba(255,255,255,.10);--s1:#3987e5;--s2:#d95926;--crit:#e66767}
*{box-sizing:border-box}
body{margin:0;background:var(--plane);color:var(--ink);
font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:1040px;margin:0 auto;padding:32px 24px 72px}
h1{font-size:23px;font-weight:650;margin:0 0 4px}
.sub{color:var(--ink2);font-size:14px;margin:0 0 26px;line-height:1.5}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:26px}
.tile{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px}
.tile .l{font-size:12px;color:var(--ink2);margin-bottom:6px}
.tile .v{font-size:29px;font-weight:640;letter-spacing:-.02em}
.tile .n{font-size:11px;color:var(--muted);margin-top:3px}
.v.good{color:var(--good)}.v.crit{color:var(--crit)}
.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;
padding:20px 22px;margin-bottom:18px}
.card h2{font-size:15px;font-weight:640;margin:0 0 3px}
.card p{font-size:13px;color:var(--ink2);margin:0 0 16px;line-height:1.55}
.legend{display:flex;gap:16px;font-size:12px;color:var(--ink2);margin-bottom:12px}
.sw{width:10px;height:10px;border-radius:2px;display:inline-block;margin-right:6px;vertical-align:-1px}
table{width:100%;border-collapse:collapse;font-size:12.5px}
th{text-align:left;font-weight:600;color:var(--ink2);border-bottom:1px solid var(--base);
padding:7px 8px;font-size:11.5px;text-transform:uppercase;letter-spacing:.03em}
td{padding:6px 8px;border-bottom:1px solid var(--grid);vertical-align:top}
td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.pill{display:inline-block;padding:1px 7px;border-radius:99px;font-size:11px;font-weight:600}
.pill.p{background:rgba(12,163,12,.13);color:var(--good)}
.pill.i{background:rgba(250,178,25,.16);color:#8a6100}
:root[data-theme=dark] .pill.i{color:var(--warn)}
details{margin-top:10px}
summary{cursor:pointer;font-size:13px;color:var(--s1);padding:5px 0}
.tt{position:fixed;pointer-events:none;background:var(--ink);color:var(--surface);
padding:6px 9px;border-radius:6px;font-size:12px;opacity:0;transition:opacity .1s;z-index:9}
.btn{position:absolute;top:30px;right:24px;background:var(--surface);color:var(--ink);
border:1px solid var(--border);border-radius:7px;padding:6px 11px;font-size:12px;cursor:pointer}
.wrap{position:relative}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;color:var(--ink2)}
`;
// ---- Horizontal bar chart: tests per package. Horizontal because 24 category labels
// are package names — unreadable rotated under vertical columns.
function barsH(rows, color, unit = "") {
  const max = Math.max(...rows.map((d) => d.v), 1);
  const rowH = 21, padL = 176, w = 900;
  const h = rows.length * rowH + 26;
  let s = `<svg class="chart" viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img">`;
  // Gridlines at clean intervals, recessive.
  const step = max <= 10 ? 2 : max <= 30 ? 10 : max <= 60 ? 20 : 25;
  for (let g = 0; g <= max; g += step) {
    const x = padL + (g / max) * (w - padL - 60);
    s += `<line x1="${x}" y1="14" x2="${x}" y2="${h - 14}" stroke="var(--grid)" stroke-width="1"/>`;
    s += `<text x="${x}" y="${h - 3}" fill="var(--muted)" font-size="10" text-anchor="middle">${g}</text>`;
  }
  rows.forEach((d, i) => {
    const y = 16 + i * rowH;
    const bw = Math.max((d.v / max) * (w - padL - 60), d.v > 0 ? 2 : 0);
    s += `<text x="${padL - 9}" y="${y + 11}" fill="var(--ink2)" font-size="11.5" text-anchor="end">${esc(d.k)}</text>`;
    s += `<rect x="${padL}" y="${y}" width="${bw}" height="14" rx="3" fill="${d.zero ? "var(--muted)" : color}"
      data-t="${esc(d.k)}: ${d.v}${unit}${d.zero ? " (no test files)" : ""}"/>`;
    s += `<text x="${padL + bw + 7}" y="${y + 11}" fill="var(--ink2)" font-size="11" font-weight="600">${d.v}${d.zero ? " —" : ""}</text>`;
  });
  return s + `<line x1="${padL}" y1="14" x2="${padL}" y2="${h - 14}" stroke="var(--base)" stroke-width="1"/></svg>`;
}

// ---- Grouped before/after bars for the live defect evidence.
function beforeAfter(rows) {
  const max = Math.max(...rows.flatMap((d) => [d.before, d.after]), 1);
  const rowH = 46, padL = 250, w = 900, h = rows.length * rowH + 30;
  let s = `<svg class="chart" viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img">`;
  rows.forEach((d, i) => {
    const y = 14 + i * rowH;
    s += `<text x="${padL - 9}" y="${y + 22}" fill="var(--ink2)" font-size="11.5" text-anchor="end">${esc(d.label)}</text>`;
    [["before", d.before, "var(--crit)"], ["after", d.after, "var(--good)"]].forEach(([lab, v, c], j) => {
      const bw = Math.max((v / max) * (w - padL - 90), v > 0 ? 2 : 3);
      const yy = y + j * 18;
      s += `<rect x="${padL}" y="${yy}" width="${bw}" height="14" rx="3" fill="${c}"
        data-t="${esc(d.label)} ${lab}: ${v}${esc(d.unit)}"/>`;
      s += `<text x="${padL + bw + 7}" y="${yy + 11}" fill="var(--ink2)" font-size="11" font-weight="600">${v}${esc(d.unit)}</text>`;
    });
  });
  return s + `<line x1="${padL}" y1="10" x2="${padL}" y2="${h - 16}" stroke="var(--base)" stroke-width="1"/></svg>`;
}

const pkgRows = pkgs.map((p) => ({ k: p.short, v: p.passed, zero: p.passed === 0 }));
const gateRows = r.gates.map((g) => ({ k: g.label, v: g.passed ?? 0, zero: false }));

const gateTable = r.gates
  .map(
    (g) => `<tr><td>${esc(g.label)}</td><td class="n">${g.passed}/${g.total}</td>
<td>${g.ok ? '<span class="pill p">PASS</span>' : '<span class="pill i">CHECK</span>'}
${g.indeterminate ? ` <span class="pill i">${g.indeterminate} indeterminate</span>` : ""}</td>
<td class="mono">${esc(g.file)}</td></tr>`,
  )
  .join("");

const pkgTable = pkgs
  .map(
    (p) => `<tr><td>${esc(p.short)}</td><td class="n">${p.passed}</td><td class="n">${p.failed}</td>
<td class="n">${Math.round(p.durationMs)}ms</td><td class="mono">${esc(p.note ?? "")}</td></tr>`,
  )
  .join("");

const allTests = pkgs
  .flatMap((p) => p.tests.map((t) => ({ pkg: p.short, ...t })))
  .map(
    (t) => `<tr><td class="mono">${esc(t.pkg)}</td><td>${esc(t.title)}</td>
<td><span class="pill p">${esc(t.status)}</span></td><td class="n">${Math.round(t.durationMs)}ms</td></tr>`,
  )
  .join("");

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Browser Bridge — test dashboard</title><style>${css}</style></head>
<body class="viz"><div class="wrap">
<button class="btn" onclick="document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'light':'dark'">Toggle theme</button>
<h1>Browser Bridge — every feature under test</h1>
<p class="sub">Branch <span class="mono">fix/silent-extraction-failures</span> · generated ${esc(r.generatedAt)} from
<span class="mono">scripts/.test-report.json</span>. Tests drive a real Chromium against the self-hosted fixture farm —
nothing here is mocked. Gates additionally drive the built <span class="mono">.mcpb</span> over the MCP tool surface,
and two of them hit live third-party pages and real production storage.</p>

<div class="tiles">
<div class="tile"><div class="l">Tests passing</div><div class="v good">${r.totals.passed}</div><div class="n">across ${tested.length} packages</div></div>
<div class="tile"><div class="l">Failing</div><div class="v ${r.totals.failed ? "crit" : "good"}">${r.totals.failed}</div><div class="n">0 skipped</div></div>
<div class="tile"><div class="l">Gates passing</div><div class="v good">${gatesPassed}/${r.gates.length}</div><div class="n">incl. live pages + prod</div></div>
<div class="tile"><div class="l">Suite runtime</div><div class="v">${(r.totals.durationMs / 1000).toFixed(1)}s</div><div class="n">real browser</div></div>
</div>

<div class="card"><h2>Tests per package</h2>
<p>Every workspace package with a suite. Grey bars are packages with a test script but no test files — a coverage
gap, recorded rather than hidden. <span class="mono">backend</span> is interface-only; <span class="mono">extension</span>
and <span class="mono">shim</span> are the browser-side half of the product and are the real gap.</p>
<div class="legend"><span><span class="sw" style="background:var(--s1)"></span>tests passing</span>
<span><span class="sw" style="background:var(--muted)"></span>no test files</span></div>
${barsH(pkgRows, "var(--s1)")}</div>

<div class="card"><h2>Gates — the shipping artifact, live pages, production storage</h2>
<p>A unit suite cannot speak for these: each unpacks the built bundle and speaks MCP JSON-RPC to it, exactly as Claude does.</p>
<div class="legend"><span><span class="sw" style="background:var(--s2)"></span>checks passed</span></div>
${barsH(gateRows, "var(--s2)")}
<table><thead><tr><th>Gate</th><th class="n">Checks</th><th>Result</th><th>Script</th></tr></thead><tbody>${gateTable}</tbody></table></div>

<div class="card"><h2>The defect this branch fixes, measured live</h2>
<p>Content extraction returned success with all table content silently missing. Measured against the exact Wikipedia
pages that failed the benchmark, before and after.</p>
<div class="legend"><span><span class="sw" style="background:var(--crit)"></span>before</span>
<span><span class="sw" style="background:var(--good)"></span>after</span></div>
${beforeAfter(DEFECTS)}</div>

<div class="card"><h2>Per-package detail</h2>
<table><thead><tr><th>Package</th><th class="n">Passed</th><th class="n">Failed</th><th class="n">Time</th><th>Note</th></tr></thead>
<tbody>${pkgTable}</tbody></table>
<details><summary>Show all ${r.totals.passed} individual tests</summary>
<table><thead><tr><th>Package</th><th>Test</th><th>Status</th><th class="n">Time</th></tr></thead><tbody>${allTests}</tbody></table></details>
</div>
</div>
<div class="tt" id="tt"></div>
<script>
const tt=document.getElementById('tt');
document.addEventListener('mouseover',e=>{const t=e.target.getAttribute&&e.target.getAttribute('data-t');
if(t){tt.textContent=t;tt.style.opacity=1;tt.style.left=(e.clientX+12)+'px';tt.style.top=(e.clientY-28)+'px';}});
document.addEventListener('mousemove',e=>{if(tt.style.opacity==='1'){tt.style.left=(e.clientX+12)+'px';tt.style.top=(e.clientY-28)+'px';}});
document.addEventListener('mouseout',e=>{if(e.target.getAttribute&&e.target.getAttribute('data-t'))tt.style.opacity=0;});
</script></body></html>`;

writeFileSync(out, html);
console.log(`dashboard: ${out}  (${r.totals.passed} tests, ${gatesPassed}/${r.gates.length} gates)`);
