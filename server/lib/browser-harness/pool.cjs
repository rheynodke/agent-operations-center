'use strict';
/**
 * Browser-harness pool manager.
 *
 * Session-1 MVP: 1 slot. Designed for expansion to 3 slots in session-2 by
 * lifting the singleton state into a Map keyed by slotId.
 *
 * Lifecycle:
 *   - boot()           — manual boot (admin button on dashboard)
 *   - acquire(agentId) — task runner reserves the slot for a task; auto-boots if needed
 *   - release()        — task runner returns the slot
 *   - stop()           — manual quit (admin button)
 *   - idle GC          — slots idle > IDLE_TIMEOUT_MS get auto-quit to free RAM
 *
 * In-memory only; pool state is rebuilt on AOC restart by probing live ports.
 */
const launcher = require('./launcher.cjs');

const SLOTS = [
  { id: 1, port: 9222 },
  { id: 2, port: 9223 },
  { id: 3, port: 9224 },
];

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;       // auto-quit Chrome 5 min after release
const IDLE_GC_INTERVAL_MS = 60 * 1000;       // sweep every minute

/** @type {Map<number, { state: 'down'|'booting'|'idle'|'busy', pid?: number, port: number, profile?: string, version?: string, webSocketDebuggerUrl?: string, agentId?: string|null, since: number, lastReleasedAt?: number }>} */
const slots = new Map();

function now() { return Date.now(); }

function getSlot(slotId = 1) {
  return slots.get(slotId);
}

function ensureSlot(slotId = 1) {
  let s = slots.get(slotId);
  if (!s) {
    const def = SLOTS.find(d => d.id === slotId);
    if (!def) throw new Error(`Unknown slot ${slotId}`);
    s = { state: 'down', port: def.port, since: now() };
    slots.set(slotId, s);
  }
  return s;
}

function snapshot() {
  for (const def of SLOTS) ensureSlot(def.id);
  return Array.from(slots.values()).map(s => ({
    id: [...slots.entries()].find(([, v]) => v === s)[0],
    state: s.state,
    port: s.port,
    pid: s.pid || null,
    pidAlive: s.pid ? launcher.isProcessAlive(s.pid) : false,
    profile: s.profile || null,
    version: s.version || null,
    agentId: s.agentId || null,
    since: s.since,
    lastReleasedAt: s.lastReleasedAt || null,
    idleMs: s.state === 'idle' && s.lastReleasedAt ? now() - s.lastReleasedAt : null,
  }));
}

async function boot(slotId = 1) {
  const s = ensureSlot(slotId);
  if (s.state === 'busy') {
    throw new Error(`Slot ${slotId} is in use by agent "${s.agentId}"`);
  }
  if (s.state === 'idle' && s.pid && launcher.isProcessAlive(s.pid)) {
    return snapshot().find(x => x.id === slotId);
  }
  s.state = 'booting'; s.since = now();
  try {
    const info = await launcher.launchChrome({ slotId, port: s.port });
    Object.assign(s, {
      state: 'idle',
      pid: info.pid,
      profile: info.profile,
      version: info.version,
      webSocketDebuggerUrl: info.webSocketDebuggerUrl,
      since: now(),
      lastReleasedAt: now(),
    });
    return snapshot().find(x => x.id === slotId);
  } catch (err) {
    s.state = 'down'; s.pid = undefined; s.since = now();
    throw err;
  }
}

async function acquire(slotId = null, agentId = null) {
  // No slotId specified → find first non-busy slot, prefer ones already idle
  // (saves boot time). If all are busy, throw.
  if (!slotId) {
    for (const def of SLOTS) ensureSlot(def.id);
    const candidates = Array.from(slots.entries());
    const idle = candidates.find(([, s]) => s.state === 'idle' && s.pid && launcher.isProcessAlive(s.pid));
    const down = candidates.find(([, s]) => s.state === 'down');
    const pick = idle || down;
    if (!pick) {
      throw new Error('All browser pool slots are busy. Wait for a slot to release or expand pool size.');
    }
    slotId = pick[0];
  }

  const s = ensureSlot(slotId);
  if (s.state === 'busy') {
    throw new Error(`Slot ${slotId} is busy (agent "${s.agentId}")`);
  }
  if (s.state === 'down' || (s.pid && !launcher.isProcessAlive(s.pid))) {
    await boot(slotId);
  }
  s.state = 'busy';
  s.agentId = agentId;
  s.since = now();
  return {
    slotId,
    port: s.port,
    profile: s.profile,
    webSocketDebuggerUrl: s.webSocketDebuggerUrl,
  };
}

function release(slotId = 1) {
  const s = ensureSlot(slotId);
  if (s.state !== 'busy') return false;
  s.state = 'idle';
  s.agentId = null;
  s.lastReleasedAt = now();
  s.since = now();
  return true;
}

function stop(slotId = 1) {
  const s = ensureSlot(slotId);
  const pid = s.pid;
  if (pid) launcher.killChrome(pid);
  s.state = 'down';
  s.pid = undefined;
  s.profile = undefined;
  s.version = undefined;
  s.webSocketDebuggerUrl = undefined;
  s.agentId = null;
  s.since = now();
  s.lastReleasedAt = undefined;
  return true;
}

function stopAll() {
  for (const def of SLOTS) {
    try { stop(def.id); } catch (err) { console.warn(`[browser-harness] stop slot ${def.id}: ${err.message}`); }
  }
}

let _gcTimer = null;
function startIdleGc() {
  if (_gcTimer) return;
  _gcTimer = setInterval(() => {
    for (const [id, s] of slots) {
      if (s.state === 'idle' && s.lastReleasedAt && now() - s.lastReleasedAt > IDLE_TIMEOUT_MS) {
        try {
          stop(id);
          console.log(`[browser-harness] auto-quit idle slot ${id} after ${IDLE_TIMEOUT_MS / 1000}s`);
        } catch (err) {
          console.warn(`[browser-harness] auto-quit slot ${id} failed: ${err.message}`);
        }
      }
      // Also notice externally-killed Chromes
      if ((s.state === 'idle' || s.state === 'busy') && s.pid && !launcher.isProcessAlive(s.pid)) {
        console.warn(`[browser-harness] slot ${id} pid ${s.pid} died externally, marking down`);
        s.state = 'down'; s.pid = undefined;
      }
    }
  }, IDLE_GC_INTERVAL_MS);
  _gcTimer.unref?.();
}

function stopIdleGc() {
  if (_gcTimer) { clearInterval(_gcTimer); _gcTimer = null; }
}

// Best-effort cleanup on process exit.
// NOTE: Do NOT call process.exit() here — server/index.cjs owns the exit lifecycle
// via its graceful shutdown handler. Calling exit here would bypass orchestrator.gracefulShutdown.
process.once('exit', () => { try { stopAll(); } catch {} });
process.on('SIGTERM', () => { try { stopAll(); } catch {} });
process.on('SIGINT',  () => { try { stopAll(); } catch {} });

module.exports = {
  SLOTS,
  IDLE_TIMEOUT_MS,
  snapshot,
  boot,
  acquire,
  release,
  stop,
  stopAll,
  startIdleGc,
  stopIdleGc,
};
