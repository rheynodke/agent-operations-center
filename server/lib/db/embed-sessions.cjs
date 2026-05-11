// server/lib/db/embed-sessions.cjs
'use strict';

const crypto = require('crypto');
const { getDb, persist } = require('./_handle.cjs');

function _now() { return Date.now(); }
function _uuid() { return crypto.randomUUID(); }

function _parseRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    embedId: row.embed_id,
    visitorUuid: row.visitor_uuid,
    visitorMeta: JSON.parse(row.visitor_meta || '{}'),
    gatewaySessionKey: row.gateway_session_key,
    trafficType: row.traffic_type,
    origin: row.origin,
    startedAt: row.started_at,
    lastActiveAt: row.last_active_at,
    clearedAt: row.cleared_at,
    messageCount: row.message_count,
    tokenTotal: row.token_total,
  };
}

function _findActiveSession(embedId, visitorUuid) {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM embed_sessions
    WHERE embed_id = ? AND visitor_uuid = ? AND cleared_at IS NULL
    LIMIT 1
  `);
  stmt.bind([embedId, visitorUuid]);
  const row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return _parseRow(row);
}

function createOrResumeSession({ embedId, visitorUuid, visitorMeta, gatewaySessionKey, trafficType, origin }) {
  const existing = _findActiveSession(embedId, visitorUuid);
  if (existing) return existing;

  const db = getDb();
  const id = _uuid();
  const now = _now();
  const stmt = db.prepare(`
    INSERT INTO embed_sessions (
      id, embed_id, visitor_uuid, visitor_meta, gateway_session_key,
      traffic_type, origin, started_at, last_active_at, cleared_at,
      message_count, token_total
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, 0)
  `);
  stmt.run([
    id, embedId, visitorUuid, JSON.stringify(visitorMeta || {}),
    gatewaySessionKey, trafficType, origin, now, now,
  ]);
  stmt.free();
  persist();
  return getSessionById(id);
}

function getSessionById(id) {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM embed_sessions WHERE id = ?');
  stmt.bind([id]);
  const row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return _parseRow(row);
}

function clearSession(id) {
  const db = getDb();
  const stmt = db.prepare('UPDATE embed_sessions SET cleared_at = ? WHERE id = ?');
  stmt.run([_now(), id]);
  stmt.free();
  persist();
}

function bumpSessionActivity(id, { messageDelta = 0, tokenDelta = 0 } = {}) {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE embed_sessions
    SET last_active_at = ?,
        message_count = message_count + ?,
        token_total = token_total + ?
    WHERE id = ?
  `);
  stmt.run([_now(), messageDelta, tokenDelta, id]);
  stmt.free();
  persist();
}

function getEmbedSessionMessages(sessionId, { limit = 20, cursor = null } = {}) {
  // History is sourced from gateway transcript JSONL files (existing AOC pattern).
  // This accessor returns an empty array in Phase 1 — visitor sees fresh start on reload.
  // Phase 2 wires real transcript fetch by mapping gateway_session_key -> JSONL file
  // -> structured ChatMessageGroup[] (parser already exists in src/stores/useChatStore.ts
  // as gatewayMessagesToGroups; needs server-side equivalent + JSONL streamer).
  return [];
}

module.exports = {
  createOrResumeSession,
  getSessionById,
  clearSession,
  bumpSessionActivity,
  getEmbedSessionMessages,
};
