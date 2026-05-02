/**
 * uiux-generator — repo-ui-scan
 *
 * Pure-Node (zero-dep) scanner that walks a repository to discover the UI system
 * in use. Outputs:
 *   - design-tokens.json   (DTCG — Design Tokens Community Group format)
 *   - component-inventory.md
 *   - ui-scan-summary.json (raw findings, for style-guide-html.js to consume)
 *
 * Detects:
 *   - Tailwind config (tailwind.config.{js,ts,cjs,mjs})
 *   - CSS custom properties (`:root { --token: value }`)
 *   - SCSS/LESS variables (`$token: value` / `@token: value`)
 *   - Theme files (theme.{ts,js,json}, tokens.{ts,js,json}, colors.{ts,js})
 *   - Component inventory (React/Vue/Svelte/Angular) with usage counts
 *   - CSS-in-JS signatures (styled-components, emotion, stitches)
 *   - UI library imports (MUI, Chakra, Antd, Radix, shadcn/ui)
 *
 * CLI:
 *   node repo-ui-scan.js --repo <path> --out <dir> [--max-files 2000]
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ──────────────────────────────────────────────────────────────── constants

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', 'dist', 'build', 'out',
  'coverage', '.turbo', '.cache', '.parcel-cache', '.svelte-kit',
  '__pycache__', '.venv', 'venv', 'target', 'vendor',
]);

const CODE_EXT = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.vue', '.svelte', '.astro',
  '.css', '.scss', '.sass', '.less', '.pcss', '.postcss',
  '.json', '.html',
]);

const UI_LIBS = [
  { name: '@mui/material', label: 'Material UI' },
  { name: '@chakra-ui/react', label: 'Chakra UI' },
  { name: 'antd', label: 'Ant Design' },
  { name: '@radix-ui/', label: 'Radix UI' },
  { name: 'shadcn', label: 'shadcn/ui' },
  { name: '@headlessui/react', label: 'Headless UI' },
  { name: 'react-bootstrap', label: 'React Bootstrap' },
  { name: 'mantine', label: 'Mantine' },
  { name: 'styled-components', label: 'styled-components' },
  { name: '@emotion/', label: 'Emotion' },
  { name: '@stitches/', label: 'Stitches' },
  { name: 'tailwindcss', label: 'Tailwind CSS' },
  { name: 'tailwind-variants', label: 'Tailwind Variants' },
  { name: 'class-variance-authority', label: 'CVA' },
];

// ────────────────────────────────────────────────────────── file traversal

function walk(root, maxFiles = 2000) {
  const out = [];
  const stack = [root];
  let count = 0;
  while (stack.length && count < maxFiles) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { continue; }
    for (const e of entries) {
      if (IGNORE_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (CODE_EXT.has(ext) || e.name.startsWith('tailwind.config')) {
          out.push(full);
          count++;
          if (count >= maxFiles) break;
        }
      }
    }
  }
  return out;
}

function read(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}

// ──────────────────────────────────────────────────────── token extraction

// CSS custom properties: --token-name: value;
const CSS_VAR_RE = /--([a-zA-Z0-9-_]+)\s*:\s*([^;}{]+)[;}]/g;

// SCSS variables: $name: value;
const SCSS_VAR_RE = /\$([a-zA-Z0-9-_]+)\s*:\s*([^;{}]+);/g;

// LESS variables: @name: value;
const LESS_VAR_RE = /@([a-zA-Z0-9-_]+)\s*:\s*([^;{}]+);/g;

// Hex colors
const HEX_RE = /#([0-9a-fA-F]{3,8})\b/g;
// rgb/rgba
const RGB_RE = /rgba?\(\s*\d[\d\s,.%]+\)/g;
// hsl
const HSL_RE = /hsla?\(\s*\d[\d\s,.%]+\)/g;

function bumpMap(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function categorize(name, value) {
  const n = name.toLowerCase();
  const v = value.toLowerCase().trim();
  if (/color|bg|background|fg|foreground|text|border|accent|primary|secondary|surface|muted/.test(n)) return 'color';
  if (/font-family|font-stack/.test(n) || /serif|sans|mono/.test(v)) return 'fontFamily';
  if (/font-size|text-size|size/.test(n) && /px|rem|em/.test(v)) return 'fontSize';
  if (/font-weight|weight/.test(n)) return 'fontWeight';
  if (/line-height|leading/.test(n)) return 'lineHeight';
  if (/spacing|space|gap|gutter|padding|margin/.test(n)) return 'spacing';
  if (/radius|round|corner/.test(n)) return 'radius';
  if (/shadow|elevation/.test(n)) return 'shadow';
  if (/z-index|z-/.test(n)) return 'zIndex';
  if (/breakpoint|screen/.test(n)) return 'breakpoint';
  if (/duration|timing|transition|ease/.test(n)) return 'motion';
  // fall back by value shape
  if (/^#[0-9a-f]{3,8}$/i.test(v) || /^rgba?\(/.test(v) || /^hsla?\(/.test(v)) return 'color';
  if (/(px|rem|em|%)$/.test(v) && /^\d/.test(v)) return 'spacing';
  return 'other';
}

function scanCssText(text, file, bucket) {
  let m;
  while ((m = CSS_VAR_RE.exec(text)) != null) {
    const name = m[1]; const value = (m[2] || '').trim();
    if (!value) continue;
    const cat = categorize(name, value);
    (bucket[cat] ||= new Map());
    bucket[cat].set(name, { value, source: file, count: (bucket[cat].get(name)?.count || 0) + 1 });
  }
  CSS_VAR_RE.lastIndex = 0;

  let hex;
  while ((hex = HEX_RE.exec(text)) != null) bumpMap(bucket._rawColors ||= new Map(), `#${hex[1]}`);
  HEX_RE.lastIndex = 0;

  let rgb;
  while ((rgb = RGB_RE.exec(text)) != null) bumpMap(bucket._rawColors ||= new Map(), rgb[0]);
  RGB_RE.lastIndex = 0;

  while ((rgb = HSL_RE.exec(text)) != null) bumpMap(bucket._rawColors ||= new Map(), rgb[0]);
  HSL_RE.lastIndex = 0;
}

function scanScssText(text, file, bucket) {
  let m;
  while ((m = SCSS_VAR_RE.exec(text)) != null) {
    const name = m[1]; const value = (m[2] || '').trim();
    const cat = categorize(name, value);
    (bucket[cat] ||= new Map());
    bucket[cat].set(name, { value, source: file, count: (bucket[cat].get(name)?.count || 0) + 1 });
  }
  SCSS_VAR_RE.lastIndex = 0;
}

function scanLessText(text, file, bucket) {
  let m;
  while ((m = LESS_VAR_RE.exec(text)) != null) {
    const name = m[1]; const value = (m[2] || '').trim();
    const cat = categorize(name, value);
    (bucket[cat] ||= new Map());
    bucket[cat].set(name, { value, source: file, count: (bucket[cat].get(name)?.count || 0) + 1 });
  }
  LESS_VAR_RE.lastIndex = 0;
}

// ──────────────────────────────────────────────── Tailwind config parsing

function parseTailwindConfig(text, file) {
  // Regex-based (zero-dep) — catches common patterns; not a real JS parser.
  const out = { colors: {}, fontFamily: {}, spacing: {}, borderRadius: {}, boxShadow: {}, _source: file };
  const themeMatch = text.match(/theme\s*:\s*\{([\s\S]*?)\n\s*\}/);
  const extendMatch = text.match(/extend\s*:\s*\{([\s\S]*?)\n\s*\}/);
  const scope = (extendMatch && extendMatch[1]) || (themeMatch && themeMatch[1]) || text;

  function pluckBlock(key) {
    const re = new RegExp(key + '\\s*:\\s*\\{([\\s\\S]*?)\\n\\s*\\}');
    const m = scope.match(re);
    return m ? m[1] : '';
  }

  function parsePairs(block) {
    const pairs = {};
    const pairRe = /['"]?([\w-]+)['"]?\s*:\s*['"]([^'"]+)['"]/g;
    let m;
    while ((m = pairRe.exec(block)) != null) pairs[m[1]] = m[2];
    return pairs;
  }

  out.colors = parsePairs(pluckBlock('colors'));
  out.fontFamily = parsePairs(pluckBlock('fontFamily'));
  out.spacing = parsePairs(pluckBlock('spacing'));
  out.borderRadius = parsePairs(pluckBlock('borderRadius'));
  out.boxShadow = parsePairs(pluckBlock('boxShadow'));

  return out;
}

// ──────────────────────────────────────────────── component inventory

const COMP_SIG = [
  { ext: ['.jsx', '.tsx'], re: /export\s+(?:default\s+)?(?:const|function)\s+([A-Z][A-Za-z0-9_]*)/g, kind: 'react' },
  { ext: ['.tsx', '.jsx'], re: /const\s+([A-Z][A-Za-z0-9_]*)\s*(?:=|:)/g, kind: 'react' },
  { ext: ['.vue'], re: /<script[^>]*>[\s\S]*?<\/script>/g, kind: 'vue', nameFromFile: true },
  { ext: ['.svelte'], re: /.*/g, kind: 'svelte', nameFromFile: true },
];

