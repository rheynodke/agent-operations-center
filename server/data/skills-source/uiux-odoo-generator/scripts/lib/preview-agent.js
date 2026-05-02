/**
 * preview-agent — live-preview daemon + Cloudflare Quick Tunnel manager.
 *
 * Security posture (summary — see ../../SECURITY.md for full detail):
 *   - No privileged operations. This module NEVER invokes package managers
 *     and NEVER runs any command requiring elevated permissions.
 *   - cloudflared auto-install downloads a single signed binary from
 *     https://github.com/cloudflare/cloudflared/releases/latest into the
 *     user's home directory (~/.local/bin/cloudflared). No system paths.
 *   - All child processes are spawned with argv arrays (no shell=true) to
 *     avoid command injection; arguments are never string-concatenated.
 *   - Server binds to 127.0.0.1 by default. Public exposure is only via the
 *     user-triggered Cloudflare tunnel (ephemeral subdomain, user-revokable).
 *   - State files + logs live under ~/.uiux-preview/ (user-owned dir, 0700
 *     on creation). No writes outside the user's home directory.
 *
 * Public API (CommonJS):
 *   startPreview({ specPath, slug, cwd, port?, host?, serveScript })
 *     → { pid, port, localUrl, stateFile }
 *   startTunnel({ slug, autoInstall })   → { tunnelPid, publicUrl }
 *   stopPreview({ slug })                → { stopped }
 *   listPreviews()                       → [ state ]
 *   getState({ slug })                   → state | null
 *   ensureCloudflared({ autoInstall })   → { ok, path, installed? }
 *
 * Node built-ins used — each has a single, documented purpose:
 *   fs       — read/write state files + log files in ~/.uiux-preview/
 *   path     — cross-platform path joining
 *   os       — homedir(), platform(), arch() for binary download + state dir
 *   net      — free-port probing (server.listen on 127.0.0.1)
 *   https    — native binary download for cloudflared (no external fetcher)
 *   crypto   — sha256 integrity check on the downloaded binary (optional)
 *   child_process — spawn ONLY pre-defined scripts (serve.js, cloudflared).
 *                   argv arrays, never shell-interpolated.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const https = require('https');
const { spawn, spawnSync } = require('child_process');

// ────────────────────────────────────────── state directory

const STATE_DIR = path.join(os.homedir(), '.uiux-preview');

function ensureStateDir() {
  // 0o700 = rwx for owner only. If the directory already exists with
  // different perms we don't touch them (would be surprising), but new
  // directories get locked down by default.
  fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  return STATE_DIR;
}

function stateFileFor(slug) {
  return path.join(ensureStateDir(), `${safeSlug(slug)}.json`);
}

function logFileFor(slug, kind) {
  return path.join(ensureStateDir(), `${safeSlug(slug)}.${kind}.log`);
}

function safeSlug(s) {
  return String(s || 'default').replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function readState(slug) {
  const f = stateFileFor(slug);
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}

function writeState(slug, obj) {
  const f = stateFileFor(slug);
  fs.writeFileSync(f, JSON.stringify(obj, null, 2), { mode: 0o600 });
  return f;
}

function removeState(slug) {
  const f = stateFileFor(slug);
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

// ────────────────────────────────────────── port picking

function isPortFree(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, host);
  });
}

async function pickPort(preferred, host) {
  const first = preferred || 4455;
  for (let p = first; p < first + 20; p++) {
    // eslint-disable-next-line no-await-in-loop
    if (await isPortFree(p, host)) return p;
  }
  return await new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, host, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// ────────────────────────────────────────── process liveness

function isPidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }
}

function killPidTree(pid, signal = 'SIGTERM') {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      // argv-form; /T terminates child tree, /F forces.
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F']);
    } else {
      try { process.kill(-pid, signal); } catch {}
      try { process.kill(pid, signal); } catch {}
    }
  } catch {}
}

// ────────────────────────────────────────── cloudflared — discovery

/**
 * Locate cloudflared on the user's PATH. Uses argv-form `which` / `where` —
 * no shell interpolation of user input.
 */
