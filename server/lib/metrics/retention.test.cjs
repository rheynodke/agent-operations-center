'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

function freshSetup() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-metrics-r-'));
  process.env.AOC_METRICS_DB_PATH = path.join(tmpDir, 'm.db');
  delete require.cache[require.resolve('./db.cjs')];
  delete require.cache[require.resolve('./queries.cjs')];
  delete require.cache[require.resolve('./retention.cjs')];
  return {
    queries: require('./queries.cjs'),
    retention: require('./retention.cjs'),
  };
}

test('runPrune removes rows older than retention window', () => {
  const { queries, retention } = freshSetup();
  const now = Date.now();
  // 3 old rows + 1 fresh
  for (const offsetDays of [40, 35, 31]) {
    queries.insertSample({ ts: now - offsetDays * 86400000, user_id: 1, state: 'stopped' });
  }
  queries.insertSample({ ts: now - 60_000, user_id: 1, state: 'running' });

  const removed = retention.runPrune({ retentionDays: 30, now });
  assert.strictEqual(removed, 3);
  assert.strictEqual(queries.countSamples(), 1);
});

test('runPrune is a no-op when nothing is old enough', () => {
  const { queries, retention } = freshSetup();
  const now = Date.now();
  queries.insertSample({ ts: now - 1000, user_id: 1, state: 'running' });
  const removed = retention.runPrune({ retentionDays: 30, now });
  assert.strictEqual(removed, 0);
  assert.strictEqual(queries.countSamples(), 1);
});

test('start() and stop() lifecycle is idempotent', () => {
  const { retention } = freshSetup();
  retention.start({ pruneIntervalMs: 60_000, vacuumIntervalMs: 7 * 86400000 });
  retention.start({ pruneIntervalMs: 60_000, vacuumIntervalMs: 7 * 86400000 });
  retention.stop();
  retention.stop();
  assert.ok(true);
});
