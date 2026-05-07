'use strict';

/**
 * Mission rooms (incl. HQ + project rooms) + messages + room↔session tracking.
 *
 * Membership model: every room must include the requesting user's master agent
 * (Sprint 2 multi-tenant fix). `normalizeMissionMembers(ids, masterAgentId)`
 * dedupes + prepends master. When called from `normalizeMissionRoom` on read,
 * we look up the owner's master via `agent-profiles.cjs::getUserMasterAgentId`
 * so we don't accidentally leak admin's `'main'` into another user's room.
 *
 * Visibility model:
 *   - global non-HQ: only own (createdBy === uid) for non-admin
 *   - HQ rooms: handled in route layer (per-tenant scoping)
 *   - project rooms: visible to project owners + room members (non-master only)
 */

const crypto = require('node:crypto');
const handle = require('./_handle.cjs');
function _db() { return handle.getDb(); }

// Lazy resolvers — projects.cjs and agent-profiles.cjs may load after this
// file via the barrel; require inside fns to dodge circular init.
function _getUserMasterAgentId(uid) {
  return require('./agent-profiles.cjs').getUserMasterAgentId(uid);
}
function _userOwnsAgent(req, agentId) {
  return require('./agent-profiles.cjs').userOwnsAgent(req, agentId);
}
function _userOwnsProject(req, projectId) {
  // projects.cjs not yet extracted — keep going through the barrel.
  return require('../db.cjs').userOwnsProject(req, projectId);
}
function _getProject(id) {
  return require('../db.cjs').getProject(id);
}
function _getAllProjects() {
  return require('../db.cjs').getAllProjects();
}
function _getOwnedAgentIds(userId) {
  const db = _db();
  if (!db || userId == null) return [];
  const res = db.exec('SELECT agent_id FROM agent_profiles WHERE provisioned_by = ?', [Number(userId)]);
  if (!res.length) return [];
  return res[0].values.map(r => r[0]).filter(Boolean);
}

function _parseJsonArray(v) {
  if (!v) return [];
  try { const x = JSON.parse(v); return Array.isArray(x) ? x : []; } catch { return []; }
}
function _parseJsonObject(v) {
  if (!v) return {};
  try { const x = JSON.parse(v); return (x && typeof x === 'object' && !Array.isArray(x)) ? x : {}; } catch { return {}; }
}

// ─── Normalization ──────────────────────────────────────────────────────────

function normalizeMissionMembers(memberAgentIds, masterAgentId = null) {
  const ids = Array.isArray(memberAgentIds) ? memberAgentIds : [];
  const master = masterAgentId && String(masterAgentId).trim() ? String(masterAgentId).trim() : 'main';
  const out = [];
  for (const raw of [master, ...ids]) {
    const id = String(raw || '').trim();
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

function normalizeMissionRoom(row) {
  if (!row || !row.id) return null;
  const ownerId = row.created_by != null ? Number(row.created_by) : null;
  const ownerMaster = ownerId != null ? _getUserMasterAgentId(ownerId) : null;
  return {
    id: row.id,
    kind: row.kind || 'global',
    projectId: row.project_id || null,
    name: row.name,
    description: row.description || null,
    memberAgentIds: normalizeMissionMembers(_parseJsonArray(row.member_agent_ids), ownerMaster),
    createdBy: ownerId,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isHq: row.is_hq === 1,
    isSystem: row.is_system === 1,
    ownerUserId: row.owner_user_id != null ? Number(row.owner_user_id) : null,
  };
}

function normalizeMissionMessage(row) {
  if (!row || !row.id) return null;
  return {
    id: row.id,
    roomId: row.room_id,
    authorType: row.author_type || 'user',
    authorId: row.author_id || null,
    authorName: row.author_name || null,
    body: row.body || '',
    mentions: _parseJsonArray(row.mentions_json),
    relatedTaskId: row.related_task_id || null,
    meta: _parseJsonObject(row.meta_json),
    createdAt: row.created_at,
  };
}

// ─── Room CRUD ──────────────────────────────────────────────────────────────

function getMissionRoom(id) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  const stmt = db.prepare('SELECT * FROM mission_rooms WHERE id = :id');
  const row = stmt.getAsObject({ ':id': id });
  stmt.free();
  return row.id ? normalizeMissionRoom(row) : null;
}

function getHqRoomForUser(userId) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  if (userId == null) return null;
  const stmt = db.prepare('SELECT * FROM mission_rooms WHERE is_hq = 1 AND owner_user_id = ?');
  const row = stmt.getAsObject([Number(userId)]);
  stmt.free();
  if (!row.id) return null;
  return normalizeMissionRoom(row);
}