function inferComponentsInFile(file, text, inventory, usages) {
  const ext = path.extname(file).toLowerCase();
  const baseName = path.basename(file, ext);

  // JSX/TSX components defined in this file
  if (ext === '.jsx' || ext === '.tsx') {
    const defRe = /(?:export\s+)?(?:default\s+)?(?:const|function|class)\s+([A-Z][A-Za-z0-9_]*)\s*(?:[:=(<]|extends)/g;
    let m;
    while ((m = defRe.exec(text)) != null) {
      const name = m[1];
      (inventory[name] ||= { count: 0, files: new Set(), kind: 'react' });
      inventory[name].count++;
      inventory[name].files.add(file);
    }
  }
  // Vue SFC — file name = component
  if (ext === '.vue' && /^[A-Z]/.test(baseName)) {
    (inventory[baseName] ||= { count: 0, files: new Set(), kind: 'vue' });
    inventory[baseName].count++;
    inventory[baseName].files.add(file);
  }
  // Svelte
  if (ext === '.svelte' && /^[A-Z]/.test(baseName)) {
    (inventory[baseName] ||= { count: 0, files: new Set(), kind: 'svelte' });
    inventory[baseName].count++;
    inventory[baseName].files.add(file);
  }

  // JSX usage occurrences: <ComponentName
  if (ext === '.jsx' || ext === '.tsx' || ext === '.vue' || ext === '.svelte') {
    const useRe = /<([A-Z][A-Za-z0-9_]*)/g;
    let u;
    while ((u = useRe.exec(text)) != null) {
      const name = u[1];
      usages[name] = (usages[name] || 0) + 1;
    }
  }
}

// ──────────────────────────────────────────────── package.json inspection

function readPackageJson(repoPath) {
  const p = path.join(repoPath, 'package.json');
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(read(p)); } catch { return null; }
}

