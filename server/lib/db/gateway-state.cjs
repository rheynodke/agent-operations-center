'use strict';

/**
 * Gateway lifecycle state + atomic port reservations.
 *
 * Two concerns kept together because they coordinate the same lifecycle:
 *
 * 1. **Per-user gateway columns on `users`** (gateway_pid, gateway_port,
 *    gateway_state, gateway_token). Cleared on graceful stop; survive AOC
 *    restart so the orchestrator can re-attach to a still-alive child.
 *
 * 2. **`port_reservations` table** — the atomic claim register. Each row is
 *    one port; reservations grab triples (p, p+1, p+2) for the WS / canvas /
 *    browser-control needs of a gateway. sql.js is single-threaded, so the
 *    scan-and-insert loop in `reservePortTriple` cannot race with another
 *    handler in the same Node process.
 */

const crypto = require('node:crypto');
const handle = require('./_handle.cjs');
function _db() { return handle.getDb(); }

// ─── Gateway state on `users` ───────────────────────────────────────────────

/**
 * Persist gateway lifecycle for a user. `token === undefined` keeps the
 * stored token untouched (used during state-only transitions). `token === null`
 * (or any other falsy non-undefined) clears it on graceful stop.
 */
function setGatewayState(userId, { port, pid, state, token }) {
  const db = _db();
  if (!db) return;
  if (token === undefined) {
    db.run(
      "UPDATE users SET gateway_port = ?, gateway_pid = ?, gateway_state = ? WHERE id = ?",
      [port, pid, state, Number(userId)]
    );
  } else {
    db.run(
      "UPDATE users SET gateway_port = ?, gateway_pid = ?, gateway_state = ?, gateway_token = ? WHERE id = ?",
      [port, pid, state, token, Number(userId)]
    );
  }
}

function getGatewayToken(userId) {
  const db = _db();
  if (!db) return null;
  const res = db.exec("SELECT gateway_token FROM users WHERE id = ?", [Number(userId)]);
  return res[0]?.values?.[0]?.[0] || null;
}

function getGatewayState(userId) {
  const db = _db();
  if (!db) return { port: null, pid: null, state: null };
  const res = db.exec(
    "SELECT gateway_port, gateway_pid, gateway_state FROM users WHERE id = ?",
    [Number(userId)]
  );
  const row = res[0]?.values?.[0];
  if (!row) return { port: null, pid: null, state: null };
  return {
    port:  row[0] != null ? Number(row[0]) : null,
    pid:   row[1] != null ? Number(row[1]) : null,
    state: row[2] != null ? String(row[2]) : null,
  };
}

function listGatewayStates() {
  const db = _db();
  if (!db) return [];
  const res = db.exec(
    "SELECT id, gateway_port, gateway_pid, gateway_state FROM users WHERE gateway_state IS NOT NULL AND gateway_state != 'stopped' AND gateway_state != ''"
  );
  return (res[0]?.values || []).map(([id, port, pid, state]) => ({
    userId: Number(id),
    port:  port != null ? Number(port) : null,
    pid:   pid != null ? Number(pid) : null,
    state: state != null ? String(state) : null,
  }));
}

function clearAllGatewayStates() {
  const db = _db();
  if (!db) return;
  db.run("UPDATE users SET gateway_port = NULL, gateway_pid = NULL, gateway_state = NULL");
}

// ─── port_reservations (atomic per-host port claim) ─────────────────────────

const _PORT_BASE_DEFAULT = 19000;
const _PORT_END_DEFAULT  = 19999;

function _portRowExists(port) {
  const db = _db();
  const r = db.exec('SELECT 1 FROM port_reservations WHERE port = ? LIMIT 1', [port]);
  return r.length > 0 && r[0].values.length > 0;
}

function _userGatewayPortInUse(port) {
  const db = _db();
  const r = db.exec(
    'SELECT 1 FROM users WHERE gateway_port = ? AND gateway_state IS NOT NULL LIMIT 1',
    [port],
  );
  return r.length > 0 && r[0].values.length > 0;
}

/**
 * Atomically reserve a free contiguous stride-3 port triple. Caller MUST
 * eventually call `markReservationLive` (success) or `releaseReservation`
 * (failure / shutdown) — otherwise the rows leak.
 */
