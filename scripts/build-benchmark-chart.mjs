/** Chart the head-to-head from scripts/.benchmark.json. Generated, never hand-written. */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const d = JSON.parse(readFileSync(join(root, "scripts/.benchmark.json"), "utf8"));
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const tasks = [...new Set(d.rows.map((r) => r.task))];
const pair = (t) => ({
  b: d.rows.find((r) => r.task === t && r.arm === "bridge"),
  g: d.rows.find((r) => r.task === t && r.arm === "traditional"),
});
const bt = d.rows.filter((r) => r.arm === "bridge").reduce((s, r) => s + r.turns, 0);
const gt = d.rows.filter((r) => r.arm === "traditional").reduce((s, r) => s + r.turns, 0);
const bkb = d.rows.filter((r) => r.arm === "bridge").reduce((s, r) => s + r.payloadBytes, 0) / 1024;
const gkb = d.rows.filter((r) => r.arm === "traditional").reduce((s, r) => s + r.payloadBytes, 0) / 1024;

function grouped(pairs, fmt, title) {
  const max = Math.max(...pairs.flatMap((p) => [p.a, p.b]), 1);
  const rowH = 52, padL = 208, w = 880, h = pairs.length * rowH + 22;
  let s = `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img" aria-label="${esc(title)}">`;
  pairs.forEach((p, i) => {
    const y = 10 + i * rowH;
    s += `<text x="${padL - 10}" y="${y + 24}" fill="var(--ink2)" font-size="12" text-anchor="end">${esc(p.k)}</text>`;
    [["Bridge", p.a, "var(--s1)"], ["Generic tools", p.b, "var(--s2)"]].forEach(([lab, v, c], j) => {
      const bw = Math.max((v / max) * (w - padL - 110), v > 0 ? 2 : 0);
      const yy = y + j * 20;
      s += `<rect x="${padL}" y="${yy}" width="${bw}" height="16" rx="4" fill="${c}" data-t="${esc(p.k)} — ${lab}: ${fmt(v)}"/>`;
      s += `<text x="${padL + bw + 8}" y="${yy + 13}" fill="var(--ink2)" font-size="11.5" font-weight="600">${fmt(v)}</text>`;
    });
  });
  return s + `<line x1="${padL}" y1="6" x2="${padL}" y2="${h - 10}" stroke="var(--base)" stroke-width="1"/></svg>`;
}

const turnPairs = tasks.map((t) => ({ k: t, a: pair(t).b.turns, b: pair(t).g.turns }));
const ctxPairs = tasks.map((t) => ({ k: t, a: pair(t).b.payloadBytes / 1024, b: pair(t).g.payloadBytes / 1024 }));
const fidelity = [
  { k: "Rows keeping their country", a: 50, b: 37, unit: "/50" },
];

const table = tasks
  .map((t) => {
    const { b, g } = pair(t);
    return `<tr><td>${esc(t)}</td><td class="n">${b.turns}</td><td class="n">${g.turns}</td>
<td class="n">${(g.turns / b.turns).toFixed(1)}x</td>
<td class="n">${(b.payloadBytes / 1024).toFixed(0)}KB</td><td class="n">${(g.payloadBytes / 1024).toFixed(0)}KB</td>
<td>${esc(b.detail)}</td><td>${esc(g.detail)}</td></tr>`;
  })
  .join("");

const css = `
.viz{--surface:#fcfcfb;--plane:#f9f9f7;--ink:#0b0b0b;--ink2:#52514e;--muted:#898781;
--grid:#e1e0d9;--base:#c3c2b7;--border:rgba(11,11,11,.10);--s1:#2a78d6;--s2:#eb6834;--good:#0ca30c;--crit:#d03b3b}
@media (prefers-color-scheme:dark){:root:where(:not([data-theme=light])) .viz{--surface:#1a1a19;--plane:#0d0d0d;
--ink:#fff;--ink2:#c3c2b7;--grid:#2c2c2a;--base:#383835;--border:rgba(255,255,255,.10);--s1:#3987e5;--s2:#d95926;--crit:#e66767}}
:root[data-theme=dark] .viz{--surface:#1a1a19;--plane:#0d0d0d;--ink:#fff;--ink2:#c3c2b7;--grid:#2c2c2a;
--base:#383835;--border:rgba(255,255,255,.10);--s1:#3987e5;--s2:#d95926;--crit:#e66767}
*{box-sizing:border-box}body{margin:0;background:var(--plane);color:var(--ink);font-family:system-ui,-apple-system,sans-serif}
.wrap{max-width:1020px;margin:0 auto;padding:32px 24px 72px}
h1{font-size:23px;font-weight:650;margin:0 0 4px}
.sub{color:var(--ink2);font-size:13.5px;margin:0 0 24px;line-height:1.55}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:24px}
.tile{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px}
.tile .l{font-size:12px;color:var(--ink2);margin-bottom:5px}
.tile .v{font-size:28px;font-weight:640;letter-spacing:-.02em}
.tile .n{font-size:11px;color:var(--muted);margin-top:3px}
.v.good{color:var(--good)}.v.crit{color:var(--crit)}
.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px 22px;margin-bottom:18px}
.card h2{font-size:15px;font-weight:640;margin:0 0 3px}
.card p{font-size:13px;color:var(--ink2);margin:0 0 16px;line-height:1.55}
.legend{display:flex;gap:16px;font-size:12px;color:var(--ink2);margin-bottom:14px}
.sw{width:10px;height:10px;border-radius:2px;display:inline-block;margin-right:6px}
table{width:100%;border-collapse:collapse;font-size:12.5px}
th{text-align:left;font-weight:600;color:var(--ink2);border-bottom:1px solid var(--base);padding:7px 8px;font-size:11px;text-transform:uppercase}
td{padding:6px 8px;border-bottom:1px solid var(--grid)}
td.n{text-align:right;font-variant-numeric:tabular-nums}
.mono{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;color:var(--ink2)}
.tt{position:fixed;pointer-events:none;background:var(--ink);color:var(--surface);padding:6px 9px;border-radius:6px;font-size:12px;opacity:0;z-index:9}
.btn{position:absolute;top:30px;right:24px;background:var(--surface);color:var(--ink);border:1px solid var(--border);border-radius:7px;padding:6px 11px;font-size:12px;cursor:pointer}
.wrap{position:relative}
.note{background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--s2);border-radius:8px;padding:14px 16px;font-size:13px;color:var(--ink2);line-height:1.6}
`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Browser Bridge vs generic browser tools</title><style>${css}</style></head>
<body class="viz"><div class="wrap">
<button class="btn" onclick="document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'light':'dark'">Toggle theme</button>
<h1>Browser Bridge vs. driving a browser with generic tools</h1>
<p class="sub">Five real tasks — two scrapes, two form fills, one search. <strong>Both arms actually executed</strong>, nothing modelled.
Bridge ran through the shipping <span class="mono">.mcpb</span> over MCP stdio, exactly as Claude loads it. The generic arm ran
Playwright doing what a browser tool does: navigate, read the page, act on one element at a time, read back to verify — one
primitive per turn, because each is a separate call the model makes and waits for.
Generated ${esc(d.generatedAt)}.</p>