function detectUiLibs(pkg) {
  if (!pkg) return [];
  const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
  const found = [];
  for (const lib of UI_LIBS) {
    for (const k of Object.keys(deps || {})) {
      if (k.startsWith(lib.name) || k === lib.name) {
        found.push({ name: lib.label, pkg: k, version: deps[k] });
        break;
      }
    }
  }
  return found;
}

// ──────────────────────────────────────────────── DTCG builder

function toDtcg(buckets, tailwind) {
  const out = {};

  function typeFor(cat) {
    if (cat === 'color') return 'color';
    if (cat === 'fontFamily') return 'fontFamily';
    if (cat === 'fontSize' || cat === 'spacing' || cat === 'radius') return 'dimension';
    if (cat === 'fontWeight') return 'fontWeight';
    if (cat === 'shadow') return 'shadow';
    if (cat === 'motion') return 'duration';
    return 'other';
  }

  function category(cat) {
    const keyMap = {
      color: 'color', fontFamily: 'typography/font-family', fontSize: 'typography/font-size',
      fontWeight: 'typography/font-weight', lineHeight: 'typography/line-height',
      spacing: 'spacing', radius: 'radius', shadow: 'shadow',
      zIndex: 'z-index', breakpoint: 'breakpoint', motion: 'motion', other: 'other',
    };
    return keyMap[cat] || cat;
  }

  function ensure(catPath) {
    const parts = catPath.split('/');
    let cursor = out;
    for (const p of parts) {
      cursor[p] = cursor[p] || {};
      cursor = cursor[p];
    }
    return cursor;
  }

  for (const [cat, map] of Object.entries(buckets)) {
    if (cat.startsWith('_')) continue;
    if (!(map instanceof Map)) continue;
    const group = ensure(category(cat));
    const t = typeFor(cat);
    // sort by count desc
    const sorted = [...map.entries()].sort((a, b) => (b[1].count || 0) - (a[1].count || 0));
    for (const [name, { value, count, source }] of sorted) {
      group[name] = { $value: value, $type: t, $extensions: { 'com.uiux-generator': { count, source: path.basename(source) } } };
    }
  }

  // Tailwind tokens
  if (tailwind) {
    if (Object.keys(tailwind.colors).length) {
      const g = ensure('color/tailwind');
      for (const [k, v] of Object.entries(tailwind.colors)) g[k] = { $value: v, $type: 'color' };
    }
    if (Object.keys(tailwind.fontFamily).length) {
      const g = ensure('typography/font-family/tailwind');
      for (const [k, v] of Object.entries(tailwind.fontFamily)) g[k] = { $value: v, $type: 'fontFamily' };
    }
    if (Object.keys(tailwind.spacing).length) {
      const g = ensure('spacing/tailwind');
      for (const [k, v] of Object.entries(tailwind.spacing)) g[k] = { $value: v, $type: 'dimension' };
    }
    if (Object.keys(tailwind.borderRadius).length) {
      const g = ensure('radius/tailwind');
      for (const [k, v] of Object.entries(tailwind.borderRadius)) g[k] = { $value: v, $type: 'dimension' };
    }
    if (Object.keys(tailwind.boxShadow).length) {
      const g = ensure('shadow/tailwind');
      for (const [k, v] of Object.entries(tailwind.boxShadow)) g[k] = { $value: v, $type: 'shadow' };
    }
  }

  return out;
}

