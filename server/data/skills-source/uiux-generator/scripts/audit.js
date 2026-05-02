/**
 * uiux-generator — audit
 *
 * CLI wrapper around lib/repo-ui-scan.js + lib/style-guide-html.js.
 * Scans a repo, extracts design tokens + component inventory, and renders a
 * style-guide.html — the full "receipts" document for a UI designer role.
 *
 * Usage:
 *   node audit.js --repo <path> --out <dir>
 *   node audit.js --repo . --out ./ui-audit
 *
 * Output:
 *   <out>/design-tokens.json      DTCG-format token tree
 *   <out>/component-inventory.md  Components ranked by usage
 *   <out>/ui-scan-summary.json    Raw findings
 *   <out>/style-guide.html        Visual style guide
 */

'use strict';

const fs = require('fs');
const path = require('path');
const scanner = require('./lib/repo-ui-scan');
const guide = require('./lib/style-guide-html');

function parseArgs(argv) {
  const out = { maxFiles: 2000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') out.repo = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--max-files') out.maxFiles = parseInt(argv[++i], 10) || 2000;
    else if (a === '--skip-guide') out.skipGuide = true;
    else if (a === '-h' || a === '--help') out.help = true;
  }
  return out;
}

function printHelp() {
  console.log(`
audit — scan a repo for design tokens & components, then render a style guide

Usage:
  node audit.js --repo <path> --out <dir> [--max-files 2000] [--skip-guide]

Output:
  <out>/design-tokens.json      DTCG
  <out>/component-inventory.md  Components by usage
  <out>/ui-scan-summary.json    Raw audit
  <out>/style-guide.html        Visual guide (unless --skip-guide)
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.repo || !args.out) { printHelp(); process.exit(args.help ? 0 : 1); }

  const repo = path.resolve(args.repo);
  const outDir = path.resolve(args.out);
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`Auditing ${repo} → ${outDir}`);
  const audit = scanner.auditRepo(repo, { maxFiles: args.maxFiles });
  const paths = scanner.saveAudit(audit, outDir);

  if (!args.skipGuide) {
    paths.styleGuide = guide.saveStyleGuide(audit, outDir);
  }

  console.log(`\nFiles scanned:    ${audit.totalFiles}`);
  console.log(`UI libraries:     ${audit.uiLibs.map(l => l.name).join(', ') || 'none'}`);
  console.log(`Tailwind config:  ${audit.tailwind ? audit.tailwind.source : 'no'}`);
  console.log(`Token buckets:    ${Object.entries(audit.buckets).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}`);
  console.log(`Components:       ${Object.keys(audit.components).length}`);
  console.log(`Inferred palette: ${JSON.stringify(audit.palette || {})}`);

  console.log('\nWritten:');
  for (const [k, p] of Object.entries(paths)) console.log(`  ${k.padEnd(12)} ${p}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
