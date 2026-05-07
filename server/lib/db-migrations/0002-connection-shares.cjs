'use strict';

/**
 * Migration 0002 — connection sharing.
 *
 * Adds a `connection_shares` table so connection owners can grant **use-only**
 * access to other users without exposing credentials or letting them
 * edit/delete the row.
 *
 * Access semantics enforced in code (db/connections.cjs):
 *   - owner OR admin OR row in connection_shares → can USE (assign + dispatch)
 *   - only owner + admin → can edit / delete / test / reauth / view shares
 *   - kredensial mentah tidak pernah keluar — tetap server-only
 *
 * Also backfills `connections.created_by`: legacy rows pre-Sprint-2 had no
 * owner column, and any row still NULL after the column was added is
 * effectively admin-managed (admin was the only user pre-multi-tenant).
 * Default the lowest-id admin (typically uid=1) as the owner so the new
 * scoping rules don't suddenly hide them from admin's "owner=me" view.
 */
module.exports = {
  id: '0002-connection-shares',
  description: 'Create connection_shares table + backfill legacy owner=admin',
  up(db) {
    db.run(`
      CREATE TABLE IF NOT EXISTS connection_shares (
        connection_id TEXT NOT NULL,
        user_id       INTEGER NOT NULL,
        created_by    INTEGER,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (connection_id, user_id)
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_connection_shares_user ON connection_shares(user_id)');

    // Backfill: any connection with NULL created_by → assign to first admin.
    let adminId = null;
    try {
      const res = db.exec("SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1");
      if (res.length && res[0].values.length) adminId = res[0].values[0][0];
    } catch (_) { /* users table absent in fresh tests — skip */ }

    if (adminId != null) {
      db.run('UPDATE connections SET created_by = ? WHERE created_by IS NULL', [adminId]);
    }
  },
};
