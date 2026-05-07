'use strict';

/**
 * Migration 0001 — audit log table.
 *
 * Records mutations on sensitive resources (users, agents, connections,
 * permissions). Used for compliance review, debugging "who changed what",
 * and incident response. Append-only — UI may surface but never edits.
 *
 * Schema fields:
 *   - actor_id    : userId of the user who triggered the action (NULL for
 *                   system actions, e.g. background jobs)
 *   - actor_role  : snapshot of role at action time (admin / user / agent)
 *   - action      : short verb-noun string (e.g. 'agent.deleted',
 *                   'user.role_changed', 'connection.created')
 *   - target_type : entity class (e.g. 'agent', 'user', 'connection')
 *   - target_id   : opaque id of the affected row
 *   - before      : optional JSON snapshot pre-mutation
 *   - after       : optional JSON snapshot post-mutation
 *   - reason      : free-form note from the actor (e.g. password reset reason)
 *   - request_ip  : best-effort source IP from req.ip
 *   - created_at  : ISO timestamp
 */
module.exports = {
  id: '0001-audit-log',
  description: 'Create audit_log table for compliance + incident review',
  up(db) {
    db.run(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_id     INTEGER,
        actor_role   TEXT,
        action       TEXT NOT NULL,
        target_type  TEXT,
        target_id    TEXT,
        before       TEXT,
        after        TEXT,
        reason       TEXT,
        request_ip   TEXT,
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_audit_log_actor      ON audit_log(actor_id, created_at)');
    db.run('CREATE INDEX IF NOT EXISTS idx_audit_log_target     ON audit_log(target_type, target_id, created_at)');
    db.run('CREATE INDEX IF NOT EXISTS idx_audit_log_action     ON audit_log(action, created_at)');
  },
};
