'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

function freshSetup() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-metrics-p-'));
  process.env.AOC_METRICS_DB_PATH = path.join(tmpDir, 'm.db');
  delete require.cache[require.resolve('./db.cjs')];
  delete require.cache[require.resolve('./queries.cjs')];
  delete require.cache[require.resolve('./poller.cjs')];
  const queries = require('./queries.cjs');
  const poller = require('./poller.cjs');
  return { queries, poller };
}

const fakeRows = [
  { userId: 1, state: 'running', port: 19001, pid: 100, uptimeSeconds: 60,
    rssMb: 120.5, cpuPercent: 0.8,
    activity: { messagesLast1h: 3, messagesLast24h: 50, lastActivityAt: '2026-05-16T00:00:00Z' } },
  { userId: 2, state: 'stopped', port: null, pid: null, uptimeSeconds: null,
    rssMb: null, cpuPercent: null, activity: null },
];

test('runOnce inserts one row per gateway returned by probe', async () => {
  const { queries, poller } = freshSetup();
  await poller.runOnce({ probe: async () => fakeRows });
  assert.strictEqual(queries.countSamples(), 2);
});

test('runOnce normalises activity null safely', async () => {
  const { queries, poller } = freshSetup();
  await poller.runOnce({ probe: async () => [
    { userId: 7, state: 'stopped', port: null, pid: null, uptimeSeconds: null,
      rssMb: null, cpuPercent: null, activity: null },
  ]});
  assert.strictEqual(queries.countSamples(), 1);
});

test('in-flight lock prevents overlap when probe is slow', async () => {
  const { queries, poller } = freshSetup();
  let probeCalls = 0;
  const slowProbe = () => new Promise((resolve) => {
    probeCalls++;
    setTimeout(() => resolve(fakeRows), 100);
  });
  // Trigger two ticks in quick succession; second should no-op
  const p1 = poller.runOnce({ probe: slowProbe });
  const p2 = poller.runOnce({ probe: slowProbe });
  await Promise.all([p1, p2]);
  assert.strictEqual(probeCalls, 1, 'second tick should skip while first is in flight');
  assert.strictEqual(queries.countSamples(), 2);
});

test('start() and stop() lifecycle is idempotent', () => {
  const { poller } = freshSetup();
  poller.start({ probe: async () => fakeRows, intervalMs: 60_000 });
  // Second start is a no-op
  poller.start({ probe: async () => fakeRows, intervalMs: 60_000 });
  poller.stop();
  poller.stop(); // second stop is a no-op
  assert.ok(true); // reaches here without throwing
});
