// server/lib/db/embed-sessions.test.cjs
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Use isolated test DB per satisfaction.test.cjs / embeds.test.cjs pattern
function setupDb() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aocdb-embed-sessions-'));
  process.env.AOC_DATA_DIR = tmpDir;
  // Clear require cache so each test gets a fresh db instance
  Object.keys(require.cache).forEach(k => {
    if (k.includes('/server/lib/db')) delete require.cache[k];
  });
  const db = require('../db.cjs');
  return { db, tmpDir };
}

// Helper: create a user and return its integer id.
// createUser takes { username, password, displayName, role }
function makeUser(db, suffix) {
  const user = db.createUser({ username: `test-${suffix}`, password: 'password123', role: 'admin' });
  return user.id;
}

// Helper: set up full embed fixture (user + agentProfile + embed)
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
    agentId, ownerId: userId, mode: 'private',
    productionOrigin: 'https://x.com', brandName: 'X',
    welcomeTitle: 'X', dlpPreset: 'internal-tool-default',
  });
  return { db, userId, embedId: embed.id };
}

test('createOrResumeSession creates new row when no active session exists', async () => {
  const { db, embedId } = await _setup('s1');
  const session = db.createOrResumeSession({
    embedId, visitorUuid: 'v1', visitorMeta: {}, gatewaySessionKey: 'gw-1',
    trafficType: 'production', origin: 'https://x.com',
  });
  assert.ok(session.id);
  assert.strictEqual(session.embedId, embedId);
  assert.strictEqual(session.clearedAt ?? null, null);
});

test('createOrResumeSession resumes existing active session (first session wins)', async () => {
  const { db, embedId } = await _setup('s2');
  const a = db.createOrResumeSession({
    embedId, visitorUuid: 'v2', visitorMeta: {}, gatewaySessionKey: 'gw-2',
    trafficType: 'production', origin: 'https://x.com',
  });
  const b = db.createOrResumeSession({
    embedId, visitorUuid: 'v2', visitorMeta: {}, gatewaySessionKey: 'gw-2-different',
    trafficType: 'production', origin: 'https://x.com',
  });
  assert.strictEqual(a.id, b.id);
  // gateway_session_key NOT overwritten — first session wins until cleared
  assert.strictEqual(b.gatewaySessionKey, 'gw-2');
});

test('clearSession sets cleared_at and allows a new session to be created', async () => {
  const { db, embedId } = await _setup('s3');
  const a = db.createOrResumeSession({
    embedId, visitorUuid: 'v3', visitorMeta: {}, gatewaySessionKey: 'gw-3a',
    trafficType: 'production', origin: 'https://x.com',
  });
  db.clearSession(a.id);
  const b = db.createOrResumeSession({
    embedId, visitorUuid: 'v3', visitorMeta: {}, gatewaySessionKey: 'gw-3b',
    trafficType: 'production', origin: 'https://x.com',
  });
  assert.notStrictEqual(a.id, b.id);
  assert.strictEqual(b.gatewaySessionKey, 'gw-3b');
});

test('bumpSessionActivity updates last_active_at and increments message_count + token_total', async () => {
  const { db, embedId } = await _setup('s4');
  const a = db.createOrResumeSession({
    embedId, visitorUuid: 'v4', visitorMeta: {}, gatewaySessionKey: 'gw-4',
    trafficType: 'production', origin: 'https://x.com',
  });
  await new Promise(r => setTimeout(r, 5));
  db.bumpSessionActivity(a.id, { messageDelta: 1, tokenDelta: 250 });
  const refreshed = db.getSessionById(a.id);
  assert.strictEqual(refreshed.messageCount, 1);
  assert.strictEqual(refreshed.tokenTotal, 250);
  assert.ok(refreshed.lastActiveAt > a.startedAt);
});

test('getEmbedSessionMessages returns empty array stub (Phase 1)', async () => {
  const { db, embedId } = await _setup('s5');
  const a = db.createOrResumeSession({
    embedId, visitorUuid: 'v5', visitorMeta: {}, gatewaySessionKey: 'gw-5',
    trafficType: 'production', origin: 'https://x.com',
  });
  // Phase 1: stub returns [] — Phase 2 wires real transcript fetch
  const msgs = db.getEmbedSessionMessages(a.id, { limit: 20 });
  assert.ok(Array.isArray(msgs));
  assert.strictEqual(msgs.length, 0);
});
