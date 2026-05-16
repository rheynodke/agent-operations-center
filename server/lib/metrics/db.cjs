'use strict';

/**
 * server/lib/metrics/db.cjs
 *
 * better-sqlite3 connection for the gateway metrics database.
 * Separate from server/lib/db.cjs (sql.js, in-memory) to avoid bloat from
 * time-series rows. File-based + WAL for concurrent reads.
 *
 * Schema bootstrap is idempotent — safe to require multiple times.
 *
 * Env:
 *   AOC_METRICS_DB_PATH  — override path (default: <repo>/data/aoc_metrics.db)
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DEFAULT_DB_PATH = path.join(__dirname, '..', '..', '..', 'data', 'aoc_metrics.db');
const DB_PATH = process.env.AOC_METRICS_DB_PATH || DEFAULT_DB_PATH;

// Ensure parent dir exists (better-sqlite3 won't create it).
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');

function bootstrap() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version    INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS gateway_samples (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      ts               INTEGER NOT NULL,
      user_id          INTEGER NOT NULL,
      state            TEXT    NOT NULL,
      port             INTEGER,
      pid              INTEGER,
      uptime_seconds   INTEGER,
      rss_mb           REAL,
      cpu_percent      REAL,
      messages_1h      INTEGER,
      messages_24h     INTEGER,
      last_activity_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_gateway_samples_ts
      ON gateway_samples(ts);
    CREATE INDEX IF NOT EXISTS idx_gateway_samples_user_ts
      ON gateway_samples(user_id, ts);
    CREATE INDEX IF NOT EXISTS idx_gateway_samples_state_ts
      ON gateway_samples(state, ts);
  `);

  // Seed schema_version row if missing
  const existing = db.prepare('SELECT version FROM schema_version LIMIT 1').get();
  if (!existing) {
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)')
      .run(1, Date.now());
  }
}

bootstrap();

function getDb() {
  return db;
}

function close() {
  if (db.open) db.close();
}

module.exports = { getDb, close, DB_PATH };
