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

// --- aggregate() tests ---

test('aggregate returns zeroed envelope on empty DB', () => {
  const q = setupTempDb();
  const result = q.aggregate('1h');
  assert.strictEqual(result.totalRssMb, 0);
  assert.strictEqual(result.avgCpuPercent, 0);
  assert.strictEqual(result.runningCount, 0);
  assert.strictEqual(result.totalCount, 0);
  assert.strictEqual(result.totalMessages24h, 0);
  assert.strictEqual(result.deltaRssPercent, null);
  assert.strictEqual(result.deltaCpuPercent, null);
});

test('aggregate snapshots use latest sample per user in the current window', () => {
  const q = setupTempDb();
  const now = Date.now();
  // user 1: two samples in window, latest is rss=200
  q.insertSample({ ts: now - 30_000, user_id: 1, state: 'running', rss_mb: 100, cpu_percent: 2, messages_1h: 5,  messages_24h: 100 });
  q.insertSample({ ts: now - 5_000,  user_id: 1, state: 'running', rss_mb: 200, cpu_percent: 4, messages_1h: 10, messages_24h: 250 });
  // user 2: one sample, stopped
  q.insertSample({ ts: now - 10_000, user_id: 2, state: 'stopped', rss_mb: null, cpu_percent: null, messages_1h: null, messages_24h: 50 });
  const result = q.aggregate('1h');
  assert.strictEqual(result.totalCount, 2);
  assert.strictEqual(result.runningCount, 1);
  assert.strictEqual(result.totalRssMb, 200); // only running user 1's latest
  assert.strictEqual(result.avgCpuPercent, 4); // only user 1's latest cpu (user 2 cpu is null)
  assert.strictEqual(result.totalMessages24h, 300); // 250 + 50
});

test('aggregate computes deltaRssPercent vs previous window', () => {
  const q = setupTempDb();
  const now = Date.now();
  // current window (1h = 3_600_000ms): two samples avg 200
  q.insertSample({ ts: now - 10_000,    user_id: 1, state: 'running', rss_mb: 150, cpu_percent: 1, messages_1h: 0, messages_24h: 0 });
  q.insertSample({ ts: now - 1_000_000, user_id: 1, state: 'running', rss_mb: 250, cpu_percent: 3, messages_1h: 0, messages_24h: 0 });
  // previous window [now-7_200_000, now-3_600_000): two samples avg 100
  q.insertSample({ ts: now - 4_000_000, user_id: 1, state: 'running', rss_mb: 80,  cpu_percent: 1, messages_1h: 0, messages_24h: 0 });
  q.insertSample({ ts: now - 6_000_000, user_id: 1, state: 'running', rss_mb: 120, cpu_percent: 2, messages_1h: 0, messages_24h: 0 });
  const result = q.aggregate('1h');
  // delta = (200 - 100) / 100 * 100 = 100%
  assert.strictEqual(result.deltaRssPercent, 100);
  // cpu delta: cur avg = 2, prev avg = 1.5, delta = (2-1.5)/1.5*100 ≈ 33.33%
  assert.ok(Math.abs(result.deltaCpuPercent - 33.333333333333336) < 0.001);
});

test('aggregate deltaRssPercent is null when previous window is empty', () => {
  const q = setupTempDb();
  q.insertSample({ ts: Date.now() - 10_000, user_id: 1, state: 'running', rss_mb: 200, cpu_percent: 1, messages_1h: 0, messages_24h: 0 });
  const result = q.aggregate('1h');
  assert.strictEqual(result.deltaRssPercent, null);
  assert.strictEqual(result.deltaCpuPercent, null);
});

test('aggregate handles null rss/cpu without crashing (all stopped)', () => {
  const q = setupTempDb();
  q.insertSample({ ts: Date.now() - 10_000, user_id: 1, state: 'stopped', rss_mb: null, cpu_percent: null, messages_1h: null, messages_24h: 0 });
  const result = q.aggregate('1h');
  assert.strictEqual(result.totalCount, 1);
  assert.strictEqual(result.runningCount, 0);
  assert.strictEqual(result.totalRssMb, 0);
  assert.strictEqual(result.avgCpuPercent, 0);
});

test('aggregate throws RangeError for unknown range key', () => {
  const q = setupTempDb();
  assert.throws(() => q.aggregate('99d'), { name: 'RangeError' });
});

// --- leaderboard() tests ---

