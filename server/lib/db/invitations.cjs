'use strict';

/**
 * Invitations — admin-issued one-time tokens that gate self-serve registration.
 *
 * Schema lives in `invitations` table (see initDatabase). Token is a 48-char
 * hex random; `revoked_at` and `expires_at` together drive `active`/`expired`
 * derivation in normalizeInvitation.
 */

const crypto = require('node:crypto');
const handle = require('./_handle.cjs');

function _db() { return handle.getDb(); }

function normalizeInvitation(row) {
  if (!row || !row.id) return null;
  const now = new Date();
  const expiresAt = row.expires_at ? new Date(row.expires_at) : null;
  const expired = expiresAt ? expiresAt.getTime() < now.getTime() : false;
  return {
    id: row.id,
    token: row.token,
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at || null,
    defaultRole: row.default_role || 'user',
    note: row.note || null,
    useCount: row.use_count || 0,
    expired,
    active: !row.revoked_at && !expired,
  };
}

function createInvitation({ createdBy, expiresAt, defaultRole = 'user', note }) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  if (!createdBy) throw new Error('createInvitation: createdBy required');
  if (!expiresAt) throw new Error('createInvitation: expiresAt required');
  const token = crypto.randomBytes(24).toString('hex');
  db.run(
    'INSERT INTO invitations (token, created_by, expires_at, default_role, note) VALUES (?, ?, ?, ?, ?)',
    [token, createdBy, expiresAt, defaultRole, note || null]
  );
  handle.persist();
  return getInvitationByToken(token);
}

function getAllInvitations() {
  const db = _db();
  if (!db) return [];
  const res = db.exec('SELECT * FROM invitations ORDER BY created_at DESC');
  if (!res.length) return [];
  const cols = res[0].columns;
  return res[0].values.map(row => {
    const obj = {}; cols.forEach((c, i) => { obj[c] = row[i]; });
    return normalizeInvitation(obj);
  });
}

function getInvitationByToken(token) {
  const db = _db();
  if (!db) return null;
  const res = db.exec('SELECT * FROM invitations WHERE token = ?', [token]);
  if (!res.length || !res[0].values.length) return null;
  const cols = res[0].columns;
  const obj = {}; cols.forEach((c, i) => { obj[c] = res[0].values[0][i]; });
  return normalizeInvitation(obj);
}

function getInvitationById(id) {
  const db = _db();
  if (!db) return null;
  const res = db.exec('SELECT * FROM invitations WHERE id = ?', [id]);
  if (!res.length || !res[0].values.length) return null;
  const cols = res[0].columns;
  const obj = {}; cols.forEach((c, i) => { obj[c] = res[0].values[0][i]; });
  return normalizeInvitation(obj);
}

function revokeInvitation(id) {
  const db = _db();
  if (!db) return;
  db.run("UPDATE invitations SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL", [id]);
  handle.persist();
}

function deleteInvitation(id) {
  const db = _db();
  if (!db) return;
  db.run('DELETE FROM invitations WHERE id = ?', [id]);
  handle.persist();
}

function incrementInvitationUse(id) {
  const db = _db();
  if (!db) return;
  db.run('UPDATE invitations SET use_count = use_count + 1 WHERE id = ?', [id]);
  handle.persist();
}

module.exports = {
  normalizeInvitation,
  createInvitation,
  getAllInvitations,
  getInvitationByToken,
  getInvitationById,
  revokeInvitation,
  deleteInvitation,
  incrementInvitationUse,
};
