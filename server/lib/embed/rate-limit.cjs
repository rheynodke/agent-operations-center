// server/lib/embed/rate-limit.cjs
// Sliding-window rate limiter with persisted snapshot.
//
// In-memory Map keyed by scopeKey holds { windowStart, count }.
// hit() checks whether the current window has expired; if so, resets.
// persistSnapshot() upserts every in-memory entry into SQLite.
// hydrate() reloads persisted state on startup so counters survive restarts.
'use strict';

const { getDb, persist } = require('../db/_handle.cjs');

// scopeKey -> { windowStart: number (ms epoch), count: number }
const _state = new Map();

function _now() { return Date.now(); }

/**
 * Record a hit for `scopeKey`.
 *
 * @param {{ scopeKey: string, windowMs: number, max: number }} opts
 * @returns {{ allowed: boolean, count: number, retryAfterMs: number }}
 */
function hit({ scopeKey, windowMs, max }) {
  const now = _now();
  const cur = _state.get(scopeKey);

  if (!cur || now - cur.windowStart >= windowMs) {
    // No existing entry or window has expired — start a fresh window.
    _state.set(scopeKey, { windowStart: now, count: 1 });
    return { allowed: true, count: 1, retryAfterMs: 0 };
  }

  cur.count += 1;

  if (cur.count > max) {
    const retryAfterMs = windowMs - (now - cur.windowStart);
    return { allowed: false, count: cur.count, retryAfterMs };
  }

  return { allowed: true, count: cur.count, retryAfterMs: 0 };
}

/**
 * Flush all in-memory entries to `embed_rate_limit_state` via UPSERT.
 * Safe to call frequently — each call is a single transaction batch.
 */
function persistSnapshot() {
  const db = getDb();
  if (!db) return; // not yet initialised (e.g. very early boot)
  const now = _now();
  for (const [scopeKey, { windowStart, count }] of _state.entries()) {
    const stmt = db.prepare(`
      INSERT INTO embed_rate_limit_state (scope_key, window_start, count, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(scope_key) DO UPDATE SET
        window_start = excluded.window_start,
        count        = excluded.count,
        updated_at   = excluded.updated_at
    `);
    stmt.run([scopeKey, windowStart, count, now]);
    stmt.free();
  }
  persist();
}

/**
 * Load persisted state from SQLite into the in-memory Map.
 * Call once on server startup after initDatabase().
 */
function hydrate() {
  const db = getDb();
  if (!db) return;
  const r = db.exec('SELECT scope_key, window_start, count FROM embed_rate_limit_state');
  if (!r.length) return;
  for (const row of r[0].values) {
    _state.set(row[0], { windowStart: row[1], count: row[2] });
  }
}

let _persistTimer = null;

/**
 * Start a background setInterval that calls persistSnapshot() every
 * `intervalMs` milliseconds. Idempotent — calling twice is safe.
 *
 * @param {number} [intervalMs=30_000]
 */
function startBackgroundPersist(intervalMs = 30_000) {
  if (_persistTimer) return;
  _persistTimer = setInterval(() => {
    try {
      persistSnapshot();
    } catch (e) {
      console.error('[rate-limit] background persist error:', e.message);
    }
  }, intervalMs);
  // Don't keep the process alive just for the persister.
  _persistTimer.unref?.();
}

/**
 * Stop the background persist timer (useful for graceful shutdown / tests).
 */
function stopBackgroundPersist() {
  if (_persistTimer) {
    clearInterval(_persistTimer);
    _persistTimer = null;
  }
}

/**
 * Clear all in-memory state. For use in tests only.
 */
function _resetForTests() {
  _state.clear();
}

module.exports = {
  hit,
  persistSnapshot,
  hydrate,
  startBackgroundPersist,
  stopBackgroundPersist,
  _resetForTests,
};
