// server/lib/db/embeds.test.cjs
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Use isolated test DB per satisfaction.test.cjs pattern
function setupDb() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aocdb-embeds-'));
  process.env.AOC_DATA_DIR = tmpDir;
  // Clear require cache so each test gets a fresh db instance
  Object.keys(require.cache).forEach(k => {
    if (k.includes('/server/lib/db')) delete require.cache[k];
  });
  const db = require('../db.cjs');
  return { db, tmpDir };
}

// Helper: create a user and return its integer id.
// createUser takes { username, password, displayName, role } and returns the user object.
function makeUser(db, suffix) {
  const user = db.createUser({ username: `test-${suffix}`, password: 'password123', role: 'admin' });
  return user.id;
}

test('createEmbed inserts row + generates token + signing_secret for private', async () => {
  const { db } = setupDb();
  await db.initDatabase();

  const userId = makeUser(db, 'priv1');
  const agentId = 'agent-' + Date.now();
  db.upsertAgentProfile({
    agentId, role: 'main', provisionedBy: userId,
    avatarPresetId: '1', color: '#000',
  });

  const embed = db.createEmbed({
    agentId,
    ownerId: userId,
    mode: 'private',
    productionOrigin: 'https://example.com',
    brandName: 'Test Brand',
    welcomeTitle: 'Halo',
    dlpPreset: 'internal-tool-default',
  });

  assert.ok(embed.id);
  assert.ok(embed.embedToken);
  assert.ok(embed.embedToken.length >= 32);
  assert.ok(embed.signingSecret);  // private mode
  assert.strictEqual(embed.mode, 'private');
});

test('createEmbed for public mode does not generate signing_secret', async () => {
  const { db } = setupDb();
  await db.initDatabase();

  const userId = makeUser(db, 'pub1');
  const agentId = 'agent-pub-' + Date.now();
  db.upsertAgentProfile({ agentId, role: 'main', provisionedBy: userId, avatarPresetId: '1', color: '#000' });

  const embed = db.createEmbed({
    agentId,
    ownerId: userId,
    mode: 'public',
    productionOrigin: 'https://customer.example.com',
    brandName: 'Public Brand',
    welcomeTitle: 'Hi',
    dlpPreset: 'customer-service-default',
  });

  assert.strictEqual(embed.signingSecret, null);
});

test('getEmbedById returns parsed row', async () => {
  const { db } = setupDb();
  await db.initDatabase();

  const userId = makeUser(db, 'getbyid1');
  const agentId = 'agent-get-' + Date.now();
  db.upsertAgentProfile({ agentId, role: 'main', provisionedBy: userId, avatarPresetId: '1', color: '#000' });

  const created = db.createEmbed({
    agentId, ownerId: userId, mode: 'private',
    productionOrigin: 'https://x.com', brandName: 'X',
    welcomeTitle: 'X', dlpPreset: 'internal-tool-default',
  });

  const fetched = db.getEmbedById(created.id);
  assert.strictEqual(fetched.id, created.id);
  assert.deepStrictEqual(fetched.devOrigins, []);
  assert.deepStrictEqual(fetched.quickReplies, []);
});

test('getEmbedByToken finds embed by embed_token', async () => {
  const { db } = setupDb();
  await db.initDatabase();

  const userId = makeUser(db, 'gettok1');
  const agentId = 'agent-tok-' + Date.now();
  db.upsertAgentProfile({ agentId, role: 'main', provisionedBy: userId, avatarPresetId: '1', color: '#000' });

  const created = db.createEmbed({
    agentId, ownerId: userId, mode: 'private',
    productionOrigin: 'https://x.com', brandName: 'X',
    welcomeTitle: 'X', dlpPreset: 'internal-tool-default',
  });

  const fetched = db.getEmbedByToken(created.embedToken);
  assert.strictEqual(fetched.id, created.id);
});

test('listEmbedsForOwner filters by owner_id', async () => {
  const { db } = setupDb();
  await db.initDatabase();

  const u1 = makeUser(db, 'list1');
  const u2 = makeUser(db, 'list2');
  db.upsertAgentProfile({ agentId: 'a-l1', role: 'main', provisionedBy: u1, avatarPresetId: '1', color: '#000' });
  db.upsertAgentProfile({ agentId: 'a-l2', role: 'main', provisionedBy: u2, avatarPresetId: '1', color: '#000' });

  db.createEmbed({ agentId: 'a-l1', ownerId: u1, mode: 'private', productionOrigin: 'https://1.com', brandName: '1', welcomeTitle: '1', dlpPreset: 'internal-tool-default' });
  db.createEmbed({ agentId: 'a-l2', ownerId: u2, mode: 'private', productionOrigin: 'https://2.com', brandName: '2', welcomeTitle: '2', dlpPreset: 'internal-tool-default' });

  const u1Embeds = db.listEmbedsForOwner(u1);
  assert.strictEqual(u1Embeds.length, 1);
  assert.strictEqual(u1Embeds[0].ownerId, u1);
});