// ──────────────────────────────────────────────── inventory markdown

function buildInventoryMd(inventory, usages, uiLibs, totalFiles, pkgName) {
  const lines = [];
  lines.push(`# Component Inventory`);
  lines.push('');
  lines.push(`> Generated by uiux-generator / repo-ui-scan`);
  if (pkgName) lines.push(`> Package: **${pkgName}**`);
  lines.push(`> Scanned **${totalFiles}** files across the repository.`);
  lines.push('');

  if (uiLibs.length) {
    lines.push(`## UI Libraries in Use`);
    lines.push('');
    lines.push('| Library | Package | Version |');
    lines.push('|---|---|---|');
    for (const l of uiLibs) lines.push(`| ${l.name} | \`${l.pkg}\` | \`${l.version}\` |`);
    lines.push('');
  } else {
    lines.push(`## UI Libraries in Use`);
    lines.push('');
    lines.push('No UI library detected from `package.json`. The project appears to use custom components.');
    lines.push('');
  }

  const components = Object.entries(inventory);
  if (components.length === 0) {
    lines.push(`## Components`);
    lines.push('');
    lines.push('No React/Vue/Svelte components detected.');
    return lines.join('\n') + '\n';
  }

  // Sort by usage count (desc). Accept both the raw form (Set of files) and
  // the plain JSON form (array of files + embedded usage count).
  const withUsage = components.map(([name, info]) => {
    const files = (info.files && info.files.size) != null
      ? info.files.size
      : (Array.isArray(info.files) ? info.files.length : info.filesCount || 0);
    const usage = usages[name] != null ? usages[name] : (info.usage || 0);
    return { name, definitions: info.count || 0, files, kind: info.kind, usage };
  }).sort((a, b) => b.usage - a.usage);

  lines.push(`## Components (${withUsage.length})`);
  lines.push('');
  lines.push('Ordered by usage frequency (how often the component is referenced across the codebase).');
  lines.push('');
  lines.push('| Component | Kind | Defined in | Usage |');
  lines.push('|---|---|---:|---:|');
  for (const c of withUsage.slice(0, 60)) {
    lines.push(`| \`${c.name}\` | ${c.kind} | ${c.files} file${c.files === 1 ? '' : 's'} | ${c.usage} |`);
  }
  if (withUsage.length > 60) lines.push(`\n_… ${withUsage.length - 60} more components truncated from this table._`);
  lines.push('');

  // Top-used
  const top = withUsage.filter(c => c.usage > 0).slice(0, 10);
  if (top.length) {
    lines.push(`## Top 10 Most-Used Components`);
    lines.push('');
    for (const c of top) lines.push(`- **${c.name}** — ${c.usage} references`);
    lines.push('');
  }

  return lines.join('\n') + '\n';
}

