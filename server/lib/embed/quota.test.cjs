// server/lib/embed/quota.test.cjs
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ─── DB isolation helper ─────────────────────────────────────────────────────

function setupDb() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aocdb-quota-'));
  process.env.AOC_DATA_DIR = tmpDir;
  Object.keys(require.cache).forEach(k => {
    if (k.includes('/server/lib/db') || k.includes('/server/lib/embed/quota')) {
      delete require.cache[k];
    }
  });
  const db = require('../db.cjs');
  return { db, tmpDir };
}

function makeUser(db, suffix) {
  const user = db.createUser({ username: `test-${suffix}`, password: 'password123', role: 'admin' });
  return user.id;
}

async function _setup(prefix) {
  const { db } = setupDb();
  await db.initDatabase();

  const userId = makeUser(db, prefix);
  const agentId = `a-${prefix}`;
  db.upsertAgentProfile({
    agentId, role: 'main', provisionedBy: userId,
    avatarPresetId: '1', color: '#000',
  });
  const embed = db.createEmbed({
    agentId,
    ownerId: userId,
    mode: 'private',
    productionOrigin: 'https://x.com',
    brandName: 'X',
    welcomeTitle: 'Halo',
    dlpPreset: 'internal-tool-default',
    dailyMessageQuota: 10,
    dailyTokenQuota: 1000,
  });
  return { db, userId, embed };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test('checkDailyQuota: production session under quota → ok=true', async () => {
  const { db, embed } = await _setup('q1');
  const quota = require('./quota.cjs');

  const today = quota._today();
  const result = quota.checkDailyQuota(db, embed.id, embed.dailyMessageQuota, embed.dailyTokenQuota, today, 'production');
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.skipped, undefined);
});

test('checkDailyQuota: production session exceeds message cap → ok=false', async () => {
  const { db, embed } = await _setup('q2');
  const quota = require('./quota.cjs');

  const today = quota._today();

  // Burn the message quota
  quota.incrementDailyMetric(embed.id, embed.ownerId, today, 'production', { messageDelta: embed.dailyMessageQuota });

  const result = quota.checkDailyQuota(db, embed.id, embed.dailyMessageQuota, embed.dailyTokenQuota, today, 'production');
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'daily_message_quota_exceeded');
});

test('checkDailyQuota: production session exceeds token cap → ok=false', async () => {
  const { db, embed } = await _setup('q3');
  const quota = require('./quota.cjs');

  const today = quota._today();

  // Burn the token quota
  quota.incrementDailyMetric(embed.id, embed.ownerId, today, 'production', { tokenDelta: embed.dailyTokenQuota });

  const result = quota.checkDailyQuota(db, embed.id, embed.dailyMessageQuota, embed.dailyTokenQuota, today, 'production');
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'daily_token_quota_exceeded');
});

test('checkDailyQuota: playground traffic_type skips message + token caps', async () => {
  const { db, embed } = await _setup('q4');
  const quota = require('./quota.cjs');

  const today = quota._today();

  // Burn the production quota completely (to confirm it's separate from playground)
  quota.incrementDailyMetric(embed.id, embed.ownerId, today, 'production', {
    messageDelta: embed.dailyMessageQuota,
    tokenDelta: embed.dailyTokenQuota,
  });

  // Production should fail
  const prodResult = quota.checkDailyQuota(db, embed.id, 1, 1, today, 'production');
  assert.strictEqual(prodResult.ok, false, 'production should be blocked when quota is 1 and used >= 1');

  // Playground should succeed even with very low quotas
  const playResult = quota.checkDailyQuota(db, embed.id, 1, 1, today, 'playground');
  assert.strictEqual(playResult.ok, true, 'playground should bypass quota checks');
  assert.strictEqual(playResult.skipped, true, 'playground should set skipped=true');
});

test('checkDailyQuota: playground skips quota even when quotas are tight (1 msg cap burned)', async () => {
  const { db, embed } = await _setup('q5');
  const quota = require('./quota.cjs');

  const today = quota._today();

  // Embed with quota=1; burn it
  quota.incrementDailyMetric(embed.id, embed.ownerId, today, 'production', { messageDelta: 1 });

  // Production blocked
  const prodResult = quota.checkDailyQuota(db, embed.id, 1, 1, today, 'production');
  assert.strictEqual(prodResult.ok, false);

  // Playground still passes
  const playResult = quota.checkDailyQuota(db, embed.id, 1, 1, today, 'playground');
  assert.strictEqual(playResult.ok, true);
  assert.strictEqual(playResult.skipped, true);
});

test('checkDailyQuota: 0 or null quota values are treated as unlimited', async () => {
  const { db, embed } = await _setup('q6');
  const quota = require('./quota.cjs');

  const today = quota._today();

  // Burn a lot
  quota.incrementDailyMetric(embed.id, embed.ownerId, today, 'production', { messageDelta: 99999, tokenDelta: 99999 });

  // Zero quotas = unlimited
  const r1 = quota.checkDailyQuota(db, embed.id, 0, 0, today, 'production');
  assert.strictEqual(r1.ok, true, 'zero quotas should mean unlimited');

  // Null quotas = unlimited
  const r2 = quota.checkDailyQuota(db, embed.id, null, null, today, 'production');
  assert.strictEqual(r2.ok, true, 'null quotas should mean unlimited');
});

test('incrementDailyMetric: accumulates across multiple calls', async () => {
  const { db, embed } = await _setup('q7');
  const quota = require('./quota.cjs');

  const today = quota._today();

  quota.incrementDailyMetric(embed.id, embed.ownerId, today, 'production', { messageDelta: 3, tokenDelta: 100 });
  quota.incrementDailyMetric(embed.id, embed.ownerId, today, 'production', { messageDelta: 2, tokenDelta: 50 });

  const totals = quota.getDailyTotals(embed.id, today, 'production');
  assert.strictEqual(totals.messageCount, 5);
  assert.strictEqual(totals.tokenTotal, 150);
});

test('incrementDailyMetric: playground metrics stored separately from production', async () => {
  const { db, embed } = await _setup('q8');
  const quota = require('./quota.cjs');

  const today = quota._today();

  quota.incrementDailyMetric(embed.id, embed.ownerId, today, 'production', { messageDelta: 5 });
  quota.incrementDailyMetric(embed.id, embed.ownerId, today, 'playground', { messageDelta: 10 });

  const prod = quota.getDailyTotals(embed.id, today, 'production');
  const play = quota.getDailyTotals(embed.id, today, 'playground');
  assert.strictEqual(prod.messageCount, 5, 'production count should be 5');
  assert.strictEqual(play.messageCount, 10, 'playground count should be 10');
});

test('checkDailyQuota: default trafficType is production (back-compat)', async () => {
  const { db, embed } = await _setup('q9');
  const quota = require('./quota.cjs');

  const today = quota._today();

  // With no trafficType arg, should default to production behaviour
  const result = quota.checkDailyQuota(db, embed.id, embed.dailyMessageQuota, embed.dailyTokenQuota, today);
  assert.strictEqual(result.ok, true, 'default trafficType should be production (and under quota)');
  assert.strictEqual(result.skipped, undefined, 'default production should not skip');
});
