'use strict';

/**
 * Agent profiles — composite-PK table `agent_profiles(agent_id, provisioned_by)`.
 *
 * The composite key (Sprint 2 multi-tenant fix) lets two users own agents
 * with the same slug; every accessor here takes an `ownerId` to disambiguate.
 *
 * Ownership middleware (`userOwnsAgent` / `requireAgentOwnership`) lives here
 * because it's the same data layer. The middleware also wraps next() in
 * `withOwnerContext` so per-tenant filesystem resolvers in `lib/agents/*`
 * pick the right home.
 */

const handle = require('./_handle.cjs');
function _db() { return handle.getDb(); }

// ─── Ownership lookups ──────────────────────────────────────────────────────

/**
 * Composite-PK aware. Pass `ownerHint` (typically req.user.userId) to
 * disambiguate when the slug exists under multiple users. Without a hint,
 * returns the single owner if only one exists, otherwise null (caller must
 * specify whose agent).
 */
function getAgentOwner(agentId, ownerHint) {
  const db = _db();
  if (!db) return null;
  if (ownerHint != null) {
    const r = db.exec('SELECT provisioned_by FROM agent_profiles WHERE agent_id = ? AND provisioned_by = ?', [agentId, Number(ownerHint)]);
    if (r.length && r[0].values.length) return r[0].values[0][0];
    return null;
  }
  const res = db.exec('SELECT provisioned_by FROM agent_profiles WHERE agent_id = ?', [agentId]);
  if (!res.length || !res[0].values.length) return null;
  if (res[0].values.length > 1) return null; // ambiguous — caller must scope
  return res[0].values[0][0];
}

/**
 * True if `req.user` owns a profile row for this agent_id.
 *
 * Under composite-PK multi-tenancy: admin no longer auto-bypasses for ALL
 * agents — admin can only act on agents where provisioned_by = admin's userId.
 * Service tokens (role=agent) keep the bypass since they run inside a user
 * gateway and operate on behalf of agents in that scope.
 *
 * Admin impersonation: when an admin request carries `?owner=<N>` (the same
 * query param the frontend's `withScope` helper appends during View-As-User),
 * we grant access if user N owns the agent. This is the dashboard's only
 * cross-tenant access path — admin must explicitly opt in via the query
 * param; default un-scoped admin requests still see only their own agents.
 */
