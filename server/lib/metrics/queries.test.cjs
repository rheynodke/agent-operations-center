'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

function setupTempDb() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-metrics-q-'));
  process.env.AOC_METRICS_DB_PATH = path.join(tmpDir, 'm.db');
  delete require.cache[require.resolve('./db.cjs')];
  delete require.cache[require.resolve('./queries.cjs')];
  return require('./queries.cjs');
}

test('insertSample + countSamples roundtrip', () => {
  const q = setupTempDb();
  const ts = Date.now();
  q.insertSample({
    ts, user_id: 5, state: 'running', port: 19001, pid: 12345,
    uptime_seconds: 60, rss_mb: 145.2, cpu_percent: 1.3,
    messages_1h: 12, messages_24h: 480, last_activity_at: ts - 1000,
  });
  assert.strictEqual(q.countSamples(), 1);
});

test('insertSamplesBatch inserts multiple rows in one transaction', () => {
  const q = setupTempDb();
  const ts = Date.now();
  const rows = [
    { ts, user_id: 1, state: 'stopped', port: null, pid: null, uptime_seconds: null,
      rss_mb: null, cpu_percent: null, messages_1h: null, messages_24h: null,
      last_activity_at: null },
    { ts, user_id: 2, state: 'running', port: 19002, pid: 222, uptime_seconds: 30,
      rss_mb: 100.0, cpu_percent: 0.5, messages_1h: 0, messages_24h: 0,
      last_activity_at: null },
  ];
  q.insertSamplesBatch(rows);
  assert.strictEqual(q.countSamples(), 2);
});

test('pruneBefore deletes exactly rows older than cutoff', () => {
  const q = setupTempDb();
  const now = Date.now();
  // Two old rows (older than cutoff) + one fresh row
  q.insertSample({ ts: now - 40 * 86400000, user_id: 1, state: 'stopped' });
  q.insertSample({ ts: now - 31 * 86400000, user_id: 1, state: 'stopped' });
  q.insertSample({ ts: now - 1 * 60_000,    user_id: 1, state: 'running' });
  const cutoff = now - 30 * 86400000;
  const deleted = q.pruneBefore(cutoff);
  assert.strictEqual(deleted, 2);
  assert.strictEqual(q.countSamples(), 1);
});

test('insertSample accepts nullable resource fields', () => {
  const q = setupTempDb();
  q.insertSample({
    ts: Date.now(), user_id: 9, state: 'stopped',
    port: null, pid: null, uptime_seconds: null,
    rss_mb: null, cpu_percent: null,
    messages_1h: null, messages_24h: null, last_activity_at: null,
  });
  assert.strictEqual(q.countSamples(), 1);
});
