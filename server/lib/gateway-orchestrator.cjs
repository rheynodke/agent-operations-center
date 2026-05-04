'use strict';
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const { EventEmitter } = require('events');

const db = require('./db.cjs');
const { getUserHome, SHARED_SKILLS, SHARED_SCRIPTS, SHARED_PROVIDERS } = require('./config.cjs');

const orchestratorEvents = new EventEmitter();
orchestratorEvents.setMaxListeners(50);

// ─── Internals ───────────────────────────────────────────────────────────────

const PORT_RANGE_START = 19000;
const PORT_RANGE_END   = 19999;

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function allocatePort() {
  const used = new Set(db.listGatewayStates().map(r => r.port).filter(p => p != null));
  for (let p = PORT_RANGE_START; p <= PORT_RANGE_END; p++) {
    if (!used.has(p)) return p;
  }
  throw new Error(`Gateway port pool exhausted (${PORT_RANGE_START}-${PORT_RANGE_END})`);
}

/**
 * Read & parse the admin-managed shared providers file. Returns null if absent.
 * The file is JSON5-ish — generated with line comments. Strip them before JSON.parse.
 * Result is merged into per-user openclaw.json (inlined, since OpenClaw rejects
 * $include paths outside the config root).
 */
function readSharedProviders() {
  try {
    const raw = fs.readFileSync(SHARED_PROVIDERS, 'utf8');
    const stripped = raw
      .replace(/^\s*\/\/.*$/gm, '')                       // strip // line comments
      .replace(/\/\*[\s\S]*?\*\//g, '')                   // strip /* block */ comments
      .trim();
    return JSON.parse(stripped);
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.warn(`[orchestrator] readSharedProviders failed: ${e.message}`);
    }
    return null;
  }
}

/**
 * Inherit admin's AOC device identity + pre-approved operator scopes into a
 * per-user gateway home, so that when AOC's GatewayConnection connects with
 * admin's deviceId/keypair the user's gateway grants all 5 operator scopes
 * without manual `openclaw devices approve`. Idempotent.
 */
function inheritAdminDeviceScopes(adminHome, userHome) {
  const srcIdentityDir = path.join(adminHome, 'identity');
  const srcDeviceFile  = path.join(srcIdentityDir, 'device.json');
  if (!fs.existsSync(srcDeviceFile)) return;   // admin not yet paired — nothing to inherit

  // 1) Copy admin's identity/{device.json,device-auth.json} into the user home
  //    so the gateway resolves AOC's device with the same keypair.
  const dstIdentityDir = path.join(userHome, 'identity');
  fs.mkdirSync(dstIdentityDir, { recursive: true });
  for (const f of ['device.json', 'device-auth.json']) {
    const src = path.join(srcIdentityDir, f);
    const dst = path.join(dstIdentityDir, f);
    if (fs.existsSync(src) && !fs.existsSync(dst)) {
      fs.copyFileSync(src, dst);
      try { fs.chmodSync(dst, 0o600); } catch (_) {}
    }
  }

  // 2) Pre-approve admin's deviceId in the user gateway's devices/paired.json.
  let adminDevice;
  try { adminDevice = JSON.parse(fs.readFileSync(srcDeviceFile, 'utf8')); }
  catch (_) { return; }
  if (!adminDevice?.deviceId) return;

  // Pull the canonical "approved" record straight from admin's paired.json so
  // we replicate scopes/tokens exactly. If absent (e.g. admin hasn't completed
  // pairing), build a minimum-viable entry from the device file.
  let adminPaired = {};
  try {
    adminPaired = JSON.parse(fs.readFileSync(path.join(adminHome, 'devices', 'paired.json'), 'utf8'));
  } catch (_) {}
  const adminEntry = adminPaired[adminDevice.deviceId];
  if (!adminEntry) return;   // admin not yet approved — defer to manual pairing on first run

  const dstDevicesDir = path.join(userHome, 'devices');
  fs.mkdirSync(dstDevicesDir, { recursive: true });
  const dstPaired = path.join(dstDevicesDir, 'paired.json');
  let pairedTable = {};
  if (fs.existsSync(dstPaired)) {
    try { pairedTable = JSON.parse(fs.readFileSync(dstPaired, 'utf8')); } catch (_) {}
  }
  // Only seed the AOC device entry; do not overwrite if the user has separately
  // paired their own devices (won't happen today, but future-proof).
  if (!pairedTable[adminDevice.deviceId]) {
    pairedTable[adminDevice.deviceId] = adminEntry;
    fs.writeFileSync(dstPaired, JSON.stringify(pairedTable, null, 2));
    try { fs.chmodSync(dstPaired, 0o600); } catch (_) {}
  }

  const dstPending = path.join(dstDevicesDir, 'pending.json');
  if (!fs.existsSync(dstPending)) {
    fs.writeFileSync(dstPending, '{}');
    try { fs.chmodSync(dstPending, 0o600); } catch (_) {}
  }
}

