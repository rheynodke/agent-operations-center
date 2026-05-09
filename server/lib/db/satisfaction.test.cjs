'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

function setupDb() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aocdb-sat-'));
  process.env.AOC_DATA_DIR = tmpDir;
  delete require.cache[require.resolve('../db.cjs')];
  delete require.cache[require.resolve('./satisfaction.cjs')];
  const db = require('../db.cjs');
  return { db, tmpDir };
}

test('recordRating inserts a new row', async () => {
  const { db } = setupDb();
  await db.initDatabase();

  const id = db.recordRating({
    messageId: 'm1', sessionId: 's1', agentId: 'a1', ownerId: 1,
    channel: 'dashboard', source: 'button', rating: 'positive',
    reason: null, raterExternalId: null, createdAt: 1700000000000,
  });
  assert.ok(typeof id === 'number' && id > 0);

  const rows = db.getMessageRatings({ sessionId: 's1' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].rating, 'positive');
  assert.equal(rows[0].source, 'button');
});

test('recordRating same (messageId, source, rater) flips rating (INSERT OR REPLACE)', async () => {
  const { db } = setupDb();
  await db.initDatabase();

  db.recordRating({
    messageId: 'm1', sessionId: 's1', agentId: 'a1', ownerId: 1,
    channel: 'dashboard', source: 'button', rating: 'positive',
    reason: null, raterExternalId: null, createdAt: 1700000000000,
  });

  // Same key, flipped rating
  db.recordRating({
    messageId: 'm1', sessionId: 's1', agentId: 'a1', ownerId: 1,
    channel: 'dashboard', source: 'button', rating: 'negative',
    reason: 'changed mind', raterExternalId: null, createdAt: 1700000001000,
  });

  const rows = db.getMessageRatings({ sessionId: 's1' });
  assert.equal(rows.length, 1, 'should still be 1 row (replaced)');
  assert.equal(rows[0].rating, 'negative');
  assert.equal(rows[0].reason, 'changed mind');
});

test('recordRating different sources for same message coexist', async () => {
  const { db } = setupDb();
  await db.initDatabase();

  db.recordRating({
    messageId: 'm1', sessionId: 's1', agentId: 'a1', ownerId: 1,
    channel: 'dashboard', source: 'button', rating: 'positive',
    raterExternalId: null, createdAt: 1700000000000,
  });
  db.recordRating({
    messageId: 'm1', sessionId: 's1', agentId: 'a1', ownerId: 1,
    channel: 'telegram', source: 'reaction', rating: 'positive',
    raterExternalId: 'tg-user-42', createdAt: 1700000001000,
  });

  const rows = db.getMessageRatings({ sessionId: 's1' });
  assert.equal(rows.length, 2);
});

test('upsertSessionSummary inserts then updates by session_id', async () => {
  const { db } = setupDb();
  await db.initDatabase();

  db.upsertSessionSummary({
    sessionId: 's1', agentId: 'a1', ownerId: 1,
    messageCount: 10, endorsedCount: 3, flaggedCount: 1, presumedGoodCount: 6,
    hallucinationRate: 0.1, endorsementRate: 0.3,
    reflectionStatus: 'completed',
    lessonsExtracted: 2, examplesCaptured: 1,
    llmInputTokens: 4500, llmOutputTokens: 280,
    promptVersion: 'v1.0', reflectionAt: 1700000000000, durationMs: 4200,
  });

  let s = db.getSessionSummary('s1');
  assert.equal(s.messageCount, 10);
  assert.equal(s.reflectionStatus, 'completed');

  // Update (re-reflect)
  db.upsertSessionSummary({
    sessionId: 's1', agentId: 'a1', ownerId: 1,
    messageCount: 10, endorsedCount: 5, flaggedCount: 0, presumedGoodCount: 5,
    hallucinationRate: 0, endorsementRate: 0.5,
    reflectionStatus: 'completed',
    lessonsExtracted: 3, examplesCaptured: 2,
    llmInputTokens: 4600, llmOutputTokens: 290,
    promptVersion: 'v1.0', reflectionAt: 1700000010000, durationMs: 4300,
  });
  s = db.getSessionSummary('s1');
  assert.equal(s.endorsedCount, 5);
  assert.equal(s.lessonsExtracted, 3);
});

