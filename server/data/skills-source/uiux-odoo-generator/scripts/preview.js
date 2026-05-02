#!/usr/bin/env node
/**
 * preview — one-stop CLI for live preview + optional Cloudflare tunnel.
 *
 * Starts a detached serve.js daemon that watches the spec and rebuilds on
 * change. Browser clients receive WebSocket reload pushes. State is kept in
 * ~/.uiux-preview/<slug>.json so the agent can stop/status later.
 *
 * Usage:
 *   node preview.js start --spec <canvas.js> [--slug <name>] [--port 4455]
 *   node preview.js start --root <dir>       [--slug <name>] [--port 4455]
 *   node preview.js tunnel --slug <name>     [--auto-install]
 *   node preview.js stop   --slug <name>
 *   node preview.js status [--slug <name>]
 *   node preview.js list
 *   node preview.js install-cloudflared [--dry-run]
 *
 * Exit codes:
 *   0 = ok
 *   1 = user error (missing flag, etc.)
 *   2 = runtime failure
 */

'use strict';

const path = require('path');
const fs = require('fs');
const agent = require('./lib/preview-agent');

function parseFlags(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) { out[key] = true; }
      else { out[key] = next; i++; }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function printHelp() {
  console.log(`
preview — live-preview + tunnel CLI

Commands:
  start               Start a detached preview server
    --spec <file>       JS spec that exports a canvas (re-run on change)
    --root <dir>        Existing output directory (static watch)
    --slug <name>       Instance name (default: derived from spec/dir)
    --port <n>          Preferred port (auto-pick if taken)
    --host <h>          Bind host (default 127.0.0.1)

  tunnel              Open a Cloudflare Quick Tunnel for a running preview
    --slug <name>       Which preview (required)
    --auto-install      Install cloudflared if missing

  stop                Kill the preview (and its tunnel if any)
    --slug <name>       Which preview (required)

  status              Show one preview's state (or default slug)
    --slug <name>

  list                List all running previews

  install-cloudflared Print or run the platform install plan
    --dry-run           Print commands only

Examples:
  node preview.js start --spec ./my-canvas.js --slug odoo_sales
  node preview.js tunnel --slug odoo_sales --auto-install
  node preview.js stop   --slug odoo_sales
`);
}

function deriveSlug(flags) {
  if (flags.slug) return flags.slug;
  if (flags.spec) return path.basename(flags.spec, path.extname(flags.spec));
  if (flags.root) return path.basename(path.resolve(flags.root));
  return 'default';
}

function resolveServeScript() {
  // serve.js sits alongside this file
  return path.join(__dirname, 'serve.js');
}

async function cmdStart(flags) {
  if (!flags.spec && !flags.root) {
    console.error('✖ --spec or --root is required');
    process.exit(1);
  }
  const slug = deriveSlug(flags);
  const state = await agent.startPreview({
    specPath: flags.spec ? path.resolve(flags.spec) : null,
    outputDir: flags.root ? path.resolve(flags.root) : null,
    slug,
    port: flags.port ? parseInt(flags.port, 10) : undefined,
    host: flags.host || '127.0.0.1',
    serveScript: resolveServeScript(),
    preset: path.basename(path.dirname(__dirname)),
  });

  if (state.reused) {
    console.log(`● preview already running — slug=${state.slug}`);
  } else {
    console.log(`✔ preview started — slug=${state.slug} pid=${state.pid}`);
  }
  console.log(`  local    ${state.localUrl}`);
  console.log(`  logs     ${state.logOut}`);
  console.log(`  state    ${state.stateFile || agent.getState({ slug: state.slug }).stateFile || '(in state dir)'}`);
  console.log(`\nNext:`);
  console.log(`  • open ${state.localUrl} in browser (auto-reloads on spec change)`);
  console.log(`  • public URL  → node preview.js tunnel --slug ${state.slug} --auto-install`);
  console.log(`  • stop server → node preview.js stop   --slug ${state.slug}`);
}

async function cmdTunnel(flags) {
  if (!flags.slug) { console.error('✖ --slug is required'); process.exit(1); }
  const autoInstall = !!flags['auto-install'];

  try {
    const res = await agent.startTunnel({ slug: flags.slug, autoInstall });
    if (res.reused) console.log(`● tunnel already running`);
    else console.log(`✔ tunnel started — pid=${res.tunnelPid}`);
    console.log(`  public   ${res.publicUrl}`);
    const state = agent.getState({ slug: flags.slug });
    if (state) console.log(`  local    ${state.localUrl}`);
  } catch (e) {
    console.error(`✖ ${e.message}`);
    if (!autoInstall) {
      console.error(`\nRe-run with --auto-install to download cloudflared into ~/.local/bin/`);
    }
    process.exit(2);
  }
}

async function cmdStop(flags) {
  if (!flags.slug) { console.error('✖ --slug is required'); process.exit(1); }
  const res = agent.stopPreview({ slug: flags.slug });
  if (!res.stopped) console.log(`○ no preview found for slug=${flags.slug}`);
  else console.log(`✔ stopped — serve=${res.stoppedServe ? 'yes' : 'no'} tunnel=${res.stoppedTunnel ? 'yes' : 'no'}`);
}

async function cmdStatus(flags) {
  if (flags.slug) {
    const s = agent.getState({ slug: flags.slug });
    if (!s) { console.log(`○ no preview for slug=${flags.slug}`); return; }
    console.log(JSON.stringify(s, null, 2));
    return;
  }
  const all = agent.listPreviews();
  if (!all.length) { console.log('○ no previews running'); return; }
  for (const s of all) {
    const live = s.alive ? '●' : '○';
    const tun = s.tunnelAlive ? ` tunnel=${s.tunnel.publicUrl}` : '';
    console.log(`${live} ${s.slug.padEnd(24)} ${s.localUrl}${tun}  pid=${s.pid}`);
  }
}

async function cmdList() { return cmdStatus({}); }

async function cmdInstallCloudflared(flags) {
  const dry = !!flags['dry-run'];
  const already = await agent.ensureCloudflared({ autoInstall: false });
  if (already.ok) {
    console.log(`✔ cloudflared already available at ${already.path}`);
    return;
  }
  console.log('Manual install options (run these yourself if you prefer):');
  for (const h of already.hints) console.log(h);
  if (dry) {
    console.log(`\n(dry-run: not downloading anything)`);
    return;
  }
  console.log(`\nDownloading cloudflared to ~/.local/bin/ (userspace, no privileges)…`);
  const r = await agent.ensureCloudflared({ autoInstall: true });
  if (r.ok) {
    console.log(`\n✔ cloudflared installed at ${r.path}`);
    console.log(`  Add to PATH if needed:  export PATH="$HOME/.local/bin:$PATH"`);
  } else {
    console.error(`\n✖ download failed: ${r.error || 'unknown'}`);
    process.exit(2);
  }
}

// ────────────────────────────────────────── main

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv[0] === '-h' || argv[0] === '--help') { printHelp(); process.exit(0); }
  const [cmd, ...rest] = argv;
  const flags = parseFlags(rest);

  switch (cmd) {
    case 'start':                return cmdStart(flags);
    case 'tunnel':               return cmdTunnel(flags);
    case 'stop':                 return cmdStop(flags);
    case 'status':               return cmdStatus(flags);
    case 'list':                 return cmdList();
    case 'install-cloudflared':  return cmdInstallCloudflared(flags);
    default:
      console.error(`unknown command: ${cmd}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(2); });
