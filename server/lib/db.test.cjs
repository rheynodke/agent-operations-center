'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

test('schema includes multi-tenant columns on users + agent_profiles', async () => {
  // db.cjs uses AOC_DATA_DIR to derive DB_PATH (DATA_DIR/aoc.db)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aocdb-'));
  process.env.AOC_DATA_DIR = tmpDir;

  // Clear module cache so db.cjs re-initialises with the temp path
  delete require.cache[require.resolve('./db.cjs')];
  const db = require('./db.cjs');

  // Run init (async)
  await db.initDatabase();

  // Access raw sql.js Database via the exported getDb() accessor
  const raw = db.getDb();

  // Verify users columns
  const userCols = raw.exec("PRAGMA table_info('users')")[0].values.map(r => r[1]);
  for (const col of [
    'master_agent_id',
    'gateway_port',
    'gateway_pid',
    'gateway_state',
    'daily_token_quota',
    'daily_token_used',
    'daily_token_reset_at',
    'last_activity_at',
  ]) {
    assert.ok(userCols.includes(col), `users table missing column: ${col}`);
  }

  // Verify agent_profiles columns
  const agentCols = raw.exec("PRAGMA table_info('agent_profiles')")[0].values.map(r => r[1]);
  assert.ok(agentCols.includes('is_master'), 'agent_profiles table missing column: is_master');

  // Cleanup
  delete process.env.AOC_DATA_DIR;
  delete require.cache[require.resolve('./db.cjs')];
});

test('backfill assigns NULL ownership rows to admin user 1', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aocdb-bf-'));
  process.env.AOC_DATA_DIR = tmpDir;
  delete require.cache[require.resolve('./db.cjs')];
  delete require.cache[require.resolve('./migrations/2026-05-04-multitenant.cjs')];
  const db = require('./db.cjs');
  await db.initDatabase();
  const raw = db.getDb();

  // Seed an admin user (initDatabase creates no users, so this is id=1).
  raw.run("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
          ['admin', 'x', 'admin']);

  // Seed an orphan project (no created_by). projects requires id, name, color, created_at, updated_at.
  raw.run(
    "INSERT INTO projects (id, name, color, created_at, updated_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))",
    ['p_orphan', 'Orphan', '#6366f1']
  );

  const migration = require('./migrations/2026-05-04-multitenant.cjs');
  const result = migration.run(raw);
  assert.equal(result.adminId, 1);

  const ownerRes = raw.exec("SELECT created_by FROM projects WHERE id = 'p_orphan'");
  const owner = ownerRes[0].values[0][0];
  assert.equal(owner, 1);

  delete process.env.AOC_DATA_DIR;
  delete require.cache[require.resolve('./db.cjs')];
  delete require.cache[require.resolve('./migrations/2026-05-04-multitenant.cjs')];
});

test('scopeByOwner: admin without scope → no filter', () => {
  const db = require('./db.cjs');
  const r = db.scopeByOwner({ id: 1, role: 'admin' }, 'created_by', null);
  assert.equal(r.where, '');
  assert.deepEqual(r.params, []);
});

test('scopeByOwner: admin scope=me → filter to admin id', () => {
  const db = require('./db.cjs');
  const r = db.scopeByOwner({ id: 1, role: 'admin' }, 'created_by', 'me');
  assert.equal(r.where, 'created_by = ?');
  assert.deepEqual(r.params, [1]);
});

test('scopeByOwner: admin scope=<numeric id> → filter to that id', () => {
  const db = require('./db.cjs');
  const r = db.scopeByOwner({ id: 1, role: 'admin' }, 'created_by', 7);
  assert.equal(r.where, 'created_by = ?');
  assert.deepEqual(r.params, [7]);
});

test('scopeByOwner: non-admin always filters to own id regardless of scope', () => {
  const db = require('./db.cjs');
  for (const scope of [null, 'me', 'all', 99]) {
    const r = db.scopeByOwner({ id: 5, role: 'user' }, 'created_by', scope);
    assert.equal(r.where, 'created_by = ?');
    assert.deepEqual(r.params, [5]);
  }
});

test('scopeByOwner: missing user → blocking filter (1=0)', () => {
  const db = require('./db.cjs');
  const r = db.scopeByOwner(null, 'created_by', 'all');
  assert.equal(r.where, '1 = 0');
});

test('setGatewayState + getGatewayState: persist and retrieve gateway lifecycle data', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aocdb-gw-'));
  process.env.AOC_DATA_DIR = tmpDir;
  delete require.cache[require.resolve('./db.cjs')];
  const db = require('./db.cjs');
  await db.initDatabase();
  const raw = db.getDb();
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('admin', 'x', 'admin')");
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('user2', 'x', 'user')");

  // Initial state — no gateway info
  assert.deepEqual(db.getGatewayState(2), { port: null, pid: null, state: null });

  // Set running state
  db.setGatewayState(2, { port: 19002, pid: 12345, state: 'running' });
  assert.deepEqual(db.getGatewayState(2), { port: 19002, pid: 12345, state: 'running' });

  // Update to error
  db.setGatewayState(2, { port: null, pid: null, state: 'error' });
  assert.deepEqual(db.getGatewayState(2), { port: null, pid: null, state: 'error' });

  delete process.env.AOC_DATA_DIR;
  delete require.cache[require.resolve('./db.cjs')];
});

test('listGatewayStates: returns all users with non-null gateway_pid', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aocdb-gwl-'));
  process.env.AOC_DATA_DIR = tmpDir;
  delete require.cache[require.resolve('./db.cjs')];
  const db = require('./db.cjs');
  await db.initDatabase();
  const raw = db.getDb();
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('admin', 'x', 'admin')");
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('u2', 'x', 'user')");
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('u3', 'x', 'user')");

  db.setGatewayState(2, { port: 19002, pid: 11111, state: 'running' });
  db.setGatewayState(3, { port: 19003, pid: 22222, state: 'running' });

  const all = db.listGatewayStates();
  assert.equal(all.length, 2);
  const byUser = Object.fromEntries(all.map(r => [r.userId, r]));
  assert.equal(byUser[2].port, 19002);
  assert.equal(byUser[3].pid, 22222);

  delete process.env.AOC_DATA_DIR;
  delete require.cache[require.resolve('./db.cjs')];
});

test('clearAllGatewayStates: resets gateway columns to NULL for every user', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aocdb-gwc-'));
  process.env.AOC_DATA_DIR = tmpDir;
  delete require.cache[require.resolve('./db.cjs')];
  const db = require('./db.cjs');
  await db.initDatabase();
  const raw = db.getDb();
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('admin', 'x', 'admin')");
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('u2', 'x', 'user')");
  db.setGatewayState(2, { port: 19002, pid: 11111, state: 'running' });

  db.clearAllGatewayStates();

  assert.deepEqual(db.getGatewayState(2), { port: null, pid: null, state: null });
  assert.deepEqual(db.listGatewayStates(), []);

  delete process.env.AOC_DATA_DIR;
  delete require.cache[require.resolve('./db.cjs')];
});
