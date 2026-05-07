'use strict';

/**
 * Third-party connection definitions (DB / SSH / Web / GitHub / MCP / Google).
 *
 * Two related concerns kept together:
 *
 * 1. **`connections` table** — credential records. Credentials column is
 *    encrypted-at-rest via `lib/integrations/base.cjs::encrypt/decrypt`.
 *    Public reads return `hasCredentials: bool` only — raw access is gated
 *    behind `getConnectionRaw` (internal use, e.g. dispatch injection).
 *
 * 2. **`agent_connections` junction** — assignment of connections to agents.
 *    Carries `owner_id` (Sprint 2 multi-tenant fix) so two users can both
 *    assign their own copy of a slug like "migi" to the same connection
 *    without leaking access. All accessors require `ownerId`.
 *
 * Ownership / access middleware (`userOwnsConnection`, `requireConnectionOwnership`,
 * `getConnectionOwner`) lives here too because it reads the same table.
 */

const handle = require('./_handle.cjs');
const { encrypt: encryptConn, decrypt: decryptConn } = require('../integrations/base.cjs');

function _db() { return handle.getDb(); }

// ─── Connections ─────────────────────────────────────────────────────────────

function normalizeConnection(row) {
  if (!row || !row.id) return null;
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    hasCredentials: !!row.credentials,
    metadata: (() => { try { return row.metadata ? JSON.parse(row.metadata) : {}; } catch { return {}; } })(),
    enabled: !!row.enabled,
    shared: !!row.shared,
    createdBy: row.created_by ?? null,
    lastTestedAt: row.last_tested_at || null,
    lastTestOk: row.last_test_ok != null ? !!row.last_test_ok : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getAllConnections() {
  const db = _db();
  if (!db) return [];
  const res = db.exec('SELECT * FROM connections ORDER BY created_at DESC');
  if (!res.length) return [];
  const cols = res[0].columns;
  return res[0].values.map(row => {
    const obj = {}; cols.forEach((c, i) => { obj[c] = row[i]; });
    return normalizeConnection(obj);
  }).filter(Boolean);
}

function getConnection(id) {
  const db = _db();
  if (!db) return null;
  const res = db.exec('SELECT * FROM connections WHERE id = ?', [id]);
  if (!res.length || !res[0].values.length) return null;
  const cols = res[0].columns;
  const obj = {}; cols.forEach((c, i) => { obj[c] = res[0].values[0][i]; });
  return normalizeConnection(obj);
}

/** Internal use only — returns decrypted credentials. Never expose to frontend. */
function getConnectionRaw(id) {
  const db = _db();
  if (!db) return null;
  const res = db.exec('SELECT * FROM connections WHERE id = ?', [id]);
  if (!res.length || !res[0].values.length) return null;
  const cols = res[0].columns;
  const obj = {}; cols.forEach((c, i) => { obj[c] = res[0].values[0][i]; });
  const meta = (() => { try { return obj.metadata ? JSON.parse(obj.metadata) : {}; } catch { return {}; } })();
  let creds = '';
  try { creds = obj.credentials ? decryptConn(obj.credentials) : ''; } catch { creds = ''; }
  return { ...obj, credentials: creds, metadata: meta };
}

function getEnabledConnectionsRaw() {
  const db = _db();
  if (!db) return [];
  const res = db.exec('SELECT * FROM connections WHERE enabled = 1');
  if (!res.length) return [];
  const cols = res[0].columns;
  return res[0].values.map(row => {
    const obj = {}; cols.forEach((c, i) => { obj[c] = row[i]; });
    const meta = (() => { try { return obj.metadata ? JSON.parse(obj.metadata) : {}; } catch { return {}; } })();
    let creds = '';
    try { creds = obj.credentials ? decryptConn(obj.credentials) : ''; } catch { creds = ''; }
    return { ...obj, credentials: creds, metadata: meta };
  });
}

function createConnection({ id, name, type, credentials, metadata, enabled, createdBy }) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  const now = new Date().toISOString();
  const encCreds = credentials ? encryptConn(credentials) : '';
  const metaStr = JSON.stringify(metadata || {});
  db.run(
    `INSERT INTO connections (id, name, type, credentials, metadata, enabled, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, name, type, encCreds, metaStr, enabled !== false ? 1 : 0, createdBy || null, now, now]
  );
  handle.persist();
  return getConnection(id);
}

function updateConnection(id, patch) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  const now = new Date().toISOString();
  const fields = ['updated_at = ?'];
  const vals = [now];
  if (patch.name        !== undefined) { fields.push('name = ?');        vals.push(patch.name); }
  if (patch.type        !== undefined) { fields.push('type = ?');        vals.push(patch.type); }
  if (patch.credentials !== undefined) { fields.push('credentials = ?'); vals.push(patch.credentials ? encryptConn(patch.credentials) : ''); }
  if (patch.metadata    !== undefined) { fields.push('metadata = ?');    vals.push(JSON.stringify(patch.metadata)); }
  if (patch.enabled     !== undefined) { fields.push('enabled = ?');     vals.push(patch.enabled ? 1 : 0); }
  if (patch.lastTestedAt !== undefined) { fields.push('last_tested_at = ?'); vals.push(patch.lastTestedAt); }
  if (patch.lastTestOk   !== undefined) { fields.push('last_test_ok = ?');   vals.push(patch.lastTestOk ? 1 : 0); }
  vals.push(id);
  db.run(`UPDATE connections SET ${fields.join(', ')} WHERE id = ?`, vals);
  handle.persist();
  return getConnection(id);
}

function deleteConnection(id) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  db.run('DELETE FROM connections WHERE id = ?', [id]);
  db.run('DELETE FROM agent_connections WHERE connection_id = ?', [id]);
  handle.persist();
}

// ─── Agent ↔ Connection assignments (junction) ─────────────────────────────

function getAgentConnectionIds(agentId, ownerId) {
  const db = _db();
  if (!db) return [];
  if (ownerId == null) throw new Error('getAgentConnectionIds: ownerId is required');
  const res = db.exec('SELECT connection_id FROM agent_connections WHERE agent_id = ? AND owner_id = ?', [agentId, Number(ownerId)]);
  if (!res.length) return [];
  return res[0].values.map(r => r[0]);
}

function getConnectionAgentIds(connectionId) {
  const db = _db();
  if (!db) return [];
  const res = db.exec('SELECT agent_id, owner_id FROM agent_connections WHERE connection_id = ?', [connectionId]);
  if (!res.length) return [];
  return res[0].values.map(r => ({ agentId: r[0], ownerId: r[1] }));
}

function setAgentConnections(agentId, connectionIds, ownerId) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  if (ownerId == null) throw new Error('setAgentConnections: ownerId is required');
  const owner = Number(ownerId);
  // Validate every requested connection is accessible to this owner — owned,
  // shared, or admin-bypass. Reject the whole call on first violation so the
  // caller never silently loses an assignment.
  for (const cid of connectionIds) {
    if (!userIdCanUseConnection(owner, cid)) {
      const err = new Error(`Connection ${cid} is not accessible to user ${owner}`);
      err.status = 403;
      err.code = 'CONNECTION_NOT_ACCESSIBLE';
      throw err;
    }
  }
  db.run('DELETE FROM agent_connections WHERE agent_id = ? AND owner_id = ?', [agentId, owner]);
  const now = new Date().toISOString();
  for (const cid of connectionIds) {
    db.run('INSERT INTO agent_connections (agent_id, connection_id, owner_id, created_at) VALUES (?, ?, ?, ?)', [agentId, cid, owner, now]);
  }
  handle.persist();
}

function getAgentConnectionsRaw(agentId, ownerId) {
  const db = _db();
  if (!db) return [];
  if (ownerId == null) throw new Error('getAgentConnectionsRaw: ownerId is required');
  const ids = getAgentConnectionIds(agentId, ownerId);
  if (ids.length === 0) return [];
  return ids.map(id => getConnectionRaw(id)).filter(c => c && c.enabled);
}

function getAllAgentConnectionAssignments(opts = {}) {
  const db = _db();
  if (!db) return {};
  const { ownerId } = opts || {};
  const res = ownerId != null
    ? db.exec('SELECT agent_id, connection_id, owner_id FROM agent_connections WHERE owner_id = ?', [Number(ownerId)])
    : db.exec('SELECT agent_id, connection_id, owner_id FROM agent_connections');
  if (!res.length) return {};
  const map = {};
  for (const [agentId, connId, ownerCol] of res[0].values) {
    if (!map[connId]) map[connId] = [];
    map[connId].push({ agentId, ownerId: ownerCol });
  }
  return map;
}

// ─── Connection sharing (org-wide boolean) ──────────────────────────────────
//
// `connections.shared = 1` means anyone on this AOC instance may USE the
// connection (assign it to their own agents — dispatch reads decrypted
// credentials at runtime). Owner + admin remain the only ones who can edit /
// delete / test / reauth / toggle the shared flag itself, and raw
// credentials are never exposed via API.

function setConnectionShared(connId, shared) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  const now = new Date().toISOString();
  db.run('UPDATE connections SET shared = ?, updated_at = ? WHERE id = ?', [shared ? 1 : 0, now, connId]);
  if (!shared) {
    // Tighten: when un-sharing, drop every assignment that came from a non-
    // owner. Otherwise the recipient's agents would silently lose access on
    // their next dispatch with no UI signal.
    const ownerRes = db.exec('SELECT created_by FROM connections WHERE id = ?', [connId]);
    const ownerId = ownerRes.length && ownerRes[0].values.length ? ownerRes[0].values[0][0] : null;
    if (ownerId != null) {
      db.run('DELETE FROM agent_connections WHERE connection_id = ? AND owner_id != ?', [connId, ownerId]);
    }
  }
  handle.persist();
  return getConnection(connId);
}

function userIdCanUseConnection(userId, connId) {
  if (userId == null) return false;
  const db = _db();
  if (!db) return false;
  const res = db.exec('SELECT created_by, shared FROM connections WHERE id = ?', [connId]);
  if (!res.length || !res[0].values.length) return false;
  const [ownerId, shared] = res[0].values[0];
  if (ownerId === userId) return true;
  if (shared) return true;
  // Admin bypass — same as userOwnsConnection.
  try {
    const u = db.exec('SELECT role FROM users WHERE id = ?', [Number(userId)]);
    if (u.length && u[0].values.length && u[0].values[0][0] === 'admin') return true;
  } catch (_) { /* users absent in tests — skip */ }
  return false;
}

function userCanUseConnection(req, connId) {
  if (!req?.user) return false;
  if (req.user.role === 'admin' || req.user.role === 'agent') return true;
  return userIdCanUseConnection(req.user.userId, connId);
}

/**
 * Returns enriched usage list for a connection: every (agent, owning user)
 * pair currently assigned to it, joined with the user's username/email so
 * the UI can show "Used by Alice's research-agent" without N round trips.
 */
function getConnectionUsage(connId) {
  const db = _db();
  if (!db) return [];
  const res = db.exec(
    `SELECT ac.agent_id, ac.owner_id, ac.created_at, u.username, u.email
       FROM agent_connections ac
       LEFT JOIN users u ON u.id = ac.owner_id
      WHERE ac.connection_id = ?
      ORDER BY ac.created_at ASC`,
    [connId]
  );
  if (!res.length) return [];
  const cols = res[0].columns;
  return res[0].values.map(row => {
    const obj = {}; cols.forEach((c, i) => { obj[c] = row[i]; });
    return {
      agentId: obj.agent_id,
      ownerId: obj.owner_id,
      ownerUsername: obj.username || null,
      ownerEmail: obj.email || null,
      assignedAt: obj.created_at,
    };
  });
}

// ─── Ownership middleware ───────────────────────────────────────────────────

function getConnectionOwner(connId) {
  const db = _db();
  if (!db) return null;
  const res = db.exec('SELECT created_by FROM connections WHERE id = ?', [connId]);
  if (!res.length || !res[0].values.length) return null;
  return res[0].values[0][0];
}

function userOwnsConnection(req, connId) {
  if (!req?.user) return false;
  if (req.user.role === 'admin' || req.user.role === 'agent') return true;
  const owner = getConnectionOwner(connId);
  return owner != null && owner === req.user.userId;
}

function requireConnectionOwnership(req, res, next) {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: 'connection id missing' });
  if (!userOwnsConnection(req, id)) {
    return res.status(403).json({ error: 'You do not have permission to modify this connection' });
  }
  next();
}

module.exports = {
  normalizeConnection,
  getAllConnections,
  getConnection,
  getConnectionRaw,
  getEnabledConnectionsRaw,
  createConnection,
  updateConnection,
  deleteConnection,
  getAgentConnectionIds,
  getConnectionAgentIds,
  setAgentConnections,
  getAgentConnectionsRaw,
  getAllAgentConnectionAssignments,
  getConnectionOwner,
  userOwnsConnection,
  requireConnectionOwnership,
  // Sharing (org-wide boolean)
  setConnectionShared,
  userCanUseConnection,
  userIdCanUseConnection,
  getConnectionUsage,
};
