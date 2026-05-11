// server/lib/embed/encryption.test.cjs
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Set master key BEFORE any require of encryption.cjs
process.env.AOC_DLP_MASTER_KEY = crypto.randomBytes(32).toString('hex');

/**
 * Set up an isolated in-memory DB for each test, returning both
 * the db module and the encryption module with fresh require caches.
 */
function setupDb() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aocdb-encrypt-'));
  process.env.AOC_DATA_DIR = tmpDir;
  // Clear require cache so each test gets a fresh db instance
  Object.keys(require.cache).forEach(k => {
    if (k.includes('/server/lib/db') || k.includes('/server/lib/embed/encryption')) {
      delete require.cache[k];
    }
  });
  const db = require('../db.cjs');
  return { db, tmpDir };
}

/**
 * Create a minimal user row in the DB so getUserById can find it.
 */
async function seedUser(db, id) {
  await db.initDatabase();
  // Insert a minimal user via raw SQL (avoids hashing overhead)
  const { getDb } = require('../db/_handle.cjs');
  const sqlDb = getDb();
  sqlDb.run(
    'INSERT OR IGNORE INTO users (id, username, display_name, password_hash, role) VALUES (?, ?, ?, ?, ?)',
    [id, `user${id}`, `User ${id}`, 'x', 'user']
  );
}

test('getOrCreateOwnerKey returns 64 hex chars (32 bytes)', async () => {
  const { db } = setupDb();
  await seedUser(db, 1);

  // Reload encryption after fresh DB
  Object.keys(require.cache).forEach(k => {
    if (k.includes('/server/lib/embed/encryption')) delete require.cache[k];
  });
  const enc = require('./encryption.cjs');
  enc._resetMasterKeyCacheForTests();

  const k1 = enc.getOrCreateOwnerKey(1);
  assert.strictEqual(typeof k1, 'string');
  assert.strictEqual(k1.length, 64);
  assert.match(k1, /^[0-9a-f]+$/);
});

test('getOrCreateOwnerKey is stable for same owner', async () => {
  const { db } = setupDb();
  await seedUser(db, 2);

  Object.keys(require.cache).forEach(k => {
    if (k.includes('/server/lib/embed/encryption')) delete require.cache[k];
  });
  const enc = require('./encryption.cjs');
  enc._resetMasterKeyCacheForTests();

  const a = enc.getOrCreateOwnerKey(2);
  const b = enc.getOrCreateOwnerKey(2);
  assert.strictEqual(a, b);
});

test('different owners get different keys', async () => {
  const { db } = setupDb();
  await seedUser(db, 3);
  await seedUser(db, 4);

  Object.keys(require.cache).forEach(k => {
    if (k.includes('/server/lib/embed/encryption')) delete require.cache[k];
  });
  const enc = require('./encryption.cjs');
  enc._resetMasterKeyCacheForTests();

  const a = enc.getOrCreateOwnerKey(3);
  const b = enc.getOrCreateOwnerKey(4);
  assert.notStrictEqual(a, b);
});

test('encryptForOwner + decryptForOwner round-trip', async () => {
  const { db } = setupDb();
  await seedUser(db, 5);

  Object.keys(require.cache).forEach(k => {
    if (k.includes('/server/lib/embed/encryption')) delete require.cache[k];
  });
  const enc = require('./encryption.cjs');
  enc._resetMasterKeyCacheForTests();

  const plain = 'sk-secret-foo-bar-12345';
  const cipher = enc.encryptForOwner(5, plain);
  assert.notStrictEqual(cipher, plain);
  // iv:tag:ciphertext — at least two colons
  assert.ok(cipher.includes(':'), 'expected format iv:tag:ciphertext');
  assert.strictEqual(cipher.split(':').length, 3);
  const back = enc.decryptForOwner(5, cipher);
  assert.strictEqual(back, plain);
});

test('decrypt with wrong owner throws', async () => {
  const { db } = setupDb();
  await seedUser(db, 6);
  await seedUser(db, 7);

  Object.keys(require.cache).forEach(k => {
    if (k.includes('/server/lib/embed/encryption')) delete require.cache[k];
  });
  const enc = require('./encryption.cjs');
  enc._resetMasterKeyCacheForTests();

  enc.getOrCreateOwnerKey(6);
  enc.getOrCreateOwnerKey(7);
  const cipher = enc.encryptForOwner(6, 'hello');
  assert.throws(() => enc.decryptForOwner(7, cipher));
});

test('encrypted output is different each call (random IV)', async () => {
  const { db } = setupDb();
  await seedUser(db, 8);

  Object.keys(require.cache).forEach(k => {
    if (k.includes('/server/lib/embed/encryption')) delete require.cache[k];
  });
  const enc = require('./encryption.cjs');
  enc._resetMasterKeyCacheForTests();

  const a = enc.encryptForOwner(8, 'same plain');
  const b = enc.encryptForOwner(8, 'same plain');
  assert.notStrictEqual(a, b);
});

test('throws if AOC_DLP_MASTER_KEY missing', async () => {
  const { db } = setupDb();
  await seedUser(db, 99);

  Object.keys(require.cache).forEach(k => {
    if (k.includes('/server/lib/embed/encryption')) delete require.cache[k];
  });
  const enc = require('./encryption.cjs');

  const orig = process.env.AOC_DLP_MASTER_KEY;
  delete process.env.AOC_DLP_MASTER_KEY;
  enc._resetMasterKeyCacheForTests();

  assert.throws(() => enc.getOrCreateOwnerKey(99), /AOC_DLP_MASTER_KEY/);

  // Restore for subsequent tests
  process.env.AOC_DLP_MASTER_KEY = orig;
  enc._resetMasterKeyCacheForTests();
});