test('leaderboard returns users ordered by metric descending', () => {
  const q = setupTempDb();
  const now = Date.now();
  q.insertSample({ ts: now - 1000, user_id: 1, state: 'running', rss_mb: 100, cpu_percent: 1, messages_1h: 0, messages_24h: 0 });
  q.insertSample({ ts: now - 1000, user_id: 2, state: 'running', rss_mb: 300, cpu_percent: 3, messages_1h: 0, messages_24h: 0 });
  q.insertSample({ ts: now - 1000, user_id: 3, state: 'running', rss_mb: 200, cpu_percent: 2, messages_1h: 0, messages_24h: 0 });
  const result = q.leaderboard('1h', 'rss', 10);
  assert.strictEqual(result.length, 3);
  assert.deepStrictEqual(result.map((r) => r.userId), [2, 3, 1]);
  assert.strictEqual(result[0].value, 300);
});

test('leaderboard computes deltaPercent vs previous window', () => {
  const q = setupTempDb();
  const now = Date.now();
  // user 1 cur=200, prev=100 → +100%
  q.insertSample({ ts: now - 1_000,     user_id: 1, state: 'running', rss_mb: 200, cpu_percent: 0, messages_1h: 0, messages_24h: 0 });
  q.insertSample({ ts: now - 5_000_000, user_id: 1, state: 'running', rss_mb: 100, cpu_percent: 0, messages_1h: 0, messages_24h: 0 });
  // user 2 cur=400, prev=0 (no prev data) → null
  q.insertSample({ ts: now - 1_000, user_id: 2, state: 'running', rss_mb: 400, cpu_percent: 0, messages_1h: 0, messages_24h: 0 });
  const result = q.leaderboard('1h', 'rss', 10);
  const u1 = result.find((r) => r.userId === 1);
  const u2 = result.find((r) => r.userId === 2);
  assert.strictEqual(u1.deltaPercent, 100);
  assert.strictEqual(u1.avgPrev, 100);
  assert.strictEqual(u2.deltaPercent, null);
});

test('leaderboard supports cpu and messages_1h metrics', () => {
  const q = setupTempDb();
  const now = Date.now();
  q.insertSample({ ts: now - 1000, user_id: 1, state: 'running', rss_mb: 100, cpu_percent: 5, messages_1h: 20, messages_24h: 0 });
  q.insertSample({ ts: now - 1000, user_id: 2, state: 'running', rss_mb: 200, cpu_percent: 1, messages_1h: 50, messages_24h: 0 });
  const cpuResult = q.leaderboard('1h', 'cpu', 10);
  assert.strictEqual(cpuResult[0].userId, 1);
  const msgResult = q.leaderboard('1h', 'messages_1h', 10);
  assert.strictEqual(msgResult[0].userId, 2);
});

test('leaderboard respects limit', () => {
  const q = setupTempDb();
  const now = Date.now();
  for (let i = 1; i <= 5; i += 1) {
    q.insertSample({ ts: now - 1000, user_id: i, state: 'running', rss_mb: i * 10, cpu_percent: 0, messages_1h: 0, messages_24h: 0 });
  }
  const result = q.leaderboard('1h', 'rss', 3);
  assert.strictEqual(result.length, 3);
});

test('leaderboard returns empty array when no data', () => {
  const q = setupTempDb();
  assert.deepStrictEqual(q.leaderboard('1h', 'rss', 10), []);
});

test('leaderboard throws RangeError for unknown metric', () => {
  const q = setupTempDb();
  assert.throws(() => q.leaderboard('1h', 'foo', 10), { name: 'RangeError' });
});

test('leaderboard throws RangeError for unknown range', () => {
  const q = setupTempDb();
  assert.throws(() => q.leaderboard('99d', 'rss', 10), { name: 'RangeError' });
});

test('leaderboard excludes users with all-null metric values in window', () => {
  const q = setupTempDb();
  const now = Date.now();
  q.insertSample({ ts: now - 1000, user_id: 1, state: 'stopped', rss_mb: null, cpu_percent: null, messages_1h: null, messages_24h: 0 });
  q.insertSample({ ts: now - 1000, user_id: 2, state: 'running', rss_mb: 100,  cpu_percent: 1,    messages_1h: 0,    messages_24h: 0 });
  const result = q.leaderboard('1h', 'rss', 10);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].userId, 2);
});