function getProjectDefaultRoom(projectId) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  const stmt = db.prepare("SELECT * FROM mission_rooms WHERE kind = 'project' AND project_id = :pid ORDER BY created_at ASC LIMIT 1");
  const row = stmt.getAsObject({ ':pid': projectId });
  stmt.free();
  return row.id ? normalizeMissionRoom(row) : null;
}

function ensureProjectDefaultRoom(projectId, createdBy = null, memberAgentIds = null) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  if (!projectId) throw new Error('ensureProjectDefaultRoom: projectId is required');
  if (projectId === 'general') return null;
  const existing = getProjectDefaultRoom(projectId);
  if (existing) return existing;
  const project = _getProject(projectId);
  if (!project) return null;
  const masterAgentId = createdBy != null ? _getUserMasterAgentId(createdBy) : null;
  const ids = normalizeMissionMembers(memberAgentIds || _getOwnedAgentIds(createdBy), masterAgentId);
  const id = `room-project-${projectId}`;
  const now = new Date().toISOString();
  db.run(
    'INSERT OR IGNORE INTO mission_rooms (id, kind, project_id, name, description, member_agent_ids, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, 'project', projectId, `${project.name} Room`, `Default mission room for ${project.name}.`, JSON.stringify(ids), createdBy != null ? Number(createdBy) : null, now, now]
  );
  handle.persist();
  return getProjectDefaultRoom(projectId);
}

function backfillProjectDefaultRooms() {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  const projects = _getAllProjects();
  let created = 0;
  for (const project of projects) {
    if (project.id === 'general') continue;
    if (!getProjectDefaultRoom(project.id)) {
      ensureProjectDefaultRoom(project.id, project.createdBy ?? null);
      created++;
    }
  }
  return { created };
}

function listMissionRooms() {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  const stmt = db.prepare('SELECT * FROM mission_rooms ORDER BY kind ASC, created_at ASC');
  const rows = [];
  while (stmt.step()) rows.push(normalizeMissionRoom(stmt.getAsObject()));
  stmt.free();
  return rows.filter(Boolean);
}

function listMissionRoomsForUser(req) {
  const rooms = listMissionRooms();
  if (!req?.user) return [];
  if (req.user.role === 'admin' || req.user.role === 'agent') return rooms;
  const uid = req.user.userId;
  const userMasterId = _getUserMasterAgentId(uid) || 'main';
  return rooms.filter((room) => {
    if (room.kind === 'global') {
      return room.createdBy != null ? room.createdBy === uid : false;
    }
    if (room.projectId && _userOwnsProject(req, room.projectId)) return true;
    return room.memberAgentIds.some((id) => id !== userMasterId && _userOwnsAgent(req, id));
  });
}

function createMissionRoom({ kind = 'global', projectId = null, name, description = null, memberAgentIds = [], createdBy = null, masterAgentId = null } = {}) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  if (!name?.trim()) throw new Error('createMissionRoom: name is required');
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const master = masterAgentId || (createdBy != null ? _getUserMasterAgentId(createdBy) : null);
  db.run(
    'INSERT INTO mission_rooms (id, kind, project_id, name, description, member_agent_ids, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, kind, projectId || null, name.trim(), description || null, JSON.stringify(normalizeMissionMembers(memberAgentIds, master)), createdBy != null ? Number(createdBy) : null, now, now]
  );
  handle.persist();
  return getMissionRoom(id);
}

function updateMissionRoomMembers(id, memberAgentIds = [], masterAgentId = null) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  const now = new Date().toISOString();
  let master = masterAgentId;
  if (!master) {
    const room = getMissionRoom(id);
    if (room?.createdBy != null) master = _getUserMasterAgentId(room.createdBy);
  }
  db.run('UPDATE mission_rooms SET member_agent_ids = ?, updated_at = ? WHERE id = ?', [JSON.stringify(normalizeMissionMembers(memberAgentIds, master)), now, id]);
  handle.persist();
  return getMissionRoom(id);
}

