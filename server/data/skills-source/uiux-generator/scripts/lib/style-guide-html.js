/**
 * uiux-generator — style-guide-html
 *
 * Renders a self-contained `style-guide.html` from the audit produced by
 * repo-ui-scan.js. The guide is the "receipts" document a designer hands to
 * engineering: palette, typography, spacing, radii, shadows, component gallery.
 *
 * Zero runtime deps. All styling is inline. No external requests on open.
 *
 * Usage (library):
 *   const { renderStyleGuide, saveStyleGuide } = require('./style-guide-html');
 *   saveStyleGuide(audit, '/path/to/out');
 *
 * Usage (CLI):
 *   node style-guide-html.js --audit <audit.json> --out <dir>
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ────────────────────────────────────────────────────────── helpers

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function flattenDtcg(dtcg, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(dtcg || {})) {
    if (!v || typeof v !== 'object') continue;
    if (Object.prototype.hasOwnProperty.call(v, '$value')) {
      out.push({ path: (prefix ? prefix + '/' : '') + k, name: k, value: v.$value, type: v.$type, ext: v.$extensions || {} });
    } else {
      out.push(...flattenDtcg(v, (prefix ? prefix + '/' : '') + k));
    }
  }
  return out;
}

function groupBy(arr, keyFn) {
  const map = new Map();
  for (const item of arr) {
    const k = keyFn(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  }
  return map;
}

function colorLabel(v) {
  return String(v).trim();
}

function isLight(hex) {
  if (!/^#[0-9a-fA-F]{3,8}$/.test(hex)) return false;
  const h = hex.replace('#', '');
  const r = parseInt(h.length === 3 ? h[0] + h[0] : h.slice(0, 2), 16);
  const g = parseInt(h.length === 3 ? h[1] + h[1] : h.slice(2, 4), 16);
  const b = parseInt(h.length === 3 ? h[2] + h[2] : h.slice(4, 6), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.6;
}

// ────────────────────────────────────────────────────────── sections

function palettePanel(palette) {
  const keys = ['primary', 'accent', 'background', 'text'];
  const cards = keys.filter(k => palette && palette[k]).map(k => {
    const v = palette[k];
    const fg = isLight(v) ? '#111' : '#fff';
    return `<div class="chip" style="background:${esc(v)};color:${fg}">
      <div class="chip-role">${esc(k)}</div>
      <div class="chip-value">${esc(colorLabel(v))}</div>
    </div>`;
  }).join('\n');
  if (!cards) return '<p class="muted">Palette could not be inferred — try running against the repo root.</p>';
  return `<div class="chip-row">${cards}</div>`;
}

function colorSwatches(tokens) {
  const colors = tokens.filter(t => t.type === 'color' || /^#[0-9a-f]{3,8}$/i.test(t.value) || /^rgba?\(/i.test(t.value) || /^hsla?\(/i.test(t.value));
  if (!colors.length) return '<p class="muted">No color tokens extracted.</p>';
  // dedupe by value
  const seen = new Map();
  for (const c of colors) if (!seen.has(c.value)) seen.set(c.value, c);
  const items = [...seen.values()].map(c => {
    const fg = isLight(c.value) ? '#111' : '#fff';
    return `<div class="swatch">
      <div class="swatch-block" style="background:${esc(c.value)};color:${fg}">${esc(c.value)}</div>
      <div class="swatch-name">${esc(c.name)}</div>
      <div class="swatch-path">${esc(c.path)}</div>
    </div>`;
  }).join('');
  return `<div class="swatch-grid">${items}</div>`;
}

function typographySpecimens(tokens) {
  const families = tokens.filter(t => t.type === 'fontFamily');
  const sizes = tokens.filter(t => t.path.includes('font-size') || /font[-_]?size/i.test(t.name));
  if (!families.length && !sizes.length) return '<p class="muted">No typography tokens extracted.</p>';
  const famBlock = families.length
    ? `<div class="typo-grid">${families.map(f => `
        <div class="typo-card">
          <div class="typo-name">${esc(f.name)}</div>
          <div class="typo-sample" style="font-family:${esc(f.value)}">The quick brown fox jumps over the lazy dog</div>
          <div class="typo-value">${esc(f.value)}</div>
        </div>`).join('')}</div>`
    : '';
  const sizeBlock = sizes.length
    ? `<div class="size-scale">${sizes.slice(0, 10).map(s => `
        <div class="size-row">
          <div class="size-value">${esc(s.value)}</div>
          <div class="size-sample" style="font-size:${esc(s.value)}">${esc(s.name)}</div>
        </div>`).join('')}</div>`
    : '';
  return famBlock + sizeBlock;
}

function spacingScale(tokens) {
  const sp = tokens.filter(t => /spacing/.test(t.path) || t.type === 'dimension' && /^\d/.test(String(t.value)));
  if (!sp.length) return '<p class="muted">No spacing tokens extracted.</p>';
  const seen = new Map();
  for (const t of sp) if (!seen.has(t.value)) seen.set(t.value, t);
  const items = [...seen.values()].slice(0, 16).map(t => `
    <div class="space-row">
      <div class="space-name">${esc(t.name)}</div>
      <div class="space-bar" style="width:${esc(t.value)}"></div>
      <div class="space-value">${esc(t.value)}</div>
    </div>`).join('');
  return `<div class="space-stack">${items}</div>`;
}

function radiusScale(tokens) {
  const rs = tokens.filter(t => /radius/.test(t.path) || /radius/i.test(t.name));
  if (!rs.length) return '<p class="muted">No radius tokens extracted.</p>';
  const seen = new Map();
  for (const t of rs) if (!seen.has(t.value)) seen.set(t.value, t);
  const items = [...seen.values()].map(t => `
    <div class="radius-card">
      <div class="radius-tile" style="border-radius:${esc(t.value)}"></div>
      <div class="radius-name">${esc(t.name)}</div>
      <div class="radius-value">${esc(t.value)}</div>
    </div>`).join('');
  return `<div class="radius-grid">${items}</div>`;
}

function shadowScale(tokens) {
  const sh = tokens.filter(t => t.type === 'shadow' || /shadow/i.test(t.name));
  if (!sh.length) return '<p class="muted">No shadow tokens extracted.</p>';
  const items = sh.slice(0, 8).map(t => `
    <div class="shadow-card">
      <div class="shadow-tile" style="box-shadow:${esc(t.value)}"></div>
      <div class="shadow-name">${esc(t.name)}</div>
      <div class="shadow-value">${esc(t.value)}</div>
    </div>`).join('');
  return `<div class="shadow-grid">${items}</div>`;
}

function componentGallery(audit) {
  const comps = Object.entries(audit.components || {})
    .map(([n, info]) => ({ name: n, ...info }))
    .sort((a, b) => (b.usage || 0) - (a.usage || 0));
  if (!comps.length) return '<p class="muted">No components detected.</p>';
  const top = comps.slice(0, 40);
  const rows = top.map(c => `
    <tr>
      <td><code>${esc(c.name)}</code></td>
      <td>${esc(c.kind)}</td>
      <td style="text-align:right">${c.filesCount || (c.files && c.files.length) || 1}</td>
      <td style="text-align:right">${c.usage || 0}</td>
    </tr>`).join('');
  return `<table class="comp-table">
    <thead><tr><th>Component</th><th>Kind</th><th>Files</th><th>Usage</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function recommendationsPanel(audit) {
  const recs = [];
  const bucketCounts = audit.buckets || {};
  if (!bucketCounts.color || bucketCounts.color < 3) {
    recs.push('Only a handful of named color tokens were found. Consider extracting primary/secondary/neutral scales into a `--tokens.css` or theme file so colors can be changed in one place.');
  }
  if (bucketCounts.color > 40) {
    recs.push(`A large color token surface (${bucketCounts.color}) suggests drift. Audit the palette for near-duplicates (e.g. \`#007aff\` vs \`#0079fc\`) and collapse into a canonical scale.`);
  }
  if (!bucketCounts.radius) {
    recs.push('No radius tokens found. Consider defining `--radius-sm`, `--radius-md`, `--radius-lg` so card/button corners stay consistent.');
  }
  if (!bucketCounts.shadow) {
    recs.push('No shadow tokens found. A documented elevation scale (sm / md / lg / xl) keeps surfaces legible and depth intentional.');
  }
  if (!audit.tailwind && (!audit.uiLibs || !audit.uiLibs.length)) {
    recs.push('No Tailwind config or UI library detected. For design consistency, consider adopting Tailwind + a component library (shadcn, Radix) or at least a token file.');
  }
  const compCount = Object.keys(audit.components || {}).length;
  if (compCount > 80) {
    recs.push(`High component count (${compCount}). Some may be duplicates or one-offs — worth a pass to consolidate and extract to a shared library.`);
  }
  if (audit.uiLibs && audit.uiLibs.length > 2) {
    recs.push(`Multiple UI libraries in use (${audit.uiLibs.map(l => l.name).join(', ')}). This commonly causes inconsistent visuals. Pick one canonical library and deprecate the others.`);
  }
  if (!recs.length) recs.push('No immediate recommendations — the design system appears reasonably consolidated.');
  return `<ul class="recs">${recs.map(r => `<li>${esc(r)}</li>`).join('')}</ul>`;
}

// ────────────────────────────────────────────────────────── css/html

const CSS = `
  :root {
    --bg: #f7f8fa;
    --surface: #ffffff;
    --border: #e6e8ee;
    --text: #111827;
    --muted: #6b7280;
    --primary: #2563eb;
    --accent: #14b8a6;
    --radius: 10px;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
         font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 32px 24px 64px; }
  header { display: flex; align-items: baseline; justify-content: space-between;
           padding-bottom: 20px; border-bottom: 1px solid var(--border); margin-bottom: 28px; }
  header h1 { margin: 0; font-size: 24px; }
  header .meta { color: var(--muted); font-size: 13px; }
  h2 { margin: 36px 0 14px; font-size: 18px; border-left: 3px solid var(--primary); padding-left: 10px; }
  section { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px 22px; }
  .muted { color: var(--muted); }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }

  /* Palette chips */
  .chip-row { display: grid; grid-template-columns: repeat(auto-fill,minmax(180px,1fr)); gap: 12px; }
  .chip { border-radius: 10px; padding: 20px 14px; min-height: 110px; display: flex; flex-direction: column; justify-content: space-between; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
  .chip-role { font-weight: 600; text-transform: uppercase; letter-spacing: .06em; font-size: 11px; opacity: .85; }
  .chip-value { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }

  /* Swatches */
  .swatch-grid { display: grid; grid-template-columns: repeat(auto-fill,minmax(150px,1fr)); gap: 10px; }
  .swatch { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; background: #fff; }
  .swatch-block { padding: 26px 12px; font-family: ui-monospace, monospace; font-size: 12px; text-align: center; }
  .swatch-name { padding: 6px 10px 2px; font-weight: 600; font-size: 13px; }
  .swatch-path { padding: 0 10px 6px; color: var(--muted); font-size: 11px; }

  /* Typography */
  .typo-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .typo-card { border: 1px solid var(--border); border-radius: 8px; padding: 14px; }
  .typo-name { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
  .typo-sample { font-size: 18px; margin: 8px 0 6px; }
  .typo-value { font-family: ui-monospace, monospace; color: var(--muted); font-size: 12px; }
  .size-scale { margin-top: 16px; border-top: 1px solid var(--border); padding-top: 16px; }
  .size-row { display: grid; grid-template-columns: 80px 1fr; gap: 12px; align-items: baseline; margin-bottom: 6px; }
  .size-value { color: var(--muted); font-family: ui-monospace, monospace; font-size: 12px; }

  /* Spacing */
  .space-stack { display: flex; flex-direction: column; gap: 6px; }
  .space-row { display: grid; grid-template-columns: 180px 1fr 80px; gap: 10px; align-items: center; }
  .space-name { font-family: ui-monospace, monospace; font-size: 12px; color: var(--muted); }
  .space-bar { height: 14px; background: var(--primary); border-radius: 3px; max-width: 100%; }
  .space-value { font-family: ui-monospace, monospace; font-size: 12px; text-align: right; }

  /* Radius & shadow */
  .radius-grid, .shadow-grid { display: grid; grid-template-columns: repeat(auto-fill,minmax(140px,1fr)); gap: 14px; }
  .radius-card, .shadow-card { text-align: center; padding: 10px; }
  .radius-tile, .shadow-tile { width: 100%; aspect-ratio: 1/1; background: var(--primary); margin: 0 auto 8px; }
  .shadow-tile { background: #fff; }
  .radius-name, .shadow-name { font-size: 13px; font-weight: 600; }
  .radius-value, .shadow-value { color: var(--muted); font-family: ui-monospace, monospace; font-size: 11px; word-break: break-all; }

  /* Components */
  .comp-table { width: 100%; border-collapse: collapse; }
  .comp-table th, .comp-table td { padding: 8px 10px; border-bottom: 1px solid var(--border); text-align: left; font-size: 14px; }
  .comp-table th { background: #f3f4f6; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }

  /* Recs */
  .recs { margin: 0; padding: 0 0 0 22px; }
  .recs li { margin-bottom: 8px; }

  .summary-grid { display: grid; grid-template-columns: repeat(auto-fill,minmax(140px,1fr)); gap: 10px; }
  .summary-card { border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; }
  .summary-label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .06em; }
  .summary-value { font-size: 22px; font-weight: 600; margin-top: 4px; }
`;

function renderStyleGuide(audit) {
  const tokens = flattenDtcg(audit.dtcg || {});
  const palette = audit.palette || {};
  const scanned = audit.totalFiles || 0;
  const compCount = Object.keys(audit.components || {}).length;
  const pkgName = (audit.package && audit.package.name) || 'Unnamed project';

  const summary = `
    <div class="summary-grid">
      <div class="summary-card"><div class="summary-label">Files scanned</div><div class="summary-value">${scanned}</div></div>
      <div class="summary-card"><div class="summary-label">Color tokens</div><div class="summary-value">${audit.buckets?.color || 0}</div></div>
      <div class="summary-card"><div class="summary-label">Components</div><div class="summary-value">${compCount}</div></div>
      <div class="summary-card"><div class="summary-label">UI libraries</div><div class="summary-value">${(audit.uiLibs || []).length}</div></div>
      <div class="summary-card"><div class="summary-label">Tailwind</div><div class="summary-value">${audit.tailwind ? 'Yes' : 'No'}</div></div>
    </div>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Style Guide — ${esc(pkgName)}</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>${CSS}</style>
</head>
<body>
  <div class="wrap">
    <header>
      <div>
        <h1>Style Guide — ${esc(pkgName)}</h1>
        <div class="meta">Generated ${esc(audit.scannedAt || '')} · by uiux-generator</div>
      </div>
    </header>

    <section>
      <h2 style="margin-top:0">Overview</h2>
      ${summary}
    </section>

    <section>
      <h2>Inferred Palette</h2>
      <p class="muted">Primary, accent, background, and text roles inferred from color frequency + luminance heuristics. Verify with design lead before publishing.</p>
      ${palettePanel(palette)}
    </section>

    <section>
      <h2>Color Tokens</h2>
      ${colorSwatches(tokens)}
    </section>

    <section>
      <h2>Typography</h2>
      ${typographySpecimens(tokens)}
    </section>

    <section>
      <h2>Spacing Scale</h2>
      ${spacingScale(tokens)}
    </section>

    <section class="grid-2">
      <div>
        <h2 style="margin-top:0">Radius</h2>
        ${radiusScale(tokens)}
      </div>
      <div>
        <h2 style="margin-top:0">Shadow / Elevation</h2>
        ${shadowScale(tokens)}
      </div>
    </section>

    <section>
      <h2>Component Gallery</h2>
      ${componentGallery(audit)}
    </section>

    <section>
      <h2>Recommendations</h2>
      ${recommendationsPanel(audit)}
    </section>

  </div>
</body>
</html>
`;
}

function saveStyleGuide(audit, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const html = renderStyleGuide(audit);
  const p = path.join(outDir, 'style-guide.html');
  fs.writeFileSync(p, html);
  return p;
}

// ────────────────────────────────────────────────────────── CLI

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--audit') out.audit = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '-h' || a === '--help') out.help = true;
  }
  return out;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.audit || !args.out) {
    console.log(`
style-guide-html — render style-guide.html from a repo-ui-scan audit

Usage:
  node style-guide-html.js --audit <audit.json> --out <dir>
`);
    process.exit(args.help ? 0 : 1);
  }
  const audit = JSON.parse(fs.readFileSync(path.resolve(args.audit), 'utf8'));
  const p = saveStyleGuide(audit, path.resolve(args.out));
  console.log(`Wrote ${p}`);
}

module.exports = { renderStyleGuide, saveStyleGuide, flattenDtcg };
