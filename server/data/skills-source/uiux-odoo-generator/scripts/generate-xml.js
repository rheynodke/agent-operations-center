#!/usr/bin/env node
/**
 * uiux-odoo-generator — generate-xml.js
 *
 * Load a canvas spec (as produced by any odoo-renderer call or hand-written
 * JSON) and render an Odoo module scaffold:
 *   <out>/<slug>/xml/
 *     __manifest__.py
 *     views/<module>_views.xml
 *     views/screens/<screen_id>.xml
 *
 * Usage:
 *   node generate-xml.js --spec path/to/screens.json [--out <dir>] [--module <name>]
 *   node generate-xml.js --example                         # render the bundled demo
 */

'use strict';

const fs = require('fs');
const path = require('path');
const x = require('./lib/odoo-xml');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--spec') out.spec = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--module') out.module = argv[++i];
    else if (a === '--example') out.example = true;
    else if (a === '-h' || a === '--help') out.help = true;
  }
  return out;
}

function printHelp() {
  console.log(`
generate-xml — render an Odoo XML scaffold from a canvas spec

Usage:
  node generate-xml.js --spec screens.json [--out <dir>] [--module <name>]
  node generate-xml.js --example

Options:
  --spec <path>    Path to screens.json (produced by saveOdooCanvas)
  --out  <dir>     Output directory (default: Cowork mnt/outputs/uiux-odoo-output/<slug>/xml)
  --module <name>  Module technical name override (default: derived from spec.slug)
  --example        Render the bundled example canvas
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); process.exit(0); }

  let canvas;
  if (args.example) {
    canvas = require('./example').canvas;
  } else if (args.spec) {
    const raw = fs.readFileSync(path.resolve(args.spec), 'utf8');
    canvas = JSON.parse(raw);
  } else {
    printHelp();
    process.exit(1);
  }

  const opts = {};
  if (args.out) opts.outputDir = path.resolve(args.out);
  if (args.module) opts.module = args.module;

  const out = x.saveOdooXml(canvas, opts);
  console.log('\n✔ XML scaffold generated');
  console.log(`  dir       ${out.dir}`);
  console.log(`  combined  ${out.files.combined}`);
  console.log(`  manifest  ${out.files.manifest}`);
  console.log(`  per-screen:`);
  for (const [id, p] of Object.entries(out.files.screens)) {
    console.log(`    ${id.padEnd(28)} ${p}`);
  }
  console.log('');
}

main().catch((e) => { console.error(e); process.exit(1); });