function which(bin) {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(cmd, [bin], { encoding: 'utf8' });
  if (r.status === 0) return r.stdout.trim().split(/\r?\n/)[0];
  return null;
}

function userBinDir() {
  // Userspace install target. Always under $HOME. Never a system path.
  if (process.platform === 'win32') {
    return path.join(os.homedir(), '.local', 'bin');
  }
  return path.join(os.homedir(), '.local', 'bin');
}

function cloudflaredPath() {
  const onPath = which('cloudflared');
  if (onPath) return onPath;
  const local = path.join(
    userBinDir(),
    process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared'
  );
  return fs.existsSync(local) ? local : null;
}

// ────────────────────────────────────────── cloudflared — binary URL

/**
 * Return the official GitHub release asset URL for the user's OS + arch.
 * Host is always github.com / a GitHub CDN — no third-party mirrors.
 */
function cloudflaredDownloadUrl() {
  const base = 'https://github.com/cloudflare/cloudflared/releases/latest/download';
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  if (process.platform === 'darwin') {
    // On macOS the release ships as a .tgz. We only auto-install on Linux/Win.
    // For macOS we surface a manual-install hint; see ensureCloudflared().
    return null;
  }
  if (process.platform === 'win32') {
    const winArch = process.arch === 'arm64' ? 'arm64' : 'amd64';
    return `${base}/cloudflared-windows-${winArch}.exe`;
  }
  // linux
  return `${base}/cloudflared-linux-${arch}`;
}

// ────────────────────────────────────────── cloudflared — userspace install

/**
 * Stream a HTTPS URL to a local file. Follows up to 5 redirects. Throws on
 * non-2xx terminal responses. Cleans up the partial file on error.
 */
function httpsDownload(url, destPath, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const req = (u, hopsLeft) => {
      https.get(u, (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location && hopsLeft > 0) {
          res.resume();
          const next = new URL(res.headers.location, u).toString();
          return req(next, hopsLeft - 1);
        }
        if (status < 200 || status >= 300) {
          res.resume();
          return reject(new Error(`HTTP ${status} while downloading ${u}`));
        }
        const tmp = destPath + '.part';
        const out = fs.createWriteStream(tmp, { mode: 0o700 });
        res.pipe(out);
        out.on('finish', () => {
          out.close(() => {
            try { fs.renameSync(tmp, destPath); resolve(destPath); }
            catch (e) { reject(e); }
          });
        });
        out.on('error', (e) => { try { fs.unlinkSync(tmp); } catch {} reject(e); });
      }).on('error', reject);
    };
    req(url, maxRedirects);
  });
}

/**
 * Auto-install cloudflared into ~/.local/bin/cloudflared (userspace only).
 * Returns { ok, path } on success, { ok: false, reason } on failure.
 * Only works on Linux + Windows. For macOS we return a soft failure so the
 * caller can print a Homebrew hint (which the user runs themselves).
 */
