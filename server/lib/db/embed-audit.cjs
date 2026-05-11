'use strict';

const { getDb, persist } = require('./_handle.cjs');

function _now() { return Date.now(); }

function _parseRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    embedId: row.embed_id,
    sessionId: row.session_id,
    ownerId: row.owner_id,
    eventType: row.event_type,
    severity: row.severity,
    origin: row.origin,
    visitorUuid: row.visitor_uuid,
    ipHash: row.ip_hash,
    contextData: row.context_data, // raw JSON string; encryption layer handled in audit-log.cjs writer
    createdAt: row.created_at,
  };
}

function writeAuditEvent({
  embedId, sessionId = null, ownerId, eventType, severity = 'info',
  origin = null, visitorUuid = null, ipHash = null, contextData = {},
}) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO embed_audit_log (
      embed_id, session_id, owner_id, event_type, severity,
      origin, visitor_uuid, ip_hash, context_data, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run([
    embedId, sessionId, ownerId, eventType, severity,
    origin, visitorUuid, ipHash,
    typeof contextData === 'string' ? contextData : JSON.stringify(contextData),
    _now(),
  ]);
  stmt.free();
  persist();
  // Get last insert id
  const r = db.exec('SELECT last_insert_rowid() AS id');
  return r[0].values[0][0];
}

function listAuditEvents({ embedId, eventType = null, severity = null, cursor = null, limit = 50, ownerId = null }) {
  const db = getDb();
  const where = [];
  const vals = [];
  if (embedId) { where.push('embed_id = ?'); vals.push(embedId); }
  if (ownerId) { where.push('owner_id = ?'); vals.push(ownerId); }
  if (eventType) { where.push('event_type = ?'); vals.push(eventType); }
  if (severity) { where.push('severity = ?'); vals.push(severity); }
  if (cursor) { where.push('id < ?'); vals.push(cursor); }
  const sql = `
    SELECT * FROM embed_audit_log
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `;
  vals.push(limit);
  const stmt = db.prepare(sql);
  stmt.bind(vals);
  const out = [];
  while (stmt.step()) out.push(_parseRow(stmt.getAsObject()));
  stmt.free();
  return out;
}

module.exports = { writeAuditEvent, listAuditEvents };
