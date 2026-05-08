'use strict';

/**
 * Announcement DB helpers — admin-authored broadcast messages with per-user
 * read receipts. See migration 0004 for schema rationale.
 *
 * Public API (mounted onto db.cjs root via spread):
 *   - listActiveForUser(userId)       — undismissed, unexpired, active=1
 *   - listAll()                       — admin view: every row, newest first
 *   - getAnnouncement(id)             — single row + read count
 *   - createAnnouncement(...)         — admin create
 *   - deactivateAnnouncement(id)      — soft-delete (active=0)
 *   - markAnnouncementRead(id, uid)   — current user dismisses for themselves
 *   - getReadCount(id)                — count distinct readers
 */

const handle = require('./_handle.cjs');

function _db() { return handle.getDb(); }

function _row(cols, values) {
  const obj = {};
  cols.forEach((c, i) => { obj[c] = values[i]; });
  return obj;
}

function _normalize(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    body: row.body || '',
    severity: row.severity || 'info',
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at || null,
    active: !!row.active,
  };
}

function listActiveForUser(userId) {
  const db = _db();
  if (!db) return [];
  const uid = Number(userId);
  // Unread + active + (no expiry OR expiry in the future).
  // sql.js doesn't carry a clock-aware NOW() across drivers reliably, but
  // datetime('now') matches what the server inserts for created_at, so the
  // comparison works as long as both sides use UTC-naive ISO strings.
  const sql = `
    SELECT a.* FROM announcements a
    WHERE a.active = 1
      AND (a.expires_at IS NULL OR a.expires_at > datetime('now'))
      AND NOT EXISTS (
        SELECT 1 FROM announcement_reads r
        WHERE r.announcement_id = a.id AND r.user_id = ?
      )
    ORDER BY a.created_at DESC
  `;
  const res = db.exec(sql, [uid]);
  if (!res.length) return [];
  return res[0].values.map(v => _normalize(_row(res[0].columns, v)));
}

function listAll() {
  const db = _db();
  if (!db) return [];
  const res = db.exec('SELECT * FROM announcements ORDER BY created_at DESC');
  if (!res.length) return [];
  return res[0].values.map(v => _normalize(_row(res[0].columns, v)));
}

function getAnnouncement(id) {
  const db = _db();
  if (!db) return null;
  const res = db.exec('SELECT * FROM announcements WHERE id = ?', [Number(id)]);
  if (!res.length || !res[0].values.length) return null;
  return _normalize(_row(res[0].columns, res[0].values[0]));
}

function createAnnouncement({ title, body, severity, createdBy, expiresAt }) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  if (!title || typeof title !== 'string') throw new Error('title required');
  const sev = ['info', 'warn', 'error'].includes(severity) ? severity : 'info';
  db.run(
    `INSERT INTO announcements (title, body, severity, created_by, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [title.trim().slice(0, 200), String(body || '').slice(0, 5000), sev, Number(createdBy), expiresAt || null]
  );
  // sql.js exposes last_insert_rowid via a SELECT — better-sqlite3 has lastInsertRowid.
  const res = db.exec('SELECT last_insert_rowid() AS id');
  const newId = res?.[0]?.values?.[0]?.[0];
  handle.persist();
  return getAnnouncement(newId);
}

function deactivateAnnouncement(id) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  db.run('UPDATE announcements SET active = 0 WHERE id = ?', [Number(id)]);
  handle.persist();
  return getAnnouncement(id);
}

function markAnnouncementRead(announcementId, userId) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  // INSERT OR IGNORE so a double-click from the user is a no-op.
  db.run(
    `INSERT OR IGNORE INTO announcement_reads (announcement_id, user_id) VALUES (?, ?)`,
    [Number(announcementId), Number(userId)]
  );
  handle.persist();
}

function getReadCount(announcementId) {
  const db = _db();
  if (!db) return 0;
  const res = db.exec(
    'SELECT COUNT(*) FROM announcement_reads WHERE announcement_id = ?',
    [Number(announcementId)]
  );
  return res?.[0]?.values?.[0]?.[0] || 0;
}

module.exports = {
  listActiveForUser,
  listAll,
  getAnnouncement,
  createAnnouncement,
  deactivateAnnouncement,
  markAnnouncementRead,
  getReadCount,
};