function deleteMissionRoom(id) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  db.run('DELETE FROM mission_messages WHERE room_id = ?', [id]);
  db.run('DELETE FROM mission_rooms WHERE id = ?', [id]);
  handle.persist();
}

// ─── Messages ───────────────────────────────────────────────────────────────

function listMissionMessages(roomId, { before, limit = 50 } = {}) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
  const rows = [];
  const sql = before
    ? 'SELECT * FROM mission_messages WHERE room_id = :rid AND created_at < :before ORDER BY created_at DESC LIMIT :limit'
    : 'SELECT * FROM mission_messages WHERE room_id = :rid ORDER BY created_at DESC LIMIT :limit';
  const stmt = db.prepare(sql);
  stmt.bind(before ? { ':rid': roomId, ':before': before, ':limit': safeLimit } : { ':rid': roomId, ':limit': safeLimit });
  while (stmt.step()) rows.push(normalizeMissionMessage(stmt.getAsObject()));
  stmt.free();
  return rows.filter(Boolean);
}

function createMissionMessage({ roomId, authorType, authorId, authorName, body, mentions = [], relatedTaskId = null, meta = {} } = {}) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  if (!roomId) throw new Error('createMissionMessage: roomId is required');
  if (!body?.trim()) throw new Error('createMissionMessage: body is required');
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.run(
    'INSERT INTO mission_messages (id, room_id, author_type, author_id, author_name, body, mentions_json, related_task_id, meta_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, roomId, authorType || 'user', authorId || null, authorName || null, body.trim(), JSON.stringify(mentions || []), relatedTaskId || null, JSON.stringify(meta || {}), now]
  );
  handle.persist();
  return normalizeMissionMessage({ id, room_id: roomId, author_type: authorType || 'user', author_id: authorId || null, author_name: authorName || null, body: body.trim(), mentions_json: JSON.stringify(mentions || []), related_task_id: relatedTaskId || null, meta_json: JSON.stringify(meta || {}), created_at: now });
}

// ─── Room ↔ gateway session tracking ────────────────────────────────────────

function markSessionAsRoomTriggered(sessionKey, roomId, agentId) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  db.run(
    `INSERT OR REPLACE INTO room_sessions (session_key, room_id, agent_id, created_at) VALUES (?, ?, ?, datetime('now'))`,
    [sessionKey, roomId, agentId]
  );
  handle.persist();
}

function getRoomSessionKeys() {
  const db = _db();
  if (!db) return [];
  const res = db.exec('SELECT session_key FROM room_sessions');
  if (!res.length) return [];
  return res[0].values.map(r => r[0]).filter(Boolean);
}

function getRoomAgentSession(roomId, agentId) {
  const db = _db();
  if (!db) return null;
  const stmt = db.prepare(
    'SELECT session_key FROM room_sessions WHERE room_id = :rid AND agent_id = :aid ORDER BY created_at DESC LIMIT 1'
  );
  const row = stmt.getAsObject({ ':rid': roomId, ':aid': agentId });
  stmt.free();
  return row.session_key || null;
}

function getRoomForSession(sessionKey) {
  const db = _db();
  if (!db) return null;
  const stmt = db.prepare(
    'SELECT room_id, agent_id FROM room_sessions WHERE session_key = :key'
  );
  const row = stmt.getAsObject({ ':key': sessionKey });
  stmt.free();
  return (row.room_id && row.agent_id) ? { roomId: row.room_id, agentId: row.agent_id } : null;
}

module.exports = {
  normalizeMissionMembers,
  normalizeMissionRoom,
  normalizeMissionMessage,
  getMissionRoom,
  getMissionRoomById: getMissionRoom,
  getHqRoomForUser,
  getProjectDefaultRoom,
  ensureProjectDefaultRoom,
  backfillProjectDefaultRooms,
  listMissionRooms,
  listMissionRoomsForUser,
  createMissionRoom,
  updateMissionRoomMembers,
  deleteMissionRoom,
  listMissionMessages,
  createMissionMessage,
  markSessionAsRoomTriggered,
  getRoomSessionKeys,
  getRoomAgentSession,
  getRoomForSession,
};