function ensureUserHome(userId, userHome) {
  for (const sub of ['agents', 'sessions', 'cron', 'credentials', 'logs']) {
    fs.mkdirSync(path.join(userHome, sub), { recursive: true });
  }

  for (const [target, link] of [[SHARED_SKILLS, path.join(userHome, 'skills')],
                                [SHARED_SCRIPTS, path.join(userHome, 'scripts')]]) {
    try { fs.symlinkSync(target, link, 'dir'); }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
  }

  const cfgPath = path.join(userHome, 'openclaw.json');
  if (!fs.existsSync(cfgPath)) {
    const cfg = {
      agents: {},
      channels: {},
      gateway: {
        mode: 'local',
        bind: 'loopback',
        auth: { mode: 'token' },
      },
    };
    // Inline shared providers — OpenClaw rejects $include paths outside the config
    // root (security check, follows symlinks too). Inlining keeps everything inside
    // the per-user dir. Re-inline on admin provider rotation by re-running provision.
    const providers = readSharedProviders();
    if (providers) Object.assign(cfg, providers);
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  }

  const cronPath = path.join(userHome, 'cron', 'jobs.json');
  if (!fs.existsSync(cronPath)) {
    fs.writeFileSync(cronPath, JSON.stringify({ jobs: [] }, null, 2));
  }

  // Inherit admin's AOC device-pairing so the user's gateway grants AOC the
  // operator.* scopes on first connect (no manual `openclaw devices approve`).
  // Admin (userId=1) is the source — their own home is OPENCLAW_BASE.
  if (Number(userId) !== 1) {
    try { inheritAdminDeviceScopes(require('./config.cjs').OPENCLAW_BASE, userHome); }
    catch (e) { console.warn(`[orchestrator] inheritAdminDeviceScopes(${userId}) failed: ${e.message}`); }
  }
}

function getBackoffSchedule() {
  const raw = process.env.GATEWAY_BACKOFF_MS;
  if (raw) return raw.split(',').map(Number);
  return [5_000, 30_000, 300_000];
}

// ─── Process supervision state ───────────────────────────────────────────────

const children = new Map();   // userId → { child, port, token, startedAt, retryCount }

class GatewaySpawnError extends Error {
  constructor(message, options) { super(message, options); this.name = 'GatewaySpawnError'; }
}

async function waitGatewayReady(port, token, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise((resolve) => {
      let settled = false;
      const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const finish = (v) => { if (settled) return; settled = true; try { ws.close(); } catch (_) {} resolve(v); };
      ws.once('open',  () => finish(true));
      ws.once('error', () => finish(false));
      setTimeout(() => finish(false), 1500);
    });
    if (ok) return;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`gateway readiness timeout after ${timeoutMs}ms (port ${port})`);
}

// ─── Public API ──────────────────────────────────────────────────────────────

async function spawnGateway(userId) {
  const port  = await allocatePort();
  const token = generateToken();
  const userHome = getUserHome(userId);
  ensureUserHome(userId, userHome);

  const openclawBin = process.env.OPENCLAW_BIN || '/opt/homebrew/bin/openclaw';
  const logFile = path.join(userHome, 'logs', 'gateway.log');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const out = fs.openSync(logFile, 'a');
  const err = fs.openSync(logFile, 'a');

  // OpenClaw treats OPENCLAW_HOME as the user homedir and appends ".openclaw" to get
  // the state dir. Setting OPENCLAW_HOME=<userHome> would resolve state dir to
  // <userHome>/.openclaw — wrong path. Use OPENCLAW_STATE_DIR to point at the state
  // dir directly (and OPENCLAW_HOME at the parent for any tooling that reads HOME).
  const childEnv = {
    ...process.env,
    OPENCLAW_HOME: path.dirname(userHome),
    OPENCLAW_STATE_DIR: userHome,
    OPENCLAW_GATEWAY_TOKEN: token,
    OPENCLAW_GATEWAY_PORT: String(port),
  };

  // For mock-binary tests: openclawBin may be a .cjs script. Detect and pass through node.
  const isJsBin = openclawBin.endsWith('.cjs') || openclawBin.endsWith('.js') || openclawBin.endsWith('.mjs');
  const cmd  = isJsBin ? process.execPath : openclawBin;
  const args = isJsBin ? [openclawBin] : ['gateway'];

  const child = spawn(cmd, args, {
    detached: true,
    stdio: ['ignore', out, err],
    env: childEnv,
  });
  child.unref();

  // Track early exit so we can fail fast instead of waiting the full 30s timeout.
  let earlyExit = null;
  const earlyExitListener = (code, signal) => { earlyExit = { code, signal }; };
  child.on('exit', earlyExitListener);

  try {
    await Promise.race([
      waitGatewayReady(port, token, 30_000),
      new Promise((_, reject) => {
        const interval = setInterval(() => {
          if (earlyExit) {
            clearInterval(interval);
            reject(new Error(`gateway exited before ready: code=${earlyExit.code} signal=${earlyExit.signal}`));
          }
        }, 200);
      }),
    ]);
  } catch (e) {
    child.removeListener('exit', earlyExitListener);

    // Read tail of gateway log for context.
    let logTail = '';
    try {
      if (fs.existsSync(logFile)) {
        const stat = fs.statSync(logFile);
        const start = Math.max(0, stat.size - 2000);
        const fd = fs.openSync(logFile, 'r');
        const buf = Buffer.alloc(stat.size - start);
        fs.readSync(fd, buf, 0, buf.length, start);
        fs.closeSync(fd);
        logTail = buf.toString('utf8').slice(-1500);
      }
    } catch (_) {}

    if (!earlyExit) {
      try { process.kill(child.pid, 'SIGTERM'); } catch (_) {}
    }
    const msg = `spawn failed for user ${userId}: ${e.message}` +
      (logTail ? `\n--- gateway.log tail ---\n${logTail}` : '');
    throw new GatewaySpawnError(msg, { cause: e });
  }

  // Readiness confirmed — detach the early-exit listener and wire the supervisor.
  child.removeListener('exit', earlyExitListener);

  children.set(userId, { child, port, token, startedAt: Date.now(), retryCount: 0 });
  db.setGatewayState(userId, { port, pid: child.pid, state: 'running' });
  orchestratorEvents.emit('spawned', { userId: Number(userId), port, pid: child.pid, token });

  child.on('exit', (code, signal) => onChildExit(userId, code, signal));

  return { port, pid: child.pid, token };
}