function reservePortTriple(userId, opts = {}) {
  const db = _db();
  if (!db) throw new Error('db not initialized');
  const base = opts.base || _PORT_BASE_DEFAULT;
  const end  = opts.end  || _PORT_END_DEFAULT;
  const exclude = new Set(opts.exclude || []);
  const reservationId = crypto.randomUUID();
  const now = Date.now();

  for (let p = base; p <= end - 2; p += 3) {
    if (exclude.has(p) || exclude.has(p + 1) || exclude.has(p + 2)) continue;
    if (_portRowExists(p) || _portRowExists(p + 1) || _portRowExists(p + 2)) continue;
    if (_userGatewayPortInUse(p) || _userGatewayPortInUse(p + 1) || _userGatewayPortInUse(p + 2)) continue;

    try {
      db.run(
        `INSERT INTO port_reservations (port, user_id, reservation_id, reserved_at, pid, state)
         VALUES (?, ?, ?, ?, NULL, 'reserving'),
                (?, ?, ?, ?, NULL, 'reserving'),
                (?, ?, ?, ?, NULL, 'reserving')`,
        [
          p,     userId, reservationId, now,
          p + 1, userId, reservationId, now,
          p + 2, userId, reservationId, now,
        ],
      );
      handle.persist();
      return { port: p, reservationId };
    } catch {
      continue;
    }
  }
  throw new Error('PORT_POOL_EXHAUSTED');
}

function markReservationSpawning(reservationId, pid) {
  const db = _db();
  if (!db) return;
  db.run(
    "UPDATE port_reservations SET state = 'spawning', pid = ? WHERE reservation_id = ?",
    [pid, reservationId],
  );
  handle.persist();
}

function markReservationLive(reservationId) {
  const db = _db();
  if (!db) return;
  db.run(
    "UPDATE port_reservations SET state = 'live' WHERE reservation_id = ?",
    [reservationId],
  );
  handle.persist();
}

function releaseReservation(reservationId) {
  const db = _db();
  if (!db) return;
  db.run('DELETE FROM port_reservations WHERE reservation_id = ?', [reservationId]);
  handle.persist();
}

function releaseReservationByUser(userId) {
  const db = _db();
  if (!db) return;
  db.run('DELETE FROM port_reservations WHERE user_id = ?', [userId]);
  handle.persist();
}

function findDeadReservations() {
  const db = _db();
  if (!db) return [];
  const r = db.exec("SELECT port, user_id, reservation_id, pid, state FROM port_reservations WHERE pid IS NOT NULL");
  if (!r.length) return [];
  const out = [];
  for (const row of r[0].values) {
    const [port, user_id, reservation_id, pid, state] = row;
    let alive = false;
    try { process.kill(pid, 0); alive = true; } catch { alive = false; }
    if (!alive) out.push({ port, userId: user_id, reservationId: reservation_id, pid, state });
  }
  return out;
}

function findStaleReservations(olderThanMs = 5 * 60 * 1000) {
  const db = _db();
  if (!db) return [];
  const cutoff = Date.now() - olderThanMs;
  const r = db.exec(
    "SELECT port, user_id, reservation_id, pid, state FROM port_reservations " +
    "WHERE state = 'reserving' AND reserved_at < ?",
    [cutoff],
  );
  if (!r.length) return [];
  return r[0].values.map(([port, user_id, reservation_id, pid, state]) => ({
    port, userId: user_id, reservationId: reservation_id, pid, state,
  }));
}

function listReservations() {
  const db = _db();
  if (!db) return [];
  const r = db.exec("SELECT port, user_id, reservation_id, pid, state FROM port_reservations");
  if (!r.length) return [];
  return r[0].values.map(([port, user_id, reservation_id, pid, state]) => ({
    port, userId: user_id, reservationId: reservation_id, pid, state,
  }));
}

module.exports = {
  setGatewayState,
  getGatewayToken,
  getGatewayState,
  listGatewayStates,
  clearAllGatewayStates,
  reservePortTriple,
  markReservationSpawning,
  markReservationLive,
  releaseReservation,
  releaseReservationByUser,
  findDeadReservations,
  findStaleReservations,
  listReservations,
};
