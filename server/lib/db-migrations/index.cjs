'use strict';

/**
 * Lightweight schema-migration runner for the sql.js DB.
 *
 * Why this exists: `initDatabase()` historically grew an ever-longer chain of
 * `try { db.run('ALTER TABLE ...') } catch {}` lines (52 at last count). It's
 * idempotent but slow to boot, hard to reason about ordering, and impossible
 * to roll back. This runner records what's been applied and only runs pending
 * migrations going forward.
 *
 * Existing inline ALTER TABLEs stay where they are — they're effectively
 * "baseline v0". The runner kicks in for migrations added AFTER 2026-05-06.
 *
 * To add a migration:
 *   1. Create `NNNN-short-name.cjs` here, exporting:
 *        { id: 'NNNN-short-name', description: '...', up(db) { ... } }
 *      Use a 4-digit zero-padded prefix (sorting is lexical). Don't reuse ids.
 *   2. Add it to `MIGRATIONS` below in order.
 *   3. The runner records the id into `schema_migrations` so it won't re-run.
 *
 * Migrations should be idempotent where reasonable (use `IF NOT EXISTS`,
 * check PRAGMA before destructive rebuilds). The runner is intentionally
 * dumb — no transactions across migrations, no down() (forward-only). On
 * failure: log + throw so initDatabase fails loud.
 */

// Order matters. Append new entries at the end; never reorder.
const MIGRATIONS = [
  require('./0001-audit-log.cjs'),
  require('./0002-connection-shares.cjs'),
  require('./0003-connection-shared-flag.cjs'),
  require('./0004-announcements.cjs'),
];

function ensureMigrationsTable(db) {
  db.run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          TEXT PRIMARY KEY,
      description TEXT,
      applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

function getApplied(db) {
  const res = db.exec('SELECT id FROM schema_migrations');
  if (!res.length) return new Set();
  return new Set(res[0].values.map(r => r[0]));
}

function recordApplied(db, id, description) {
  db.run('INSERT INTO schema_migrations (id, description) VALUES (?, ?)', [id, description || null]);
}

/**
 * Run any pending migrations. Idempotent; safe to call on every startup.
 *
 * @param {object} db - sql.js Database instance
 * @returns {{applied: string[], skipped: number}}
 */
function runMigrations(db) {
  ensureMigrationsTable(db);
  const applied = getApplied(db);
  const ran = [];
  for (const m of MIGRATIONS) {
    if (!m || !m.id) {
      console.warn('[db-migrations] skipping malformed entry');
      continue;
    }
    if (applied.has(m.id)) continue;
    console.log(`[db-migrations] applying ${m.id} — ${m.description || ''}`);
    try {
      m.up(db);
      recordApplied(db, m.id, m.description || '');
      ran.push(m.id);
    } catch (err) {
      console.error(`[db-migrations] FAILED ${m.id}: ${err.message}`);
      throw err; // halt boot — partial schema is dangerous
    }
  }
  return { applied: ran, skipped: applied.size };
}

module.exports = { runMigrations, MIGRATIONS };