function _adminImpersonationOwnerId(req) {
  if (req?.user?.role !== 'admin') return null;
  const raw = req?.query?.owner;
  if (raw == null || raw === '' || raw === 'me' || raw === 'all') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function userOwnsAgent(req, agentId) {
  if (!req?.user) return false;
  if (req.user.role === 'agent') {
    if (req.user.agentId) return req.user.agentId === agentId;
    return true; // legacy DASHBOARD_TOKEN bypass
  }
  const impersonateId = _adminImpersonationOwnerId(req);
  if (impersonateId != null) {
    return getAgentProfile(agentId, impersonateId) != null;
  }
  return getAgentProfile(agentId, req.user.userId) != null;
}

/** Express middleware: require that req.user owns the agent named by :id (or :agentId) */
function requireAgentOwnership(req, res, next) {
  const agentId = req.params.id || req.params.agentId;
  if (!agentId) return res.status(400).json({ error: 'agentId missing from route' });
  if (!userOwnsAgent(req, agentId)) {
    return res.status(403).json({ error: 'You do not have permission to modify this agent' });
  }
  // Establish owner context so downstream parsers (which resolve filesystem
  // paths via getAgentOwner) pick the EFFECTIVE owner's home — the impersonated
  // user when admin sends ?owner=<N>, else the requester's own userId. Service
  // tokens skip this — they don't carry a userId and parsers rely on
  // header/query agentId routing.
  if (req.user.role !== 'agent' && req.user.userId) {
    const effectiveOwner = _adminImpersonationOwnerId(req) ?? req.user.userId;
    const { withOwnerContext } = require('../agents/detail.cjs');
    return withOwnerContext(effectiveOwner, () => next());
  }
  next();
}

// ─── Profile CRUD ───────────────────────────────────────────────────────────

function getAgentProfile(agentId, ownerId) {
  const db = _db();
  if (!db) return null;
  const result = ownerId != null
    ? db.exec('SELECT * FROM agent_profiles WHERE agent_id = ? AND provisioned_by = ?', [agentId, Number(ownerId)])
    : db.exec(
        `SELECT * FROM agent_profiles WHERE agent_id = ?
         ORDER BY (provisioned_by = 1) DESC, provisioned_by ASC LIMIT 1`,
        [agentId]
      );
  if (!result.length || !result[0].values.length) return null;
  const row = result[0].values[0];
  const cols = result[0].columns;
  const obj = Object.fromEntries(cols.map((c, i) => [c, row[i]]));
  try { obj.tags = obj.tags ? JSON.parse(obj.tags) : []; } catch { obj.tags = []; }
  obj.avatarPresetId = obj.avatar_preset_id ?? null;
  obj.role = obj.role ?? null;
  obj.isMaster = obj.is_master === 1 || obj.is_master === true;
  return obj;
}

function getAgentProfilesByAgentId(agentId) {
  const db = _db();
  if (!db) return [];
  const result = db.exec('SELECT * FROM agent_profiles WHERE agent_id = ? ORDER BY provisioned_by ASC', [agentId]);
  if (!result.length) return [];
  return result[0].values.map(row => {
    const obj = Object.fromEntries(result[0].columns.map((c, i) => [c, row[i]]));
    try { obj.tags = obj.tags ? JSON.parse(obj.tags) : []; } catch { obj.tags = []; }
    obj.avatarPresetId = obj.avatar_preset_id ?? null;
    obj.isMaster = obj.is_master === 1 || obj.is_master === true;
    return obj;
  });
}

function upsertAgentProfile({ agentId, displayName, emoji, avatarData, avatarMime, avatarPresetId, color, description, tags, notes, provisionedBy, role }) {
  const db = _db();
  if (!db) throw new Error('Database not initialized');
  const owner = provisionedBy != null ? Number(provisionedBy) : 1;
  const existing = getAgentProfile(agentId, owner);
  const tagsJson = Array.isArray(tags) ? JSON.stringify(tags) : (tags || '[]');
  if (existing) {
    db.run(
      `UPDATE agent_profiles SET
        display_name = COALESCE(?, display_name),
        emoji = COALESCE(?, emoji),
        avatar_data = COALESCE(?, avatar_data),
        avatar_mime = COALESCE(?, avatar_mime),
        avatar_preset_id = ?,
        color = ?,
        description = COALESCE(?, description),
        tags = ?,
        notes = COALESCE(?, notes),
        role = COALESCE(?, role),
        updated_at = datetime('now')
      WHERE agent_id = ? AND provisioned_by = ?`,
      [displayName ?? null, emoji ?? null, avatarData ?? null, avatarMime ?? null,
       avatarPresetId ?? existing.avatar_preset_id ?? null,
       color ?? existing.color ?? null,
       description ?? null, tagsJson, notes ?? null,
       role ?? null, agentId, owner]
    );
  } else {
    db.run(
      `INSERT INTO agent_profiles
        (agent_id, display_name, emoji, avatar_data, avatar_mime, avatar_preset_id, color, description, tags, notes, provisioned_by, role)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [agentId, displayName ?? null, emoji ?? null, avatarData ?? null, avatarMime ?? null,
       avatarPresetId ?? null, color ?? null, description ?? null, tagsJson, notes ?? null,
       owner, role ?? null]
    );
  }
  handle.persist();
  return getAgentProfile(agentId, owner);
}

function renameAgentProfile(oldAgentId, newAgentId, ownerId) {
  const db = _db();
  if (!db) return;
  if (ownerId == null) throw new Error('renameAgentProfile: ownerId is required');
  const owner = Number(ownerId);
  const existing = getAgentProfile(oldAgentId, owner);
  if (!existing) return;
  const conflict = getAgentProfile(newAgentId, owner);
  if (conflict) {
    db.run('DELETE FROM agent_profiles WHERE agent_id = ? AND provisioned_by = ?', [oldAgentId, owner]);
  } else {
    db.run('UPDATE agent_profiles SET agent_id = ? WHERE agent_id = ? AND provisioned_by = ?', [newAgentId, oldAgentId, owner]);
  }
  db.run('UPDATE agent_connections SET agent_id = ? WHERE agent_id = ? AND owner_id = ?', [newAgentId, oldAgentId, owner]);
  handle.persist();
}

function getAllAgentProfiles(opts = {}) {
  const db = _db();
  if (!db) return [];
  const { ownerId } = opts || {};
  const result = ownerId != null
    ? db.exec('SELECT * FROM agent_profiles WHERE provisioned_by = ? ORDER BY provisioned_at DESC', [Number(ownerId)])
    : db.exec('SELECT * FROM agent_profiles ORDER BY provisioned_at DESC');
  if (!result.length) return [];
  return result[0].values.map(row => {
    const obj = Object.fromEntries(result[0].columns.map((c, i) => [c, row[i]]));
    try { obj.tags = obj.tags ? JSON.parse(obj.tags) : []; } catch { obj.tags = []; }
    obj.avatarPresetId = obj.avatar_preset_id ?? null;
    obj.isMaster = obj.is_master === 1 || obj.is_master === true;
    return obj;
  });
}

function deleteAgentProfile(agentId, ownerId) {
  const db = _db();
  if (!db) return;
  if (ownerId == null) {
    throw new Error('deleteAgentProfile: ownerId is required to avoid cross-tenant deletion');
  }
  db.run('DELETE FROM agent_profiles WHERE agent_id = ? AND provisioned_by = ?', [agentId, Number(ownerId)]);
  db.run('DELETE FROM agent_connections WHERE agent_id = ? AND owner_id = ?', [agentId, Number(ownerId)]);
  handle.persist();
}

// ─── Master agent linking (lives on `users.master_agent_id`) ────────────────

function setUserMasterAgent(userId, agentId) {
  const db = _db();
  if (!db) return;
  db.run('UPDATE users SET master_agent_id = ? WHERE id = ?', [agentId, Number(userId)]);
  handle.persist();
}

function getUserMasterAgentId(userId) {
  const db = _db();
  if (!db) return null;
  const result = db.exec('SELECT master_agent_id FROM users WHERE id = ?', [Number(userId)]);
  if (result.length === 0 || result[0].values.length === 0) return null;
  return result[0].values[0][0] || null;
}

function markAgentProfileMaster(agentId, ownerId) {
  const db = _db();
  if (!db) return;
  if (ownerId == null) throw new Error('markAgentProfileMaster: ownerId is required');
  db.run('UPDATE agent_profiles SET is_master = 1 WHERE agent_id = ? AND provisioned_by = ?', [agentId, Number(ownerId)]);
  handle.persist();
}

module.exports = {
  getAgentOwner,
  userOwnsAgent,
  requireAgentOwnership,
  getAgentProfile,
  getAgentProfilesByAgentId,
  upsertAgentProfile,
  renameAgentProfile,
  getAllAgentProfiles,
  deleteAgentProfile,
  setUserMasterAgent,
  getUserMasterAgentId,
  markAgentProfileMaster,
};
