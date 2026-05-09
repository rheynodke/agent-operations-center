'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

function setupDb() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aocdb-rollup-'));
  process.env.AOC_DATA_DIR = tmpDir;
  delete require.cache[require.resolve('./db.cjs')];
  delete require.cache[require.resolve('./db/satisfaction.cjs')];
  delete require.cache[require.resolve('./satisfaction-rollup.cjs')];
  return { db: require('./db.cjs'), rollup: require('./satisfaction-rollup.cjs'), tmpDir };
}

test('rollupForDay computes and upserts metrics for given day', async () => {
  const { db, rollup } = setupDb();
  await db.initDatabase();

  // Seed: 2 sessions on 2026-05-09 for agent a1
  const dayMs = new Date('2026-05-09T12:00:00Z').getTime();
  db.upsertSessionSummary({
    sessionId: 's1', agentId: 'a1', ownerId: 1,
    messageCount: 10, endorsedCount: 3, flaggedCount: 1, presumedGoodCount: 6,
    hallucinationRate: 0.1, endorsementRate: 0.3,
    reflectionStatus: 'completed', reflectionAt: dayMs,
  });
  db.upsertSessionSummary({
    sessionId: 's2', agentId: 'a1', ownerId: 1,
    messageCount: 5, endorsedCount: 2, flaggedCount: 0, presumedGoodCount: 3,
    hallucinationRate: 0, endorsementRate: 0.4,
    reflectionStatus: 'completed', reflectionAt: dayMs + 3600_000,
  });

  await rollup.rollupForDay({ day: '2026-05-09', agentId: 'a1', ownerId: 1 });
  const m = db.getDailyMetrics({ agentId: 'a1', ownerId: 1, fromDay: '2026-05-09', toDay: '2026-05-09' });
  assert.equal(m.length, 1);
  assert.equal(m[0].sessionCount, 2);
  assert.equal(m[0].messageCount, 15);
  assert.equal(m[0].endorsedCount, 5);
  assert.equal(m[0].flaggedCount, 1);
});

test('rollupAllAgents iterates all owner+agent combos with sessions on day', async () => {
  const { db, rollup } = setupDb();
  await db.initDatabase();

  const dayMs = new Date('2026-05-09T12:00:00Z').getTime();
  db.upsertSessionSummary({
    sessionId: 's1', agentId: 'a1', ownerId: 1,
    messageCount: 5, endorsedCount: 2, flaggedCount: 0, presumedGoodCount: 3,
    hallucinationRate: 0, endorsementRate: 0.4,
    reflectionStatus: 'completed', reflectionAt: dayMs,
  });
  db.upsertSessionSummary({
    sessionId: 's2', agentId: 'b2', ownerId: 2,
    messageCount: 8, endorsedCount: 1, flaggedCount: 1, presumedGoodCount: 6,
    hallucinationRate: 0.125, endorsementRate: 0.125,
    reflectionStatus: 'completed', reflectionAt: dayMs,
  });

  await rollup.rollupAllAgents({ day: '2026-05-09' });
  const m1 = db.getDailyMetrics({ agentId: 'a1', ownerId: 1, fromDay: '2026-05-09', toDay: '2026-05-09' });
  const m2 = db.getDailyMetrics({ agentId: 'b2', ownerId: 2, fromDay: '2026-05-09', toDay: '2026-05-09' });
  assert.equal(m1.length, 1);
  assert.equal(m2.length, 1);
});
