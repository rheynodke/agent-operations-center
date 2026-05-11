// server/lib/embed/kill-switch.test.cjs
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

// --- DB setup helpers (per embed-sessions.test.cjs pattern) ---

function setupDb() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aocdb-kill-switch-'));
  process.env.AOC_DATA_DIR = tmpDir;
  // Clear require cache so each test gets a fresh db + kill-switch instance
  Object.keys(require.cache).forEach(k => {
    if (k.includes('/server/lib/db') || k.includes('/server/lib/embed/kill-switch')) {
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
  const { db, tmpDir } = setupDb();
  await db.initDatabase();

  const userId = makeUser(db, prefix);
  const agentId = `a-${prefix}`;
  db.upsertAgentProfile({
    agentId, role: 'main', provisionedBy: userId,
    avatarPresetId: '1', color: '#000',
  });
  const embed = db.createEmbed({
    agentId, ownerId: userId, mode: 'private',
    productionOrigin: 'https://x.com', brandName: 'X',
    welcomeTitle: 'X', dlpPreset: 'internal-tool-default',
  });
  // Re-require kill-switch AFTER db is ready so it picks up the fresh db instance
  const ks = require('./kill-switch.cjs');
  ks._resetCacheForTests();
  return { db, userId, embedId: embed.id, ks };
}

// Test 1: isEnabled returns true for fresh embed (enabled column defaults to 1)
test('isEnabled returns true for fresh embed', async () => {
  const { ks, embedId } = await _setup('ks1');
  const result = ks.isEnabled(embedId);
  assert.deepEqual(result, { enabled: true, disableMode: null });
});

// Test 2: isEnabled returns false after toggleEnabled(false) with maintenance mode
test('isEnabled returns false after toggleEnabled(false) with maintenance mode', async () => {
  const { ks, embedId } = await _setup('ks2');
  ks.toggleEnabled(embedId, { enabled: false, mode: 'maintenance' });
  const result = ks.isEnabled(embedId);
  assert.deepEqual(result, { enabled: false, disableMode: 'maintenance' });
});

// Test 3: toggleEnabled invalidates cache — set false then read returns false
test('toggleEnabled invalidates cache so next read is fresh', async () => {
  const { ks, embedId } = await _setup('ks3');
  // Prime the cache with enabled=true
  const before = ks.isEnabled(embedId);
  assert.equal(before.enabled, true);
  // Toggle off (must invalidate the cached entry)
  ks.toggleEnabled(embedId, { enabled: false, mode: 'emergency' });
  // Read again — must NOT return stale cached value
  const after = ks.isEnabled(embedId);
  assert.equal(after.enabled, false);
  assert.equal(after.disableMode, 'emergency');
});

// Test 4: disableAllForOwner sets all owner embeds to disabled
test('disableAllForOwner sets all owner embeds to disabled', async () => {
  const { db, userId, embedId, ks } = await _setup('ks4');

  // Create a second embed for the same owner
  const agentId2 = 'a-ks4-b';
  db.upsertAgentProfile({
    agentId: agentId2, role: 'worker', provisionedBy: userId,
    avatarPresetId: '2', color: '#fff',
  });
  const embed2 = db.createEmbed({
    agentId: agentId2, ownerId: userId, mode: 'private',
    productionOrigin: 'https://y.com', brandName: 'Y',
    welcomeTitle: 'Y', dlpPreset: 'internal-tool-default',
  });

  const disabledIds = ks.disableAllForOwner(userId, { mode: 'emergency' });

  assert.ok(Array.isArray(disabledIds));
  assert.ok(disabledIds.includes(embedId), 'first embed should be in result');
  assert.ok(disabledIds.includes(embed2.id), 'second embed should be in result');
  assert.equal(disabledIds.length, 2);

  // Both should now read as disabled
  const r1 = ks.isEnabled(embedId);
  const r2 = ks.isEnabled(embed2.id);
  assert.equal(r1.enabled, false);
  assert.equal(r2.enabled, false);
  assert.equal(r1.disableMode, 'emergency');
  assert.equal(r2.disableMode, 'emergency');
});

// Test 5: isEnabled returns enabled=false for non-existent embed
test('isEnabled returns enabled=false for non-existent embed', async () => {
  const { ks } = await _setup('ks5');
  const result = ks.isEnabled('nonexistent-embed-id-xyz');
  assert.deepEqual(result, { enabled: false, disableMode: null });
});
