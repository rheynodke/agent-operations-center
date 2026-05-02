/**
 * uiux-generator — canvas-server
 *
 * Zero-dep Node HTTP + WebSocket server that serves the rendered UI canvas
 * and live-reloads it whenever any watched source file changes.
 *
 * What it does:
 *   1. Serves the rendered mockups.html (built via mockup-builder.js) at `/`.
 *   2. Serves static assets (screens.json, style-guide.html, inspiration.*)
 *      from the same directory.
 *   3. Upgrades `/ws` to a raw WebSocket connection (RFC 6455) with its own
 *      SHA1 + base64 handshake — no npm packages required.
 *   4. Watches a spec directory via `fs.watch`, rebuilds the HTML through a
 *      user-supplied rebuild function, and broadcasts `"reload"` to all
 *      connected WebSocket clients.
 *
 * Library usage:
 *   const server = require('./canvas-server');
 *   server.start({
 *     port: 4455,
 *     rootDir: '/path/to/output',   // where mockups.html lives
 *     watchPaths: ['/path/to/specs'],
 *     rebuild: async () => { ... },  // called on file change
 *   });
 *
 * CLI:
 *   node canvas-server.js --root <dir> [--port 4455] [--watch <dir>]
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ────────────────────────────────────────────── WebSocket (RFC 6455)

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function acceptKey(key) {
  return crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
}

function encodeFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81;           // FIN + text frame
    header[1] = len;            // no mask (server→client)
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    // High 32 bits zero — payloads > 4GB not happening here.
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  return Buffer.concat([header, payload]);
}

// Minimal frame decoder — enough to catch close / ping; we don't need payloads.
function parseFrame(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let offset = 2;
  if (len === 126) { len = buf.readUInt16BE(2); offset = 4; }
  else if (len === 127) { len = buf.readUInt32BE(6); offset = 10; } // truncated for our purposes
  if (masked) offset += 4;
  if (buf.length < offset + len) return null;
  return { opcode, len, offset };
}

function handleUpgrade(req, socket, clients) {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const acceptHdr = acceptKey(key);
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${acceptHdr}\r\n\r\n`
  );
  clients.add(socket);
  socket.on('data', (chunk) => {
    const frame = parseFrame(chunk);
    if (!frame) return;
    if (frame.opcode === 0x8) { // close
      try { socket.end(); } catch {}
      clients.delete(socket);
    } else if (frame.opcode === 0x9) {
      // ping → pong (omit payload pass-through for brevity)
      try { socket.write(Buffer.from([0x8A, 0])); } catch {}
    }
  });
  socket.on('close', () => clients.delete(socket));
  socket.on('error', () => clients.delete(socket));
}

function broadcast(clients, message) {
  const frame = encodeFrame(message);
  for (const s of clients) {
    try { s.write(frame); } catch { clients.delete(s); }
  }
}

// ────────────────────────────────────────────── static file serving

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function mimeFor(p) { return MIME[path.extname(p).toLowerCase()] || 'application/octet-stream'; }

const LIVE_RELOAD_SNIPPET = `
<script>
(function () {
  try {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var ws = new WebSocket(proto + '//' + location.host + '/ws');
    ws.onmessage = function (ev) {
      if (ev.data === 'reload') location.reload();
    };
    ws.onclose = function () {
      // Try to reconnect after 2s
      setTimeout(function () { location.reload(); }, 2000);
    };
    var banner = document.createElement('div');
    banner.style.cssText = 'position:fixed;bottom:10px;right:10px;background:rgba(17,24,39,.85);color:#fff;font:12px -apple-system,sans-serif;padding:6px 10px;border-radius:6px;z-index:99999';
    banner.textContent = '● live';
    document.body.appendChild(banner);
  } catch (e) {}
})();
</script>
`;

function injectLiveReload(html) {
  if (!/<\/body>/i.test(html)) return html + LIVE_RELOAD_SNIPPET;
  return html.replace(/<\/body>/i, LIVE_RELOAD_SNIPPET + '</body>');
}

function serveFile(req, res, rootDir) {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/mockups.html';
  // directory → index
  if (rel.endsWith('/')) rel += 'mockups.html';
  const abs = path.join(rootDir, rel);
  // path traversal guard
  if (!abs.startsWith(path.resolve(rootDir))) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.stat(abs, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found: ' + rel);
      return;
    }
    const mime = mimeFor(abs);
    if (mime.startsWith('text/html')) {
      fs.readFile(abs, 'utf8', (e, html) => {
        if (e) { res.writeHead(500); res.end('read error'); return; }
        res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
        res.end(injectLiveReload(html));
      });
    } else {
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
      fs.createReadStream(abs).pipe(res);
    }
  });
}

// ────────────────────────────────────────────── file watcher

function watchPaths(paths, onChange) {
  const watchers = [];
  const pending = new Set();
  let debounce;

  function fireDebounced() {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      const list = [...pending];
      pending.clear();
      onChange(list);
    }, 120);
  }

  for (const p of paths) {
    if (!fs.existsSync(p)) continue;
    try {
      const watcher = fs.watch(p, { recursive: true }, (event, filename) => {
        if (!filename) return;
        // ignore hidden / temp
        if (/^\./.test(filename) || /~$/.test(filename)) return;
        pending.add(filename);
        fireDebounced();
      });
      watchers.push(watcher);
    } catch (e) {
      // fs.watch recursive not supported on Linux < newer; fall back to interval
      console.warn(`[watch] fs.watch failed on ${p}: ${e.message}`);
    }
  }
  return () => { for (const w of watchers) try { w.close(); } catch {} };
}

// ────────────────────────────────────────────── server

async function start(opts) {
  const {
    port = 4455,
    host = '127.0.0.1',
    rootDir,
    watchPaths: watchList = [],
    rebuild,
    onReady,
    onReload,
  } = opts;

  if (!rootDir) throw new Error('canvas-server: rootDir is required');
  fs.mkdirSync(rootDir, { recursive: true });

  const clients = new Set();

  const server = http.createServer((req, res) => {
    if (req.url === '/__status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, clients: clients.size, rootDir, watching: watchList }));
      return;
    }
    serveFile(req, res, rootDir);
  });

  server.on('upgrade', (req, socket) => {
    if (req.url === '/ws' || req.url.startsWith('/ws?')) {
      handleUpgrade(req, socket, clients);
    } else {
      socket.destroy();
    }
  });

  const stopWatcher = watchPaths(watchList, async (changed) => {
    try {
      if (typeof rebuild === 'function') await rebuild(changed);
      broadcast(clients, 'reload');
      if (typeof onReload === 'function') onReload(changed);
    } catch (e) {
      console.error('[canvas-server] rebuild error:', e.message);
    }
  });

  await new Promise((resolve) => server.listen(port, host, resolve));

  const url = `http://${host}:${port}/`;
  console.log(`\n╭─────────────────────────────────────────────╮`);
  console.log(`│ uiux-generator canvas server                │`);
  console.log(`├─────────────────────────────────────────────┤`);
  console.log(`│ URL       ${url.padEnd(34)}│`);
  console.log(`│ Root      ${rootDir.slice(-34).padEnd(34)}│`);
  console.log(`│ Watching  ${(watchList.join(', ') || '(none)').slice(-34).padEnd(34)}│`);
  console.log(`│ Live      ws://${host}:${port}/ws${' '.repeat(Math.max(0, 22 - String(port).length))}│`);
  console.log(`╰─────────────────────────────────────────────╯\n`);

  if (typeof onReady === 'function') onReady({ url, port, host });

  return {
    url, port, host, server, clients,
    reload: () => broadcast(clients, 'reload'),
    stop: () => new Promise((resolve) => {
      stopWatcher();
      for (const c of clients) try { c.destroy(); } catch {}
      server.close(() => resolve());
    }),
  };
}

// ────────────────────────────────────────────── CLI

function parseArgs(argv) {
  const out = { watch: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') out.root = argv[++i];
    else if (a === '--port') out.port = parseInt(argv[++i], 10);
    else if (a === '--watch') out.watch.push(argv[++i]);
    else if (a === '--host') out.host = argv[++i];
    else if (a === '-h' || a === '--help') out.help = true;
  }
  return out;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.root) {
    console.log(`
canvas-server — zero-dep live-reload server for uiux-generator canvases

Usage:
  node canvas-server.js --root <dir> [--port 4455] [--host 127.0.0.1] [--watch <dir> ...]

The --root directory should contain mockups.html (and optionally screens.json,
style-guide.html, inspiration.md). Any change under --watch triggers a reload.
`);
    process.exit(args.help ? 0 : 1);
  }
  start({
    rootDir: path.resolve(args.root),
    port: args.port || 4455,
    host: args.host || '127.0.0.1',
    watchPaths: (args.watch || []).map(p => path.resolve(p)),
  }).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { start, broadcast, encodeFrame, acceptKey };
