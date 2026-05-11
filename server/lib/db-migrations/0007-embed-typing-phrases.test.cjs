// server/lib/db-migrations/0007-embed-typing-phrases.test.cjs
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * Set up an isolated DB environment for the migration test.
 * Uses the same AOC_DATA_DIR + require-cache-clear pattern as other db tests.
 */
function setupDb() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aocdb-0007-'));
  process.env.AOC_DATA_DIR = tmpDir;
  // Clear require cache so each test gets a fresh DB instance
  Object.keys(require.cache).forEach(k => {
    if (k.includes('/server/lib/db')) {
      delete require.cache[k];
    }
  });
  const db = require('../db.cjs');
  return { db, tmpDir };
}

test('migration 0007: agent_embeds has typing_phrases column', async () => {
  const { db, tmpDir } = setupDb();
  try {
    await db.initDatabase();

    const { getDb } = require('../db/_handle.cjs');
    const sqlDb = getDb();

    // PRAGMA table_info returns rows: [cid, name, type, notnull, dflt_value, pk]
    const result = sqlDb.exec("PRAGMA table_info('agent_embeds')");
    assert.ok(result.length > 0, 'agent_embeds table should exist');

    const columns = result[0].values.map(r => r[1]);
    assert.ok(
      columns.includes('typing_phrases'),
      `expected agent_embeds to have column 'typing_phrases', found: ${columns.join(', ')}`
    );
  } finally {
    // Cleanup
    delete process.env.AOC_DATA_DIR;
    Object.keys(require.cache).forEach(k => {
      if (k.includes('/server/lib/db')) delete require.cache[k];
    });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('migration 0007: typing_phrases defaults to NULL on insert', async () => {
  const { db, tmpDir } = setupDb();
  try {
    await db.initDatabase();

    const { getDb } = require('../db/_handle.cjs');
    const sqlDb = getDb();

    const now = Date.now();
    // Insert a minimal agent_embeds row (all NOT NULL columns, no typing_phrases)
    sqlDb.run(`
      INSERT INTO agent_embeds (
        id, agent_id, owner_id, mode, embed_token,
        production_origin, brand_name, welcome_title,
        dlp_preset, created_at, updated_at
      ) VALUES (
        'test-embed-0007', 'agent-x', 1, 'public', 'tok-abc123',
        'https://example.com', 'Test Brand', 'Hello!',
        'standard', ${now}, ${now}
      )
    `);

    const row = sqlDb.exec(
      "SELECT typing_phrases FROM agent_embeds WHERE id = 'test-embed-0007'"
    );
    assert.ok(row.length > 0, 'should return at least one row');
    const typingPhrasesValue = row[0].values[0][0];
    assert.strictEqual(
      typingPhrasesValue,
      null,
      `expected typing_phrases to default to NULL, got: ${JSON.stringify(typingPhrasesValue)}`
    );
  } finally {
    delete process.env.AOC_DATA_DIR;
    Object.keys(require.cache).forEach(k => {
      if (k.includes('/server/lib/db')) delete require.cache[k];
    });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('migration 0007: is idempotent — running up() twice does not throw', async () => {
  const { db, tmpDir } = setupDb();
  try {
    await db.initDatabase();

    const { getDb } = require('../db/_handle.cjs');
    const sqlDb = getDb();

    // Directly call the migration's up() a second time — should not throw
    const migration = require('./0007-embed-typing-phrases.cjs');
    assert.doesNotThrow(() => migration.up(sqlDb), 'second call to up() should be idempotent');
  } finally {
    delete process.env.AOC_DATA_DIR;
    Object.keys(require.cache).forEach(k => {
      if (k.includes('/server/lib/db')) delete require.cache[k];
    });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