// ──────────────────────────────────────────────── palette inference

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  if (h.length === 3) {
    return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16) };
  }
  if (h.length >= 6) {
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }
  return null;
}

function luminance({ r, g, b }) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function saturation({ r, g, b }) {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  return max === 0 ? 0 : (max - min) / max;
}

function inferPaletteFromColors(rawColors) {
  const scored = [];
  for (const [color, count] of rawColors.entries()) {
    if (!color.startsWith('#')) continue;
    const rgb = hexToRgb(color);
    if (!rgb) continue;
    scored.push({ color, count, lum: luminance(rgb), sat: saturation(rgb) });
  }
  scored.sort((a, b) => b.count - a.count);

  const palette = {};
  // primary = most frequent high-saturation color
  palette.primary = (scored.find(c => c.sat > 0.3 && c.lum < 0.8 && c.lum > 0.1) || scored[0] || {}).color;
  // background = lightest, most-used
  palette.background = (scored.find(c => c.lum > 0.9) || scored.slice().sort((a, b) => b.lum - a.lum)[0] || {}).color;
  // text = darkest most-used
  palette.text = (scored.find(c => c.lum < 0.25) || scored.slice().sort((a, b) => a.lum - b.lum)[0] || {}).color;
  // accent = a different saturated color
  palette.accent = (scored.find(c => c.sat > 0.3 && c.color !== palette.primary) || {}).color;
  // strip nulls
  for (const k of Object.keys(palette)) if (!palette[k]) delete palette[k];
  return palette;
}

// ──────────────────────────────────────────────── main audit

