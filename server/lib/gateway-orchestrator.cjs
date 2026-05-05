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
  // Each gateway opens 3 consecutive ports (WS / canvas / browser-control).
  // Stride by 3 so allocations don't accidentally pick an in-use neighbour.
  for (let p = PORT_RANGE_START; p <= PORT_RANGE_END - 2; p += 3) {
    if (used.has(p) || used.has(p + 1) || used.has(p + 2)) continue;
    // Also probe the actual OS port — DB may be stale after a crash, or
    // another gateway from a prior AOC session may still hold the socket.
    if (await _isPortFree(p) && await _isPortFree(p + 1) && await _isPortFree(p + 2)) {
      return p;
    }
  }
  throw new Error(`Gateway port pool exhausted (${PORT_RANGE_START}-${PORT_RANGE_END})`);
}

function _isPortFree(port) {
  return new Promise((resolve) => {
    const net = require('net');
    const tester = net.createServer();
    tester.once('error', () => resolve(false));
    tester.once('listening', () => tester.close(() => resolve(true)));
    tester.listen(port, '127.0.0.1');
  });
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
    // Inherit admin's agent defaults (model, tools, skills) so newly provisioned
    // agents start with a working LLM out of the box. Also inherit the
    // top-level `tools` profile and `approvals` config so per-user gateways
    // share the same exec/fs/approval semantics admin uses (full exec, no
    // approval prompts on safe ops — risky ops still surface via prompting
    // inside the LLM, not via gateway approval gates).
    let inheritedDefaults = {};
    let inheritedTools = {};
    let inheritedApprovals = {};
    try {
      const adminCfg = JSON.parse(fs.readFileSync(path.join(require('./config.cjs').OPENCLAW_BASE, 'openclaw.json'), 'utf8'));
      inheritedDefaults = { ...(adminCfg?.agents?.defaults || {}) };
      inheritedTools = adminCfg?.tools ? JSON.parse(JSON.stringify(adminCfg.tools)) : {};
      inheritedApprovals = adminCfg?.approvals ? JSON.parse(JSON.stringify(adminCfg.approvals)) : {};
    } catch (_) { /* admin config missing — leave defaults empty */ }

    // Rewrite admin-scoped paths to per-user paths so we don't leak admin's
    // workspace contents (IDENTITY.md, SOUL.md, MEMORY.md, etc.) into the new
    // user's gateway. Per-agent workspace fields are set explicitly during
    // provisioning; this is the fallback for "default agent" sessions.
    inheritedDefaults.workspace = path.join(userHome, 'workspace');

    // Ensure the per-user workspace dir exists (the symlink to shared skills
    // was already created above; we add the dir itself if missing).
    fs.mkdirSync(inheritedDefaults.workspace, { recursive: true });

    const cfg = {
      agents: { defaults: inheritedDefaults, list: [] },
      tools: inheritedTools,
      approvals: inheritedApprovals,
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
  // Resource cap: refuse to spawn if we've reached AOC_MAX_GATEWAYS. Counts
  // concurrently-running per-user gateways (admin's external gateway is
  // separate and not counted). Idempotent for a user that's already running.
  const cap = Number(process.env.AOC_MAX_GATEWAYS || 50);
  if (cap > 0 && !children.has(Number(userId))) {
    const liveRows = (db.listGatewayStates() || []).filter((r) => r.state === 'running' && r.pid != null);
    if (liveRows.length >= cap) {
      const err = new Error(
        `Gateway resource cap reached (${liveRows.length}/${cap}). Increase AOC_MAX_GATEWAYS or stop unused workspaces.`
      );
      err.status = 503;
      err.code = 'GATEWAY_CAP_REACHED';
      throw err;
    }
  }

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
  // Persist token so AOC can re-attach after a restart without re-spawning.
  db.setGatewayState(userId, { port, pid: child.pid, state: 'running', token });
  orchestratorEvents.emit('spawned', { userId: Number(userId), port, pid: child.pid, token });

  child.on('exit', (code, signal) => onChildExit(userId, code, signal));

  return { port, pid: child.pid, token };
}

/**
 * Find every running openclaw-gateway process whose `OPENCLAW_STATE_DIR`
 * env points at one of our per-user homes (i.e., AOC-managed). Optionally
 * filter to a specific userId. Excludes any PID in `exceptPids`.
 *
 * Used to catch orphans that survive AOC server restarts (when our
 * in-memory `children` Map is wiped but the gateway processes keep running)
 * or hot-reload-induced double-spawns.
 *
 * @param {{ userId?: number, exceptPids?: Set<number> }} opts
 * @returns {number[]} PIDs to kill
 */
/**
 * Identify each `openclaw-gateway` process by the TCP port it listens on
 * (lsof). macOS doesn't reliably expose env vars via `ps -E`, but the listen
 * port is always observable.
 *
 * Returns a map { pid: port } for ports inside our managed range
 * (PORT_RANGE_START..PORT_RANGE_END). Admin's external gateway on 18789 is
 * filtered out automatically.
 */
function _gatewayPidsByPort() {
  const cp = require('child_process');
  let pids = [];
  try {
    const out = cp.execSync('pgrep -f openclaw-gateway', { encoding: 'utf8', timeout: 2000 }).trim();
    pids = out.split('\n').filter(Boolean).map(Number).filter(Number.isFinite);
  } catch { return { managed: {}, anyPort: new Set() }; }

  const managed = {};        // pid → port (only for managed-range gateways)
  const anyPort = new Set(); // pid (any openclaw-gateway holding any TCP listen socket — incl admin's 18789)
  for (const pid of pids) {
    try {
      const lsof = cp.execSync(`lsof -p ${pid} -i tcp -P -n -a -sTCP:LISTEN 2>/dev/null`, { encoding: 'utf8', timeout: 2000 });
      // Each LISTEN line looks like:
      //   node    1762 user   15u  IPv4 0x... TCP 127.0.0.1:19000 (LISTEN)
      let hasAny = false;
      for (const line of lsof.split('\n')) {
        const m = line.match(/127\.0\.0\.1:(\d+)\s+\(LISTEN\)/);
        if (!m) continue;
        hasAny = true;
        const port = Number(m[1]);
        if (port >= PORT_RANGE_START && port <= PORT_RANGE_END) {
          // Each gateway opens browser-control on +2 / canvas on +1; the WS
          // port is the lowest in the managed range — take that one.
          if (!(pid in managed) || port < managed[pid]) managed[pid] = port;
        }
      }
      if (hasAny) anyPort.add(pid);
    } catch { /* lsof refused or process gone */ }
  }
  return { managed, anyPort };
}

function findAocManagedOrphanPids({ userId = null, exceptPids = new Set() } = {}) {
  const cp = require('child_process');
  // List ALL openclaw-gateway PIDs first — including zombies that no longer
  // hold a listen socket (a partial-shutdown leak).
  let allPids = [];
  try {
    const out = cp.execSync('pgrep -f openclaw-gateway', { encoding: 'utf8', timeout: 2000 }).trim();
    allPids = out.split('\n').filter(Boolean).map(Number).filter(Number.isFinite);
  } catch { return []; }
  if (!allPids.length) return [];

  const { managed: pidPort, anyPort } = _gatewayPidsByPort();

  // Build a set of "expected" {pid, port} pairs from DB.
  const expectedByUser = new Map();   // userId → { pid, port }
  let expectedPort = null;
  try {
    for (const row of (db.listGatewayStates() || [])) {
      if (row.pid != null && row.port != null) {
        expectedByUser.set(Number(row.user_id ?? row.userId), { pid: Number(row.pid), port: Number(row.port) });
      }
    }
    if (userId != null) {
      const e = expectedByUser.get(Number(userId));
      expectedPort = e ? e.port : null;
    }
  } catch { /* DB unavailable */ }

  const matched = [];
  for (const [pidStr, port] of Object.entries(pidPort)) {
    const pid = Number(pidStr);
    if (exceptPids.has(pid)) continue;

    if (userId != null) {
      // For a specific user: kill any gateway listening on their expected port
      // AND any gateway listening on a managed-range port that ISN'T held by
      // some other tracked user (catches duplicates after our own respawn).
      if (expectedPort != null && port === expectedPort) {
        // Don't kill the currently-tracked PID itself.
        if (expectedByUser.get(Number(userId))?.pid === pid) continue;
        matched.push(pid);
        continue;
      }
      // Skip if some other tracked user owns this port.
      const ownedByOther = Array.from(expectedByUser.values()).some(e => e.port === port && e.pid === pid);
      if (ownedByOther) continue;
      // We can't 100% prove it's the user's, but if no DB row claims this PID
      // and the user has no current PID-tracked gateway, it's almost certainly
      // a leak from a previous spawn cycle.
      if (expectedByUser.get(Number(userId)) == null) {
        matched.push(pid);
      }
    } else {
      // No userId filter: kill any managed-range gateway not held by any tracked user.
      const ownedByAny = Array.from(expectedByUser.values()).some(e => e.pid === pid && e.port === port);
      if (!ownedByAny) matched.push(pid);
    }
  }

  // Catch true zombie launchers: openclaw-gateway processes with NO listen
  // socket AT ALL (not just managed range — admin's external gateway listens
  // on 18789 and must NOT be killed) AND NO live openclaw-gateway children
  // (i.e., the inner server has already died and only the launcher is left).
  const trackedPids = new Set(Array.from(expectedByUser.values()).map((e) => e.pid));
  for (const pid of allPids) {
    if (exceptPids.has(pid)) continue;
    if (matched.includes(pid)) continue;
    if (trackedPids.has(pid)) continue;
    if (anyPort.has(pid)) continue;   // Holds *some* listen port (managed OR admin's 18789) — leave alone
    // Check if it has live openclaw-gateway children — if so, it's an active launcher.
    let hasLiveChild = false;
    try {
      const childOut = cp.execSync(`pgrep -P ${pid}`, { encoding: 'utf8', timeout: 2000 }).trim();
      const childPids = childOut.split('\n').filter(Boolean).map(Number);
      for (const c of childPids) {
        if (allPids.includes(c) || anyPort.has(c)) { hasLiveChild = true; break; }
      }
    } catch { /* no children */ }
    if (hasLiveChild) continue;
    matched.push(pid);
  }

  return matched;
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

  // Belt-and-suspenders: kill any AOC-managed gateway process whose state-dir
  // is this user's home (handles orphans from prior AOC restarts where the
  // child Map was wiped but the OS process kept running).
  try {
    const orphans = findAocManagedOrphanPids({ userId: Number(userId) });
    for (const pid of orphans) {
      try { process.kill(pid, 'SIGTERM'); } catch (_) {}
    }
    if (orphans.length) {
      await new Promise(r => setTimeout(r, 800));
      for (const pid of orphans) {
        try { process.kill(pid, 0); process.kill(pid, 'SIGKILL'); } catch (_) {}
      }
      console.warn(`[gw:user-${userId}] killed ${orphans.length} orphan gateway PID(s): ${orphans.join(', ')}`);
    }
  } catch (e) {
    console.warn(`[gw:user-${userId}] orphan sweep failed: ${e.message}`);
  }

  // Clear token along with port/pid — gateway is gone, no point keeping creds.
  db.setGatewayState(userId, { port: null, pid: null, state: 'stopped', token: null });
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
 * Read the token for a running gateway. Prefers the in-memory map (fastest)
 * but falls back to the persisted DB column so AOC can re-attach after a
 * restart without losing access to a still-running gateway.
 * @param {number|string} userId
 * @returns {string|null}
 */
function getRunningToken(userId) {
  const entry = children.get(Number(userId));
  if (entry?.token) return entry.token;
  // Fallback: AOC restarted but the gateway process is still alive.
  return db.getGatewayToken(Number(userId)) || null;
}

function listGateways() {
  return db.listGatewayStates();
}

/**
 * Reconcile DB-tracked gateways with what's actually running on the machine
 * after AOC starts up. Behavior is RE-ATTACH, not kill:
 *
 *   - DB row says PID=X is running:
 *       * X alive → leave it alone, mark in-memory state with {port, token}
 *         so subsequent calls can route to it. (No `child` handle; we lost that
 *         when AOC restarted, but PID is enough for SIGTERM/RPC routing.)
 *       * X dead → clear DB row (gateway crashed while AOC was down).
 *   - Truly untracked openclaw-gateway leftovers (PID listening on a managed-
 *     range port with no DB row, or zombie launchers with no children) → kill.
 *
 * This preserves user-gateway isolation across AOC restarts: pm2 restart of
 * AOC does NOT disrupt running per-user OpenClaw processes.
 */
async function cleanupOrphans() {
  const rows = db.listGatewayStates();
  const reattached = [];
  for (const { userId, port, pid, state } of rows) {
    if (pid == null) continue;
    let alive = true;
    try { process.kill(pid, 0); } catch { alive = false; }
    if (alive) {
      // Re-attach: mark in-memory entry so stopGateway/restart can route to
      // this PID. We can't recover the original ChildProcess handle (it died
      // with AOC), so use a minimal stub. retryCount=0 means crash supervisor
      // will not respawn unless this PID's exit signal reaches us — which it
      // won't because it was detached. Acceptable: gateway is independent.
      const token = db.getGatewayToken(userId);
      children.set(userId, {
        child: { pid, removeListener() {}, on() {} }, // stub for stopGateway compat
        port: port ?? null,
        token: token || null,
        startedAt: Date.now(),
        retryCount: 0,
        reattached: true,
      });
      reattached.push({ userId, pid, port });
    } else {
      // Stale DB row — gateway died while AOC was down. Clear it.
      db.setGatewayState(userId, { port: null, pid: null, state: 'stopped', token: null });
    }
    // Honor 'stopped'/'error' states explicitly — don't reattach if user had
    // intentionally stopped the gateway before AOC went down.
    if (alive && state && state !== 'running' && state !== 'starting') {
      children.delete(userId);
    }
  }
  if (reattached.length) {
    console.log(`[orchestrator] cleanupOrphans: re-attached ${reattached.length} live gateway(s) ${reattached.map(r => `uid=${r.userId} pid=${r.pid} port=${r.port}`).join(', ')}`);
  }

  // Sweep truly orphan processes: openclaw-gateway listening on a managed-range
  // port with no DB row claiming it, OR zombie launchers (no port + no children).
  try {
    const orphans = findAocManagedOrphanPids({});
    for (const pid of orphans) {
      try { process.kill(pid, 'SIGTERM'); } catch (_) {}
    }
    if (orphans.length) {
      await new Promise(r => setTimeout(r, 800));
      for (const pid of orphans) {
        try { process.kill(pid, 0); process.kill(pid, 'SIGKILL'); } catch (_) {}
      }
      console.warn(`[orchestrator] cleanupOrphans: killed ${orphans.length} untracked gateway PID(s) [${orphans.join(', ')}]`);
    }
  } catch (e) {
    console.warn(`[orchestrator] cleanupOrphans orphan sweep failed: ${e.message}`);
  }
}

/**
 * Shut down AOC cleanly WITHOUT terminating per-user gateways. Per-tenant
 * isolation: a user's gateway should keep running across an AOC pm2 restart.
 * On next AOC start, `cleanupOrphans()` re-attaches via PID + persisted token.
 */
async function gracefulShutdown() {
  console.log(`[orchestrator] gracefulShutdown: leaving ${children.size} per-user gateway(s) running for next AOC startup`);
  // Drop in-memory child references so the supervisor stops listening for
  // exit events on processes we no longer own. No SIGTERM sent.
  children.clear();
}

module.exports = {
  spawnGateway, stopGateway, restartGateway,
  getGatewayState, listGateways, getRunningToken,
  cleanupOrphans, gracefulShutdown, findAocManagedOrphanPids,
  on:  (...a) => orchestratorEvents.on(...a),
  off: (...a) => orchestratorEvents.off(...a),
  // Test-only
  _test: {
    generateToken, allocatePort, ensureUserHome, waitGatewayReady,
    _dropFromMemory: (userId) => { children.delete(userId); },
    _emitter: orchestratorEvents,
  },
};
