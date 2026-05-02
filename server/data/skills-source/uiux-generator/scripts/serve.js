/**
 * uiux-generator — serve
 *
 * CLI wrapper around lib/canvas-server.js. Starts a local web server that
 * hosts the rendered mockups.html + style-guide.html and live-reloads on
 * source changes.
 *
 * Usage:
 *   node serve.js --root <dir> [--port 4455]
 *   node serve.js --spec <spec.js> [--out <dir>] [--port 4455]
 *
 * Modes:
 *   --root <dir>      Serve an existing directory (expects mockups.html).
 *   --spec <file>     Path to a spec file (mockup SPEC export). Watches the
 *                     spec file's directory and re-runs `node <spec>` on
 *                     every change, then broadcasts reload.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const server = require('./lib/canvas-server');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') out.root = argv[++i];
    else if (a === '--spec') out.spec = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--port') out.port = parseInt(argv[++i], 10);
    else if (a === '--host') out.host = argv[++i];
    else if (a === '--open') out.open = true;
    else if (a === '-h' || a === '--help') out.help = true;
  }
  return out;
}

function printHelp() {
  console.log(`
serve — live-reload web server for uiux-generator canvases

Usage:
  node serve.js --root <dir>                Serve an existing directory with mockups.html
  node serve.js --spec <spec.js>            Watch a spec file & re-run on change

Options:
  --port <num>     Port (default 4455)
  --host <ip>      Host (default 127.0.0.1)
  --out  <dir>     Override output directory when using --spec
  --open           (Reserved — not auto-opened here to keep zero deps)

Keyboard:
  Ctrl+C to stop.
`);
}

function runSpec(specPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [specPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    proc.stdout.on('data', d => { out += d.toString(); process.stdout.write(d); });
    proc.stderr.on('data', d => { err += d.toString(); process.stderr.write(d); });
    proc.on('close', (code) => {
      if (code === 0) resolve({ out, err });
      else reject(new Error(`spec exited with code ${code}\n${err}`));
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.root && !args.spec)) { printHelp(); process.exit(args.help ? 0 : 1); }

  let rootDir;
  let watchList = [];
  let rebuild;

  if (args.spec) {
    const specPath = path.resolve(args.spec);
    if (!fs.existsSync(specPath)) throw new Error(`spec not found: ${specPath}`);

    // First build
    console.log(`Running spec: ${specPath}`);
    const first = await runSpec(specPath);
    // Try to infer the output dir from stdout ("Mockup bundle written to: <dir>")
    const dirMatch = first.out.match(/written to:\s*([^\n]+)/i);
    rootDir = args.out
      ? path.resolve(args.out)
      : (dirMatch ? dirMatch[1].trim() : path.join(path.dirname(specPath), 'prd-output'));
    watchList = [path.dirname(specPath)];
    rebuild = async () => {
      console.log(`[canvas-server] rebuilding ${path.basename(specPath)}…`);
      await runSpec(specPath);
    };
  } else {
    rootDir = path.resolve(args.root);
    watchList = [rootDir];
  }

  await server.start({
    rootDir,
    port: args.port || 4455,
    host: args.host || '127.0.0.1',
    watchPaths: watchList,
    rebuild,
    onReload: (changed) => console.log(`[canvas-server] reload — ${changed.slice(0, 3).join(', ')}${changed.length > 3 ? '…' : ''}`),
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