function auditRepo(repoPath, opts = {}) {
  const maxFiles = opts.maxFiles || 2000;
  const files = walk(repoPath, maxFiles);

  const buckets = {};
  const inventory = {};
  const usages = {};
  let tailwind = null;
  let tailwindFile = null;

  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    const rel = path.relative(repoPath, f);
    const base = path.basename(f);
    const text = read(f);
    if (!text) continue;

    // Tailwind config
    if (base.startsWith('tailwind.config')) {
      tailwind = parseTailwindConfig(text, rel);
      tailwindFile = rel;
    }

    // CSS-like
    if (ext === '.css' || ext === '.pcss' || ext === '.postcss') {
      scanCssText(text, rel, buckets);
    } else if (ext === '.scss' || ext === '.sass') {
      scanCssText(text, rel, buckets);
      scanScssText(text, rel, buckets);
    } else if (ext === '.less') {
      scanCssText(text, rel, buckets);
      scanLessText(text, rel, buckets);
    }

    // Components / usages
    if (['.jsx', '.tsx', '.vue', '.svelte'].includes(ext)) {
      inferComponentsInFile(rel, text, inventory, usages);
      // Styled-components / emotion blocks can contain CSS vars
      scanCssText(text, rel, buckets);
    }

    // Theme files
    if (/^(theme|tokens|colors?|design-tokens)\.(ts|tsx|js|mjs|cjs|json)$/.test(base)) {
      scanCssText(text, rel, buckets);
      // Loose JSON/JS pair extraction
      const pairRe = /['"]?([a-zA-Z0-9_-]+)['"]?\s*:\s*['"]([^'"]+)['"]/g;
      let m;
      while ((m = pairRe.exec(text)) != null) {
        const k = m[1], v = m[2];
        if (/^#[0-9a-f]{3,8}$/i.test(v) || /^rgba?\(/i.test(v) || /^hsla?\(/i.test(v)) {
          (buckets.color ||= new Map());
          buckets.color.set(k, { value: v, source: rel, count: (buckets.color.get(k)?.count || 0) + 1 });
        }
      }
    }
  }

  const pkg = readPackageJson(repoPath);
  const uiLibs = detectUiLibs(pkg);

  // convert internal Maps to plain objects for JSON
  const inventoryPlain = {};
  for (const [name, info] of Object.entries(inventory)) {
    inventoryPlain[name] = {
      count: info.count, files: [...info.files], kind: info.kind, usage: usages[name] || 0,
    };
  }

  const rawColors = buckets._rawColors || new Map();
  const palette = inferPaletteFromColors(rawColors);

  const dtcg = toDtcg(buckets, tailwind);

  // Bucket summary counts (Maps → plain counts)
  const bucketSummary = {};
  for (const [k, v] of Object.entries(buckets)) {
    if (k.startsWith('_')) continue;
    if (v instanceof Map) bucketSummary[k] = v.size;
  }

  return {
    repo: repoPath,
    scannedAt: new Date().toISOString(),
    totalFiles: files.length,
    package: pkg ? { name: pkg.name, version: pkg.version } : null,
    uiLibs,
    tailwind: tailwind ? { source: tailwindFile, ...tailwind } : null,
    buckets: bucketSummary,
    rawColorCount: rawColors.size,
    palette,
    components: inventoryPlain,
    dtcg,
  };
}

// ──────────────────────────────────────────────── save helpers

function saveAudit(audit, outDir) {
  fs.mkdirSync(outDir, { recursive: true });

  const tokensPath = path.join(outDir, 'design-tokens.json');
  fs.writeFileSync(tokensPath, JSON.stringify(audit.dtcg, null, 2));

  const invPath = path.join(outDir, 'component-inventory.md');
  fs.writeFileSync(invPath, buildInventoryMd(
    audit.components, {}, audit.uiLibs, audit.totalFiles,
    audit.package ? audit.package.name : null
  ));

  const summaryPath = path.join(outDir, 'ui-scan-summary.json');
  // Strip component file lists to keep summary lean
  const leanComponents = {};
  for (const [k, v] of Object.entries(audit.components)) {
    leanComponents[k] = { count: v.count, filesCount: v.files.length, kind: v.kind, usage: v.usage };
  }
  const summary = { ...audit, components: leanComponents, dtcg: undefined };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  return { tokens: tokensPath, inventory: invPath, summary: summaryPath };
}

// ──────────────────────────────────────────────── CLI

function parseArgs(argv) {
  const out = { maxFiles: 2000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') out.repo = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--max-files') out.maxFiles = parseInt(argv[++i], 10) || 2000;
    else if (a === '-h' || a === '--help') out.help = true;
  }
  return out;
}

function printHelp() {
  console.log(`
repo-ui-scan — scan a codebase for design tokens and components

Usage:
  node repo-ui-scan.js --repo <path> --out <dir> [--max-files 2000]

Outputs:
  <out>/design-tokens.json       DTCG-format token tree
  <out>/component-inventory.md   Components ordered by usage
  <out>/ui-scan-summary.json     Raw findings (feeds style-guide-html.js)
`);
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.repo || !args.out) { printHelp(); process.exit(args.help ? 0 : 1); }
  const audit = auditRepo(path.resolve(args.repo), { maxFiles: args.maxFiles });
  const paths = saveAudit(audit, path.resolve(args.out));
  console.log(`Scanned ${audit.totalFiles} files in ${audit.repo}`);
  console.log(`UI libs: ${audit.uiLibs.map(l => l.name).join(', ') || 'none detected'}`);
  console.log(`Tokens extracted: ${Object.entries(audit.buckets).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}`);
  console.log(`Components: ${Object.keys(audit.components).length}`);
  console.log(`Palette:`, audit.palette);
  console.log('\nWritten:');
  for (const [k, p] of Object.entries(paths)) console.log(`  ${k.padEnd(10)} ${p}`);
}

module.exports = {
  auditRepo,
  saveAudit,
  walk,
  parseTailwindConfig,
  inferPaletteFromColors,
  toDtcg,
};
