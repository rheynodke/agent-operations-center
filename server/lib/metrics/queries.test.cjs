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

// --- timeseries() tests ---

test('timeseries returns expected envelope shape with empty users when no data', () => {
  const q = setupTempDb();
  const result = q.timeseries('1h');
  assert.strictEqual(result.range, '1h');
  assert.strictEqual(result.bucketMs, 30_000);
  assert.deepStrictEqual(result.users, []);
});

test('timeseries averages rss_mb across samples in the same bucket', () => {
  const q = setupTempDb();
  // Snap to a known 30s bucket inside the 1h window so both samples are
  // guaranteed to fall in the same bucket regardless of wall-clock alignment.
  const BUCKET_MS = 30_000;
  const bucketStart = Math.floor((Date.now() - 60_000) / BUCKET_MS) * BUCKET_MS;
  q.insertSample({ ts: bucketStart + 1_000,  user_id: 1, state: 'running', rss_mb: 100, cpu_percent: 1, messages_1h: 0, messages_24h: 0 });
  q.insertSample({ ts: bucketStart + 15_000, user_id: 1, state: 'running', rss_mb: 200, cpu_percent: 3, messages_1h: 4, messages_24h: 0 });
  const result = q.timeseries('1h');
  assert.strictEqual(result.users.length, 1);
  assert.strictEqual(result.users[0].userId, 1);
  // Find the bucket we control (other buckets in window may be empty)
  const point = result.users[0].points.find((p) => p.ts === bucketStart);
  assert.ok(point, `expected point at ts=${bucketStart}, got ${JSON.stringify(result.users[0].points)}`);
  assert.strictEqual(point.rssMb, 150);
  assert.strictEqual(point.cpuPercent, 2);
  assert.strictEqual(point.messages1h, 2);
});

test('timeseries excludes samples outside the [from, to) window', () => {
  const q = setupTempDb();
  const now = Date.now();
  // 2h ago is outside the 1h window
  q.insertSample({ ts: now - 2 * 3_600_000, user_id: 1, state: 'running', rss_mb: 999, cpu_percent: 0, messages_1h: 0, messages_24h: 0 });
  q.insertSample({ ts: now - 5_000,         user_id: 1, state: 'running', rss_mb: 100, cpu_percent: 0, messages_1h: 0, messages_24h: 0 });
  const result = q.timeseries('1h');
  const allPoints = result.users.flatMap((u) => u.points);
  assert.ok(allPoints.every((p) => p.rssMb !== 999), 'outside-window sample leaked into result');
});

test('timeseries separates users into distinct series', () => {
  const q = setupTempDb();
  const now = Date.now();
  q.insertSample({ ts: now - 5_000, user_id: 1, state: 'running', rss_mb: 100, cpu_percent: 1, messages_1h: 0, messages_24h: 0 });
  q.insertSample({ ts: now - 5_000, user_id: 2, state: 'running', rss_mb: 200, cpu_percent: 2, messages_1h: 0, messages_24h: 0 });
  const result = q.timeseries('1h');
  const userIds = result.users.map((u) => u.userId).sort();
  assert.deepStrictEqual(userIds, [1, 2]);
});

test('timeseries with userId option returns only that user', () => {
  const q = setupTempDb();
  const now = Date.now();
  q.insertSample({ ts: now - 5_000, user_id: 1, state: 'running', rss_mb: 100, cpu_percent: 1, messages_1h: 0, messages_24h: 0 });
  q.insertSample({ ts: now - 5_000, user_id: 2, state: 'running', rss_mb: 200, cpu_percent: 2, messages_1h: 0, messages_24h: 0 });
  const result = q.timeseries('1h', { userId: 1 });
  assert.strictEqual(result.users.length, 1);
  assert.strictEqual(result.users[0].userId, 1);
});

test('timeseries throws RangeError for unknown range key', () => {
  const q = setupTempDb();
  assert.throws(() => q.timeseries('99d'), { name: 'RangeError' });
});

test('timeseries bucketMs scales with range', () => {
  const q = setupTempDb();
  assert.strictEqual(q.timeseries('1h').bucketMs, 30_000);
  assert.strictEqual(q.timeseries('6h').bucketMs, 60_000);
  assert.strictEqual(q.timeseries('24h').bucketMs, 300_000);
  assert.strictEqual(q.timeseries('7d').bucketMs, 1_800_000);
  assert.strictEqual(q.timeseries('30d').bucketMs, 7_200_000);
});