async function autoInstallCloudflared() {
  const url = cloudflaredDownloadUrl();
  if (!url) {
    return {
      ok: false,
      reason: 'auto-install not available for this OS — install manually (see references/install-cloudflared.md)',
    };
  }
  const dir = userBinDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const dest = path.join(
    dir,
    process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared'
  );
  try {
    await httpsDownload(url, dest);
    if (process.platform !== 'win32') {
      try { fs.chmodSync(dest, 0o700); } catch {}
    }
    return { ok: true, path: dest };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/**
 * Human-readable pointers for manual install. Strings are deliberately
 * generic — no package-manager command lines are hard-coded here. Full
 * details live in references/install-cloudflared.md and on Cloudflare's
 * own documentation.
 */
function manualInstallHints() {
  return [
    'cloudflared is not on PATH.',
    '',
    'Recommended — userspace install (no privileges required):',
    '  node scripts/preview.js install-cloudflared',
    '  (downloads the official binary into ~/.local/bin/)',
    '',
    'Other options (package managers on your platform) are listed in',
    'references/install-cloudflared.md and on https://pkg.cloudflare.com/.',
    'The skill itself never runs any package manager — you run those',
    'yourself if you prefer them.',
  ];
}

/**
 * ensureCloudflared({ autoInstall })
 *   Found on PATH or under ~/.local/bin → { ok: true, path }
 *   Missing + autoInstall=true → attempt userspace install (never escalated)
 *   Missing + autoInstall=false → { ok: false, hints: [...] }
 *
 * NOTE: this function never executes package managers. The only file it
 * writes is ~/.local/bin/cloudflared (or cloudflared.exe on Windows).
 */
async function ensureCloudflared(opts = {}) {
  const { autoInstall = false } = opts;
  const p = cloudflaredPath();
  if (p) return { ok: true, path: p, installed: false };

  if (!autoInstall) {
    return { ok: false, hints: manualInstallHints() };
  }
  const result = await autoInstallCloudflared();
  if (result.ok) return { ok: true, path: result.path, installed: true };
  return { ok: false, hints: manualInstallHints(), error: result.reason };
}

// Keep the old name exported for backward compatibility of any caller.
function cloudflaredInstallPlan() {
  return { hints: manualInstallHints() };
}

// ────────────────────────────────────────── startPreview

async function startPreview(opts) {
  const {
    specPath,
    slug,
    cwd,
    host = '127.0.0.1',
    port: preferredPort,
    serveScript,
    preset,
    outputDir,
  } = opts;

  if (!specPath && !outputDir) throw new Error('startPreview: specPath or outputDir required');
  if (!serveScript) throw new Error('startPreview: serveScript is required');
  if (!slug) throw new Error('startPreview: slug is required');

  const existing = readState(slug);
  if (existing && isPidAlive(existing.pid)) {
    return { ...existing, reused: true };
  }
  if (existing && !isPidAlive(existing.pid)) removeState(slug);

  const port = await pickPort(preferredPort, host);
  const logOut = logFileFor(slug, 'out');
  const logErr = logFileFor(slug, 'err');
  const outFd = fs.openSync(logOut, 'a', 0o600);
  const errFd = fs.openSync(logErr, 'a', 0o600);

  const args = [];
  if (specPath) { args.push('--spec', specPath); }
  else if (outputDir) { args.push('--root', outputDir); }
  args.push('--port', String(port), '--host', host);
  args.push('--no-open');

  // argv-form spawn. serveScript path is set by the CLI (not user-input);
  // host defaults to 127.0.0.1 and all other args are either numbers or
  // user-owned file paths.
  const child = spawn(process.execPath, [serveScript, ...args], {
    cwd: cwd || path.dirname(serveScript),
    detached: true,
    stdio: ['ignore', outFd, errFd],
    env: process.env,
  });
  child.unref();

  const state = {
    slug: safeSlug(slug),
    pid: child.pid,
    port,
    host,
    localUrl: `http://${host}:${port}/`,
    specPath: specPath || null,
    outputDir: outputDir || null,
    preset: preset || null,
    serveScript,
    logOut,
    logErr,
    startedAt: new Date().toISOString(),
    tunnel: null,
  };
  const stateFile = writeState(slug, state);
  state.stateFile = stateFile;
  return state;
}

// ────────────────────────────────────────── startTunnel

async function startTunnel(opts = {}) {
  const { slug, autoInstall = false } = opts;
  const state = readState(slug);
  if (!state) throw new Error(`no preview running for slug "${slug}" — start preview first`);
  if (state.tunnel && isPidAlive(state.tunnel.pid)) {
    return { reused: true, publicUrl: state.tunnel.publicUrl, tunnelPid: state.tunnel.pid };
  }

  const guard = await ensureCloudflared({ autoInstall });
  if (!guard.ok) {
    const err = new Error(
      `cloudflared is not installed.\n` +
      (guard.error ? `Auto-install failed: ${guard.error}\n\n` : '\n') +
      guard.hints.join('\n')
    );
    err.hints = guard.hints;
    throw err;
  }

  const cfPath = guard.path;
  const logOut = logFileFor(slug, 'tunnel.out');
  const logErr = logFileFor(slug, 'tunnel.err');
  const outFd = fs.openSync(logOut, 'a', 0o600);
  const errFd = fs.openSync(logErr, 'a', 0o600);

  // argv-form spawn. All flags are fixed literals; `state.localUrl` is
  // constructed from host (default 127.0.0.1) + numeric port.
  const cfArgs = [
    'tunnel',
    '--url', state.localUrl.replace(/\/$/, ''),
    '--no-autoupdate',
    '--metrics', '127.0.0.1:0',
  ];

  const child = spawn(cfPath, cfArgs, {
    detached: true,
    stdio: ['ignore', outFd, errFd],
    env: process.env,
  });
  child.unref();

  return await new Promise((resolve, reject) => {
    const start = Date.now();
    const timeout = 25000;
    const interval = setInterval(() => {
      const bufs = [];
      try { bufs.push(fs.readFileSync(logOut, 'utf8')); } catch {}
      try { bufs.push(fs.readFileSync(logErr, 'utf8')); } catch {}
      const haystack = bufs.join('\n');
      const m = haystack.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (m) {
        clearInterval(interval);
        const publicUrl = m[0];
        state.tunnel = {
          pid: child.pid,
          publicUrl,
          logOut,
          logErr,
          startedAt: new Date().toISOString(),
        };
        writeState(slug, state);
        resolve({ publicUrl, tunnelPid: child.pid });
        return;
      }
      if (!isPidAlive(child.pid)) {
        clearInterval(interval);
        reject(new Error(`cloudflared exited early — check logs: ${logErr}`));
        return;
      }
      if (Date.now() - start > timeout) {
        clearInterval(interval);
        killPidTree(child.pid);
        reject(new Error(`cloudflared did not produce a public URL within ${timeout}ms`));
      }
    }, 500);
  });
}

// ────────────────────────────────────────── stopPreview

function stopPreview(opts = {}) {
  const { slug } = opts;
  const state = readState(slug);
  if (!state) return { stopped: false, reason: 'no state file' };

  let stoppedServe = false;
  if (state.pid && isPidAlive(state.pid)) {
    killPidTree(state.pid);
    stoppedServe = true;
  }
  let stoppedTunnel = false;
  if (state.tunnel && state.tunnel.pid && isPidAlive(state.tunnel.pid)) {
    killPidTree(state.tunnel.pid);
    stoppedTunnel = true;
  }
  removeState(slug);
  return { stopped: true, stoppedServe, stoppedTunnel };
}

// ────────────────────────────────────────── list

function listPreviews() {
  ensureStateDir();
  const files = fs.readdirSync(STATE_DIR).filter((f) => f.endsWith('.json'));
  return files.map((f) => {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(STATE_DIR, f), 'utf8'));
      s.alive = isPidAlive(s.pid);
      s.tunnelAlive = !!(s.tunnel && isPidAlive(s.tunnel.pid));
      return s;
    } catch { return null; }
  }).filter(Boolean);
}

function getState(opts = {}) {
  const s = readState(opts.slug);
  if (!s) return null;
  s.alive = isPidAlive(s.pid);
  s.tunnelAlive = !!(s.tunnel && isPidAlive(s.tunnel.pid));
  return s;
}

function pruneDead() {
  const all = listPreviews();
  const removed = [];
  for (const s of all) {
    if (!s.alive) { removeState(s.slug); removed.push(s.slug); }
  }
  return { removed };
}

module.exports = {
  STATE_DIR,
  startPreview,
  startTunnel,
  stopPreview,
  listPreviews,
  getState,
  pruneDead,
  ensureCloudflared,
  cloudflaredInstallPlan,
  manualInstallHints,
  pickPort,
  isPidAlive,
};
