'use strict';

/**
 * Migration 0004 — admin announcements + per-user read receipts.
 *
 * Use case: admin needs to broadcast a message (provider rotation, scheduled
 * maintenance, skill update) to every user dashboard, persistently, with
 * mark-as-read so it doesn't keep nagging users who already saw it.
 *
 * Tables:
 *   announcements       — admin-authored messages. severity drives banner color.
 *   announcement_reads  — composite PK (announcement_id, user_id). One row per
 *                         user dismissal; absence ⇒ unread, presence ⇒ read.
 *
 * Soft-delete: `active=0` hides the announcement from /api/announcements/active
 * but keeps it for audit. Admin UI can resurrect.
 */
module.exports = {
  id: '0004-announcements',
  description: 'Admin broadcast announcements with per-user read receipts',
  up(db) {
    db.run(`
      CREATE TABLE IF NOT EXISTS announcements (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        title       TEXT NOT NULL,
        body        TEXT NOT NULL DEFAULT '',
        severity    TEXT NOT NULL DEFAULT 'info',
        created_by  INTEGER NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at  TEXT,
        active      INTEGER NOT NULL DEFAULT 1
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements(active, created_at)');
    db.run(`
      CREATE TABLE IF NOT EXISTS announcement_reads (
        announcement_id INTEGER NOT NULL,
        user_id         INTEGER NOT NULL,
        read_at         TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (announcement_id, user_id)
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_announcement_reads_user ON announcement_reads(user_id)');
  },
};