test('getSessionSummary returns null for missing session', async () => {
  const { db } = setupDb();
  await db.initDatabase();
  assert.equal(db.getSessionSummary('nonexistent'), null);
});

test('upsertDailyMetric inserts then updates by composite key', async () => {
  const { db } = setupDb();
  await db.initDatabase();

  db.upsertDailyMetric({
    agentId: 'a1', ownerId: 1, day: '2026-05-09', channel: 'all',
    sessionCount: 5, messageCount: 50,
    endorsedCount: 12, flaggedCount: 4,
    hallucinationRate: 0.08, endorsementRate: 0.24,
  });
  let m = db.getDailyMetrics({ agentId: 'a1', ownerId: 1, fromDay: '2026-05-09', toDay: '2026-05-09' });
  assert.equal(m.length, 1);
  assert.equal(m[0].sessionCount, 5);

  // Re-upsert (rollup re-run for same day)
  db.upsertDailyMetric({
    agentId: 'a1', ownerId: 1, day: '2026-05-09', channel: 'all',
    sessionCount: 6, messageCount: 60,
    endorsedCount: 14, flaggedCount: 5,
    hallucinationRate: 0.083, endorsementRate: 0.233,
  });
  m = db.getDailyMetrics({ agentId: 'a1', ownerId: 1, fromDay: '2026-05-09', toDay: '2026-05-09' });
  assert.equal(m.length, 1);
  assert.equal(m[0].sessionCount, 6);
});

test('getDailyMetrics filters by date range and channel', async () => {
  const { db } = setupDb();
  await db.initDatabase();

  for (const day of ['2026-05-07', '2026-05-08', '2026-05-09']) {
    db.upsertDailyMetric({
      agentId: 'a1', ownerId: 1, day, channel: 'all',
      sessionCount: 1, messageCount: 10,
      endorsedCount: 2, flaggedCount: 1,
      hallucinationRate: 0.1, endorsementRate: 0.2,
    });
  }
  const m = db.getDailyMetrics({ agentId: 'a1', ownerId: 1, fromDay: '2026-05-08', toDay: '2026-05-09', channel: 'all' });
  assert.equal(m.length, 2);
  assert.equal(m[0].day, '2026-05-08');
  assert.equal(m[1].day, '2026-05-09');
});

test('aggregateRawForDay computes counts from message_ratings + summaries', async () => {
  const { db } = setupDb();
  await db.initDatabase();

  // Two sessions on the same day with summaries
  const dayMs = new Date('2026-05-09T12:00:00Z').getTime();
  db.upsertSessionSummary({
    sessionId: 's1', agentId: 'a1', ownerId: 1,
    messageCount: 10, endorsedCount: 3, flaggedCount: 1, presumedGoodCount: 6,
    hallucinationRate: 0.1, endorsementRate: 0.3, reflectionStatus: 'completed',
    reflectionAt: dayMs,
  });
  db.upsertSessionSummary({
    sessionId: 's2', agentId: 'a1', ownerId: 1,
    messageCount: 5, endorsedCount: 1, flaggedCount: 0, presumedGoodCount: 4,
    hallucinationRate: 0, endorsementRate: 0.2, reflectionStatus: 'completed',
    reflectionAt: dayMs + 3600_000,
  });

  const agg = db.aggregateRawForDay({ agentId: 'a1', ownerId: 1, day: '2026-05-09', channel: 'all' });
  assert.equal(agg.sessionCount, 2);
  assert.equal(agg.messageCount, 15);
  assert.equal(agg.endorsedCount, 4);
  assert.equal(agg.flaggedCount, 1);
  assert.ok(Math.abs(agg.hallucinationRate - 1/15) < 1e-9);
});
