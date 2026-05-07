'use strict';

/**
 * Migration 0003 — replace per-user `connection_shares` ACL with a single
 * `connections.shared` boolean.
 *
 * Decision: per-user ACL was overengineered for the actual use case (an
 * org-wide pool of credentials curated by admin/owner). Boolean toggle is
 * simpler and lines up with how teams actually use shared connections
 * ("anyone in the org can use this").
 *
 * Effects:
 *   - `connections.shared INTEGER NOT NULL DEFAULT 0`
 *   - Any row that already has at least one entry in `connection_shares`
 *     is upgraded to `shared=1` so previously-shared rows keep working.
 *   - `connection_shares` table is dropped (data preserved in `shared` flag).
 *
 * Access semantics enforced in code (db/connections.cjs):
 *   - owner OR admin OR connection.shared=1 → can USE (assign + dispatch)
 *   - only owner + admin → can edit / delete / test / reauth / toggle share
 *   - kredensial mentah tetap server-only (never exposed via API)
 */
module.exports = {
  id: '0003-connection-shared-flag',
  description: 'Replace per-user connection_shares ACL with a boolean shared flag',
  up(db) {
    // Add the column. sql.js doesn't expose a "column exists" helper, so wrap
    // in try/catch — re-running is a no-op once the column is in place.
    try {
      db.run('ALTER TABLE connections ADD COLUMN shared INTEGER NOT NULL DEFAULT 0');
    } catch (err) {
      if (!/duplicate column|already exists/i.test(err.message)) throw err;
    }

    // Upgrade any pre-existing per-user shares to the boolean model. If the
    // table doesn't exist (fresh install on this migration), skip silently.
    try {
      const has = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='connection_shares'");
      if (has.length && has[0].values.length) {
        db.run(`
          UPDATE connections
             SET shared = 1
           WHERE id IN (SELECT DISTINCT connection_id FROM connection_shares)
        `);
        db.run('DROP TABLE connection_shares');
      }
    } catch (err) {
      console.warn('[migration 0003] failed to migrate connection_shares:', err.message);
    }
  },
};
