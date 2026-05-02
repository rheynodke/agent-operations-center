#!/usr/bin/env node
/**
 * uiux-odoo-generator — serve.js
 *
 * Thin wrapper around canvas-server with two convenience modes:
 *
 *   1. --root <dir>        Serve an existing output folder (mockups.html).
 *                          Changes under --watch broadcast "reload" to any
 *                          open browser tab.
 *
 *   2. --spec <canvas.js>  Treat a JS module as the source of truth. The
 *                          module must export { canvas } (object) or be
 *                          runnable directly. Each file change re-requires
 *                          the spec and re-runs saveOdooCanvas.
 *
 * Defaults:
 *   port  4455
 *   host  127.0.0.1
 *   open  true  (best-effort launch in browser)
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const canvasServer = require('./lib/canvas-server');

function parseArgs(argv) {
  const out = { watch: [], open: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') out.root = argv[++i];
    else if (a === '--spec') out.spec = argv[++i];
    else if (a === '--port') out.port = parseInt(argv[++i], 10);
    else if (a === '--host') out.host = argv[++i];
    else if (a === '--watch') out.watch.push(argv[++i]);
    else if (a === '--no-open') out.open = false;
    else if (a === '-h' || a === '--help') out.help = true;
  }
  return out;
}

function printHelp() {
  console.log(`
serve — live-reload server for Odoo canvases

Usage:
  node serve.js --root <dir>  [--port 4455] [--watch <dir> ...] [--no-open]
  node serve.js --spec <js>   [--port 4455] [--no-open]

Options:
  --root <dir>   Serve an existing mockup bundle folder (must contain mockups.html).
  --spec <js>    Path to a JS module that exports { canvas }. Auto-rebuilds on change.
  --watch <dir>  Extra directories to watch (repeatable). Defaults to --root.
  --port <n>     Listen port (default 4455).
  --host <h>     Bind host (default 127.0.0.1).
  --no-open      Skip launching the system browser.
`);
}

function tryOpen(url) {
  // argv-form; URL is either http://127.0.0.1:<numeric-port>/ or caller-supplied
  // --host (its own responsibility). No shell interpolation.
  const opener =
    process.platform === 'darwin' ? 'open' :
    process.platform === 'win32'  ? 'start' :
    'xdg-open';
  try {
    const child = spawn(opener, [url], { stdio: 'ignore', detached: true });
    child.unref();
  } catch { /* best-effort only */ }
}

/**
 * Run a spec file as a separate Node process. The spec is expected to print
 * its output directory to stdout ("written to: <dir>"). We parse that line
 * rather than requiring the module in-process, so the spec is never loaded
 * into this process's require cache.
 */
function runSpec(specPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [specPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); process.stdout.write(d); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); process.stderr.write(d); });
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`spec exited with code ${code}`));
      // Primary: machine-readable marker printed by the renderer.
      let m = stdout.match(/\[uiux-output\]\s+(\S.+)\s*$/m);
      // Fallback: any line like "html  <abs path>/mockups.html".
      if (!m) m = stdout.match(/([^\s'"]+)\/mockups\.html/);
      resolve({ stdout, stderr, dir: m ? path.dirname(m[1].includes('mockups.html') ? m[1] : m[1] + '/mockups.html') : null });
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); process.exit(0); }
  if (!args.root && !args.spec) { printHelp(); process.exit(1); }

  let rootDir, watchPaths, rebuild;

  if (args.spec) {
    const specPath = path.resolve(args.spec);
    if (!fs.existsSync(specPath)) {
      console.error(`✖ spec not found: ${specPath}`);
      process.exit(1);
    }
    const specDir = path.dirname(specPath);

    // Initial build in a subprocess. The spec prints its output dir.
    const first = await runSpec(specPath);
    rootDir = first.dir || path.join(specDir, 'output');
    if (!fs.existsSync(rootDir)) {
      console.error(`✖ spec did not produce ${rootDir}`);
      process.exit(1);
    }
    watchPaths = [specDir, path.join(__dirname, 'lib')].concat(args.watch.map((p) => path.resolve(p)));
    rebuild = async () => { await runSpec(specPath); };
  } else {
    rootDir = path.resolve(args.root);
    if (!fs.existsSync(path.join(rootDir, 'mockups.html'))) {
      console.error(`✖ ${rootDir} does not contain mockups.html`);
      process.exit(1);
    }
    watchPaths = (args.watch.length ? args.watch : [rootDir]).map((p) => path.resolve(p));
  }

  const server = await canvasServer.start({
    rootDir,
    port: args.port || 4455,
    host: args.host || '127.0.0.1',
    watchPaths,
    rebuild,
  });

  if (args.open) tryOpen(server.url);

  process.on('SIGINT', async () => { await server.stop(); process.exit(0); });
  process.on('SIGTERM', async () => { await server.stop(); process.exit(0); });
}

main().catch((e) => { console.error(e); process.exit(1); });
