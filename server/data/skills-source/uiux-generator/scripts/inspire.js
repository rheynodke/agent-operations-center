/**
 * uiux-generator — inspire
 *
 * CLI wrapper around lib/fetch-inspiration.js. Fetch 1..N URLs, extract UI
 * tokens (colors / typography / spacing / radii / shadows), optionally grab a
 * screenshot (if Playwright is available), and save an inspiration bundle.
 *
 * Usage:
 *   node inspire.js --urls https://linear.app,https://stripe.com --out ./out
 *   node inspire.js --urls https://linear.app --out ./out --no-screenshot
 *   node inspire.js --url https://stripe.com --out ./out --name stripe
 *
 * Output (per URL):
 *   <out>/<name>/inspiration.json
 *   <out>/<name>/inspiration.md
 *   <out>/<name>/screenshot.png   (only if Playwright is installed)
 */

'use strict';

const path = require('path');
const fs = require('fs');
const inspiration = require('./lib/fetch-inspiration');

function parseArgs(argv) {
  const out = { urls: [], screenshot: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url' || a === '--urls') {
      const v = argv[++i] || '';
      out.urls.push(...v.split(',').map(s => s.trim()).filter(Boolean));
    } else if (a === '--out') out.out = argv[++i];
    else if (a === '--name') out.name = argv[++i];
    else if (a === '--no-screenshot') out.screenshot = false;
    else if (a === '-h' || a === '--help') out.help = true;
  }
  return out;
}

function slugFromUrl(u) {
  try {
    const url = new URL(u);
    return (url.hostname + url.pathname).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 60);
  } catch { return 'site'; }
}

function printHelp() {
  console.log(`
inspire — fetch & analyze external UI for design inspiration

Usage:
  node inspire.js --urls <url1,url2> --out <dir> [--no-screenshot]
  node inspire.js --url <url> --out <dir> [--name <folder>]

Options:
  --urls <csv>       Comma-separated list of URLs to analyze
  --url  <url>       Shorthand for a single URL
  --out  <dir>       Output root (each URL gets its own subfolder)
  --name <string>    Override folder name for a single URL
  --no-screenshot    Skip Playwright screenshot (HTML+CSS only)

Notes:
  - HTML+CSS scraping is zero-dep.
  - Screenshot requires Playwright (\`npm i playwright\` + \`npx playwright install chromium\`).
    If not installed, the screenshot step is skipped gracefully.
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.urls.length || !args.out) { printHelp(); process.exit(args.help ? 0 : 1); }

  fs.mkdirSync(path.resolve(args.out), { recursive: true });

  for (const url of args.urls) {
    const name = args.urls.length === 1 && args.name ? args.name : slugFromUrl(url);
    const dir = path.join(path.resolve(args.out), name);
    console.log(`\n⟶ ${url}  →  ${dir}`);
    try {
      const analyzeOpts = {};
      if (args.screenshot) analyzeOpts.screenshotPath = path.join(dir, 'screenshot.png');
      fs.mkdirSync(dir, { recursive: true });
      const result = await inspiration.analyzeUrl(url, analyzeOpts);
      const out = inspiration.saveInspiration(result, dir);
      const palette = (result.tokens && result.tokens.palette) || {};
      console.log(`  palette: ${JSON.stringify(palette)}`);
      const t = result.tokens || {};
      console.log(`  tokens:  colors=${(t.colors || []).length} fonts=${(t.fonts || []).length} sizes=${(t.fontSizes || []).length}`);
      for (const [k, p] of Object.entries(out.files || {})) {
        if (p) console.log(`  ${k.padEnd(10)} ${p}`);
      }
    } catch (e) {
      console.error(`  ✖ ${e.message}`);
    }
  }
  console.log('\nDone.');
}

main().catch((e) => { console.error(e); process.exit(1); });