async function stopGateway(userId, opts = {}) {
  const entry = children.get(userId);
  children.delete(userId);
  if (entry) {
    try { process.kill(entry.child.pid, 'SIGTERM'); } catch (_) {}
    const deadline = Date.now() + (opts.killTimeoutMs ?? 10_000);
    while (Date.now() < deadline) {
      let alive = true;
      try { process.kill(entry.child.pid, 0); } catch { alive = false; }
      if (!alive) break;
      await new Promise(r => setTimeout(r, 100));
    }
    try { process.kill(entry.child.pid, 'SIGKILL'); } catch (_) {}
  }
  db.setGatewayState(userId, { port: null, pid: null, state: 'stopped' });
  orchestratorEvents.emit('stopped', { userId: Number(userId) });
}

async function restartGateway(userId) {
  await stopGateway(userId);
  return spawnGateway(userId);
}

function onChildExit(userId, code, signal) {
  const entry = children.get(userId);
  if (!entry) return;
  console.warn(`[gw:user-${userId}] exit code=${code} signal=${signal} retry=${entry.retryCount}`);

  const schedule = getBackoffSchedule();
  if (entry.retryCount >= schedule.length) {
    db.setGatewayState(userId, { port: null, pid: null, state: 'error' });
    orchestratorEvents.emit('stopped', { userId: Number(userId), reason: 'giving-up' });
    children.delete(userId);
    console.error(`[gw:user-${userId}] giving up after ${schedule.length} failed restarts`);
    return;
  }

  const backoff = schedule[entry.retryCount];
  const retryCount = entry.retryCount + 1;
  // Remove the crashed entry before respawn so allocatePort doesn't block on stale port
  children.delete(userId);
  setTimeout(async () => {
    try {
      await spawnGateway(userId);
      // Preserve retry count in the new entry
      const newEntry = children.get(userId);
      if (newEntry) {
        newEntry.retryCount = retryCount;
        children.set(userId, newEntry);
      }
    } catch (e) {
      console.error(`[gw:user-${userId}] respawn failed: ${e.message}`);
      // Trigger another cycle with incremented retryCount by setting a transient entry
      const fakeEntry = { retryCount };
      children.set(userId, fakeEntry);
      onChildExit(userId, null, null);
    }
  }, backoff);
}

function getGatewayState(userId) {
  return db.getGatewayState(userId);
}

/**
 * Read the in-memory token for a running gateway. Returns null if the gateway
 * is not in the orchestrator's children map (never spawned, or AOC restarted).
 * @param {number|string} userId
 * @returns {string|null}
 */
function getRunningToken(userId) {
  const entry = children.get(Number(userId));
  return entry?.token ?? null;
}

function listGateways() {
  return db.listGatewayStates();
}

async function cleanupOrphans() {
  const rows = db.listGatewayStates();
  for (const { pid } of rows) {
    if (pid == null) continue;
    let alive = true;
    try { process.kill(pid, 0); } catch { alive = false; }
    if (alive) {
      try { process.kill(pid, 'SIGTERM'); } catch (_) {}
      await new Promise(r => setTimeout(r, 200));
      try { process.kill(pid, 0); process.kill(pid, 'SIGKILL'); } catch (_) {}
    }
  }
  db.clearAllGatewayStates();
  for (const userId of Array.from(children.keys())) children.delete(userId);
}

async function gracefulShutdown() {
  const userIds = Array.from(children.keys());
  await Promise.all(userIds.map(uid => stopGateway(uid)));
}

module.exports = {
  spawnGateway, stopGateway, restartGateway,
  getGatewayState, listGateways, getRunningToken,
  cleanupOrphans, gracefulShutdown,
  on:  (...a) => orchestratorEvents.on(...a),
  off: (...a) => orchestratorEvents.off(...a),
  // Test-only
  _test: {
    generateToken, allocatePort, ensureUserHome, waitGatewayReady,
    _dropFromMemory: (userId) => { children.delete(userId); },
    _emitter: orchestratorEvents,
  },
};
