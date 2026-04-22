const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const { OPENCLAW_HOME } = require('./config.cjs');

// node-pty is a native module; load lazily so the server still boots without it.
let pty = null;
let ptyLoadError = null;
try {
  pty = require('node-pty');
} catch (err) {
  ptyLoadError = err.message || String(err);
  console.warn('[terminal] node-pty not available:', ptyLoadError);
}

const wss = new WebSocketServer({ noServer: true });
const SKILLS_DIR = path.join(OPENCLAW_HOME, 'skills');

function ensureSkillsDir() {
  try { fs.mkdirSync(SKILLS_DIR, { recursive: true }); } catch {}
}

function handleUpgrade(request, socket, head, db) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const token = url.searchParams.get('token');

  const claims = token && db.verifyToken(token);
  if (!claims) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  // Permission: admin OR user with `can_use_claude_terminal` granted by an admin.
  let allowed = claims.role === 'admin';
  if (!allowed && claims.userId) {
    try {
      const u = db.getUserById(claims.userId);
      allowed = Boolean(u && u.can_use_claude_terminal);
    } catch {}
  }
  if (!allowed) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request, claims);
  });
}

wss.on('connection', (ws, _request, claims) => {
  if (!pty) {
    try {
      ws.send(JSON.stringify({
        type: 'error',
        message: `Terminal unavailable: node-pty failed to load (${ptyLoadError}). Run "npm install node-pty" and rebuild.`,
      }));
    } catch {}
    ws.close();
    return;
  }

  ensureSkillsDir();

  // Resolve claude binary: explicit override → desktop bundle (newest) → package installs.
  // CLAUDE_CODE_EXECPATH is set by the Claude Code desktop app and points to its
  // bundled binary (usually newer than the homebrew cask).
  function pickClaude() {
    // Priority: explicit override → native auto-updating install (~/.local/bin/claude)
    // → desktop-bundled binary → system-wide installs. The native install is a
    // symlink to the newest version under ~/.local/share/claude/versions/, so it
    // wins over the desktop bundle (which may lag) and over homebrew.
    const candidates = [
      process.env.CLAUDE_BIN,
      `${process.env.HOME || ''}/.local/bin/claude`,
      process.env.CLAUDE_CODE_EXECPATH,
      '/opt/homebrew/bin/claude',
      '/usr/local/bin/claude',
    ].filter(Boolean);
    for (const c of candidates) {
      try { if (fs.existsSync(c)) return c; } catch {}
    }
    return null;
  }

  // Strip env vars leaked from a parent Claude Code / Claude desktop process.
  // These trick the child `claude` CLI into using a stale OAuth token or
  // SDK-mode transport, causing 401 Invalid authentication even after /login.
  const cleanEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (
      k === 'CLAUDECODE' ||
      k === 'CLAUDE_CODE_OAUTH_TOKEN' ||
      k === 'CLAUDE_CODE_SSE_PORT' ||
      k === 'CLAUDE_CODE_EXECPATH' ||
      k === 'CLAUDE_CODE_ENTRYPOINT' ||
      k.startsWith('CLAUDE_CODE_SDK') ||
      k.startsWith('CLAUDE_INTERNAL_') ||
      (k === 'ANTHROPIC_API_KEY' && !v)
    ) continue;
    cleanEnv[k] = v;
  }

  const claudeBin = pickClaude();
  if (!claudeBin) {
    const msg = 'Claude CLI not found. Set CLAUDE_BIN or install claude at /opt/homebrew/bin/claude.';
    console.error('[terminal]', msg);
    try { ws.send(JSON.stringify({ type: 'error', message: msg })); } catch {}
    try { ws.close(); } catch {}
    return;
  }

  const spawnEnv = {
    ...cleanEnv,
    TERM: 'xterm-256color',
    PATH: cleanEnv.PATH || '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin',
    AOC_TERMINAL_USER: claims.username || 'admin',
  };

  let term;
  try {
    // Spawn `claude` directly as the pty process (no login shell). When the user
    // exits claude the pty exits → WS closes. No shell fallback = no arbitrary
    // command execution on the host.
    term = pty.spawn(claudeBin, [], {
      name: 'xterm-256color',
      cols: 100,
      rows: 30,
      cwd: SKILLS_DIR,
      env: spawnEnv,
    });
  } catch (err) {
    const msg = `Failed to spawn claude (${claudeBin}): ${err && err.message ? err.message : err}`;
    console.error('[terminal]', msg);
    try { ws.send(JSON.stringify({ type: 'error', message: msg })); } catch {}
    try { ws.close(); } catch {}
    return;
  }

  console.log(`[terminal] pty spawned pid=${term.pid} bin=${claudeBin} user=${claims.username} cwd=${SKILLS_DIR}`);

  term.onData((data) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'output', data }));
    }
  });

  term.onExit(({ exitCode }) => {
    if (ws.readyState === ws.OPEN) {
      try { ws.send(JSON.stringify({ type: 'exit', exitCode })); } catch {}
      ws.close();
    }
  });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'input' && typeof msg.data === 'string') {
      term.write(msg.data);
    } else if (msg.type === 'resize' && Number.isFinite(msg.cols) && Number.isFinite(msg.rows)) {
      try { term.resize(Math.max(1, msg.cols|0), Math.max(1, msg.rows|0)); } catch {}
    }
  });

  ws.on('close', () => {
    try { term.kill(); } catch {}
    console.log(`[terminal] pty killed pid=${term.pid}`);
  });
  ws.on('error', () => { try { term.kill(); } catch {} });
});

module.exports = { handleUpgrade, SKILLS_DIR };