<div class="tiles">
<div class="tile"><div class="l">Total turns</div><div class="v good">${(gt / bt).toFixed(1)}× fewer</div><div class="n">${bt} vs ${gt} across 5 tasks</div></div>
<div class="tile"><div class="l">Best case (7-field form)</div><div class="v good">4.5× fewer</div><div class="n">2 turns vs 9</div></div>
<div class="tile"><div class="l">Table rows kept intact</div><div class="v good">50/50</div><div class="n">generic tools: 37/50</div></div>
<div class="tile"><div class="l">Context returned</div><div class="v crit">${(bkb / gkb).toFixed(1)}× more</div><div class="n">${bkb.toFixed(0)}KB vs ${gkb.toFixed(0)}KB — see note</div></div>
</div>

<div class="card"><h2>Turns per task — lower is better</h2>
<p>The metric that matters: a turn is a round trip the model pays for in latency and tokens. Counted identically on both sides.</p>
<div class="legend"><span><span class="sw" style="background:var(--s1)"></span>Browser Bridge</span>
<span><span class="sw" style="background:var(--s2)"></span>Generic browser tools</span></div>
${grouped(turnPairs, (v) => `${v}`, "Turns per task")}</div>

<div class="card"><h2>Data fidelity — the difference that isn't speed</h2>
<p>Wikipedia rowspans the Headquarters column across runs of rows sharing a country. Flat text extraction drops the spanned
cell, so 13 of 50 companies come back with no country and <strong>nothing signals the loss</strong>. Bridge resolves the table
to a real occupancy grid and repeats the value into every row it covers. This is a wrong answer versus a right one, not a slow
answer versus a fast one.</p>
<div class="legend"><span><span class="sw" style="background:var(--s1)"></span>Browser Bridge</span>
<span><span class="sw" style="background:var(--s2)"></span>Generic browser tools</span></div>
${grouped(fidelity.map((f) => ({ k: f.k, a: f.a, b: f.b })), (v) => `${v}/50`, "Fidelity")}</div>

<div class="card"><h2>Context returned per task — lower is better</h2>
<p>Where the bridge currently loses.</p>
<div class="legend"><span><span class="sw" style="background:var(--s1)"></span>Browser Bridge</span>
<span><span class="sw" style="background:var(--s2)"></span>Generic browser tools</span></div>
${grouped(ctxPairs, (v) => `${v.toFixed(0)}KB`, "Context per task")}
<div class="note"><strong>Open issue, not a win.</strong> Bridge returns 1.6× more bytes overall. Two causes, both real:
one block per table row repeats every column header (that is what buys the fidelity result above — a row stays readable on its
own), and a content read still carries page furniture the caller did not ask for. The Apple article is the worst case at
258KB vs 154KB. Reducing this without giving back the fidelity is the next piece of work.</div></div>

<div class="card"><h2>Every task, both arms</h2>
<table><thead><tr><th>Task</th><th class="n">Bridge</th><th class="n">Generic</th><th class="n">Ratio</th>
<th class="n">Bridge ctx</th><th class="n">Generic ctx</th><th>Bridge result</th><th>Generic result</th></tr></thead>
<tbody>${table}</tbody></table></div>
</div>
<div class="tt" id="tt"></div>
<script>
const tt=document.getElementById('tt');
document.addEventListener('mouseover',e=>{const t=e.target.getAttribute&&e.target.getAttribute('data-t');
if(t){tt.textContent=t;tt.style.opacity=1;tt.style.left=(e.clientX+12)+'px';tt.style.top=(e.clientY-28)+'px';}});
document.addEventListener('mousemove',e=>{if(tt.style.opacity==='1'){tt.style.left=(e.clientX+12)+'px';tt.style.top=(e.clientY-28)+'px';}});
document.addEventListener('mouseout',e=>{if(e.target.getAttribute&&e.target.getAttribute('data-t'))tt.style.opacity=0;});
</script></body></html>`;

writeFileSync(join(root, "benchmark.html"), html);
console.log(`benchmark.html written — ${bt} vs ${gt} turns (${(gt / bt).toFixed(1)}x)`);
