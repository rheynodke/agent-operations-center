// server/lib/embed/rate-limit.test.cjs
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * Set up an isolated in-memory DB for each test, returning both
 * the db module and a fresh rate-limit module instance.
 *
 * Uses AOC_DATA_DIR (not the legacy AOC_DB_PATH) + clears require caches
 * so each test gets a clean DB handle — same pattern as encryption.test.cjs.
 */
function setupDb() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aocdb-rl-'));
  process.env.AOC_DATA_DIR = tmpDir;
  // Clear require cache so each test gets a fresh db instance and rate-limit state
  Object.keys(require.cache).forEach(k => {
    if (
      k.includes('/server/lib/db') ||
      k.includes('/server/lib/embed/rate-limit')
    ) {
      delete require.cache[k];
    }
  });
  const db = require('../db.cjs');
  return { db, tmpDir };
}

// ── Tests that only use in-memory state (no DB needed) ───────────────────────

test('hit increments counter; below limit returns ok', () => {
  const { } = setupDb(); // fresh module via cache clear
  const rl = require('./rate-limit.cjs');
  rl._resetForTests();

  const r1 = rl.hit({ scopeKey: 't:s1', windowMs: 60_000, max: 3 });
  assert.strictEqual(r1.allowed, true);
  assert.strictEqual(r1.count, 1);

  const r2 = rl.hit({ scopeKey: 't:s1', windowMs: 60_000, max: 3 });
  assert.strictEqual(r2.allowed, true);
  assert.strictEqual(r2.count, 2);
});

test('over limit returns allowed=false + retryAfterMs > 0', () => {
  setupDb();
  const rl = require('./rate-limit.cjs');
  rl._resetForTests();

  for (let i = 0; i < 3; i++) rl.hit({ scopeKey: 't:s2', windowMs: 60_000, max: 3 });
  const over = rl.hit({ scopeKey: 't:s2', windowMs: 60_000, max: 3 });
  assert.strictEqual(over.allowed, false);
  assert.ok(over.retryAfterMs > 0, `expected retryAfterMs > 0, got ${over.retryAfterMs}`);
});

test('window slides — counter resets after window expires', async () => {
  setupDb();
  const rl = require('./rate-limit.cjs');
  rl._resetForTests();

  rl.hit({ scopeKey: 't:s3', windowMs: 100, max: 2 });
  rl.hit({ scopeKey: 't:s3', windowMs: 100, max: 2 });

  // Wait for the 100 ms window to expire
  await new Promise(r => setTimeout(r, 110));

  const fresh = rl.hit({ scopeKey: 't:s3', windowMs: 100, max: 2 });
  assert.strictEqual(fresh.allowed, true);
  assert.strictEqual(fresh.count, 1);
});

test('separate scopeKeys have separate counters', () => {
  setupDb();
  const rl = require('./rate-limit.cjs');
  rl._resetForTests();

  rl.hit({ scopeKey: 't:s4-a', windowMs: 60_000, max: 2 });
  rl.hit({ scopeKey: 't:s4-a', windowMs: 60_000, max: 2 });

  const otherScope = rl.hit({ scopeKey: 't:s4-b', windowMs: 60_000, max: 2 });
  assert.strictEqual(otherScope.count, 1);
  assert.strictEqual(otherScope.allowed, true);
});

// ── Tests that require the DB (persistSnapshot / hydrate) ────────────────────

test('persistSnapshot flushes in-memory state to embed_rate_limit_state', async () => {
  const { db } = setupDb();
  await db.initDatabase();

  // Re-require rate-limit after DB is ready
  Object.keys(require.cache).forEach(k => {
    if (k.includes('/server/lib/embed/rate-limit')) delete require.cache[k];
  });
  const rl = require('./rate-limit.cjs');
  rl._resetForTests();

  rl.hit({ scopeKey: 't:s5', windowMs: 60_000, max: 10 });
  rl.persistSnapshot();

  const { getDb } = require('../db/_handle.cjs');
  const sqlDb = getDb();
  const r = sqlDb.exec("SELECT scope_key, count FROM embed_rate_limit_state WHERE scope_key = 't:s5'");
  assert.ok(r.length > 0, 'expected a row in embed_rate_limit_state');
  assert.strictEqual(r[0].values[0][0], 't:s5');
  assert.strictEqual(r[0].values[0][1], 1);
});

test('hydrate loads persisted state into memory', async () => {
  const { db } = setupDb();
  await db.initDatabase();

  Object.keys(require.cache).forEach(k => {
    if (k.includes('/server/lib/embed/rate-limit')) delete require.cache[k];
  });
  const rl = require('./rate-limit.cjs');
  rl._resetForTests();

  // Persist count=1 for 't:s6'
  rl.hit({ scopeKey: 't:s6', windowMs: 60_000, max: 10 });
  rl.persistSnapshot();

  // Clear in-memory state, then hydrate from DB
  rl._resetForTests();
  rl.hydrate();

  // Next hit should see the hydrated count (1) and increment to 2
  const r = rl.hit({ scopeKey: 't:s6', windowMs: 60_000, max: 10 });
  assert.strictEqual(r.count, 2, `expected count=2 after hydrate+hit, got ${r.count}`);
  assert.strictEqual(r.allowed, true);
});
