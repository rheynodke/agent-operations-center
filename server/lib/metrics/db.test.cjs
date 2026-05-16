'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

function setupTempDb() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-metrics-'));
  const dbPath = path.join(tmpDir, 'm.db');
  process.env.AOC_METRICS_DB_PATH = dbPath;
  delete require.cache[require.resolve('./db.cjs')];
  const mod = require('./db.cjs');
  return { tmpDir, dbPath, mod };
}

test('bootstrap creates gateway_samples with expected columns', () => {
  const { mod } = setupTempDb();
  const db = mod.getDb();
  const cols = db.prepare("PRAGMA table_info('gateway_samples')").all().map(r => r.name);
  for (const expected of [
    'id', 'ts', 'user_id', 'state', 'port', 'pid',
    'uptime_seconds', 'rss_mb', 'cpu_percent',
    'messages_1h', 'messages_24h', 'last_activity_at',
  ]) {
    assert.ok(cols.includes(expected), `missing column ${expected}`);
  }
  mod.close();
});

test('bootstrap creates the three required indexes', () => {
  const { mod } = setupTempDb();
  const db = mod.getDb();
  const idxNames = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='gateway_samples'").all().map(r => r.name);
  for (const expected of [
    'idx_gateway_samples_ts',
    'idx_gateway_samples_user_ts',
    'idx_gateway_samples_state_ts',
  ]) {
    assert.ok(idxNames.includes(expected), `missing index ${expected}`);
  }
  mod.close();
});

test('schema_version row exists after bootstrap', () => {
  const { mod } = setupTempDb();
  const db = mod.getDb();
  const row = db.prepare('SELECT version FROM schema_version LIMIT 1').get();
  assert.strictEqual(row.version, 1);
  mod.close();
});

test('bootstrap is idempotent (re-init same file is safe)', () => {
  const { dbPath, mod } = setupTempDb();
  mod.close();
  delete require.cache[require.resolve('./db.cjs')];
  process.env.AOC_METRICS_DB_PATH = dbPath;
  const mod2 = require('./db.cjs');
  // No throw on second bootstrap
  assert.ok(mod2.getDb());
  mod2.close();
});

test('WAL mode is enabled', () => {
  const { mod } = setupTempDb();
  const db = mod.getDb();
  const journalMode = db.pragma('journal_mode', { simple: true });
  assert.strictEqual(journalMode, 'wal');
  mod.close();
});