test('updateEmbed merges fields + updates updated_at', async () => {
  const { db } = setupDb();
  await db.initDatabase();

  const userId = makeUser(db, 'upd1');
  db.upsertAgentProfile({ agentId: 'a-upd', role: 'main', provisionedBy: userId, avatarPresetId: '1', color: '#000' });

  const created = db.createEmbed({
    agentId: 'a-upd', ownerId: userId, mode: 'private',
    productionOrigin: 'https://x.com', brandName: 'X',
    welcomeTitle: 'X', dlpPreset: 'internal-tool-default',
  });

  await new Promise(r => setTimeout(r, 5));
  const updated = db.updateEmbed(created.id, { brandName: 'Y', enabled: 0 });
  assert.strictEqual(updated.brandName, 'Y');
  assert.strictEqual(updated.enabled, 0);
  assert.ok(updated.updatedAt > created.updatedAt);
});

test('deleteEmbed removes row', async () => {
  const { db } = setupDb();
  await db.initDatabase();

  const userId = makeUser(db, 'del1');
  db.upsertAgentProfile({ agentId: 'a-del', role: 'main', provisionedBy: userId, avatarPresetId: '1', color: '#000' });

  const created = db.createEmbed({
    agentId: 'a-del', ownerId: userId, mode: 'private',
    productionOrigin: 'https://x.com', brandName: 'X',
    welcomeTitle: 'X', dlpPreset: 'internal-tool-default',
  });

  db.deleteEmbed(created.id);
  assert.strictEqual(db.getEmbedById(created.id), null);
});

// ─── typingPhrases round-trip tests ──────────────────────────────────────────

test('createEmbed: typingPhrases defaults to null', async () => {
  const { db } = setupDb();
  await db.initDatabase();

  const userId = makeUser(db, 'tp1');
  db.upsertAgentProfile({ agentId: 'a-tp1', role: 'main', provisionedBy: userId, avatarPresetId: '1', color: '#000' });

  const created = db.createEmbed({
    agentId: 'a-tp1', ownerId: userId, mode: 'private',
    productionOrigin: 'https://x.com', brandName: 'X',
    welcomeTitle: 'X', dlpPreset: 'internal-tool-default',
  });

  assert.strictEqual(created.typingPhrases, null, 'typingPhrases should be null by default');
});

test('updateEmbed: typingPhrases array roundtrips preserving order', async () => {
  const { db } = setupDb();
  await db.initDatabase();

  const userId = makeUser(db, 'tp2');
  db.upsertAgentProfile({ agentId: 'a-tp2', role: 'main', provisionedBy: userId, avatarPresetId: '1', color: '#000' });

  const created = db.createEmbed({
    agentId: 'a-tp2', ownerId: userId, mode: 'private',
    productionOrigin: 'https://x.com', brandName: 'X',
    welcomeTitle: 'X', dlpPreset: 'internal-tool-default',
  });

  const phrases = ['Halo', 'Sebentar', 'Mengetik...'];
  const updated = db.updateEmbed(created.id, { typingPhrases: phrases });
  assert.deepStrictEqual(updated.typingPhrases, phrases, 'typingPhrases should roundtrip in same order');

  // Also verify via getEmbedById
  const fetched = db.getEmbedById(created.id);
  assert.deepStrictEqual(fetched.typingPhrases, phrases, 'getEmbedById should also return correct typingPhrases');
});

test('updateEmbed: typingPhrases empty array [] roundtrips as [] NOT null', async () => {
  const { db } = setupDb();
  await db.initDatabase();

  const userId = makeUser(db, 'tp3');
  db.upsertAgentProfile({ agentId: 'a-tp3', role: 'main', provisionedBy: userId, avatarPresetId: '1', color: '#000' });

  const created = db.createEmbed({
    agentId: 'a-tp3', ownerId: userId, mode: 'private',
    productionOrigin: 'https://x.com', brandName: 'X',
    welcomeTitle: 'X', dlpPreset: 'internal-tool-default',
  });

  const updated = db.updateEmbed(created.id, { typingPhrases: [] });
  assert.deepStrictEqual(updated.typingPhrases, [], 'empty array should roundtrip as [] not null');
  assert.notStrictEqual(updated.typingPhrases, null, 'empty array must NOT be null');
});

test('updateEmbed: typingPhrases null roundtrips as null', async () => {
  const { db } = setupDb();
  await db.initDatabase();

  const userId = makeUser(db, 'tp4');
  db.upsertAgentProfile({ agentId: 'a-tp4', role: 'main', provisionedBy: userId, avatarPresetId: '1', color: '#000' });

  const created = db.createEmbed({
    agentId: 'a-tp4', ownerId: userId, mode: 'private',
    productionOrigin: 'https://x.com', brandName: 'X',
    welcomeTitle: 'X', dlpPreset: 'internal-tool-default',
  });

  // First set to a value, then update back to null
  db.updateEmbed(created.id, { typingPhrases: ['Halo'] });
  const updated = db.updateEmbed(created.id, { typingPhrases: null });
  assert.strictEqual(updated.typingPhrases, null, 'null should roundtrip as null');
});
