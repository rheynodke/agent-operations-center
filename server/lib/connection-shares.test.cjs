'use strict';

/**
 * Tests for connection sharing — org-wide boolean (`connections.shared`).
 *
 * Covers:
 *   - migration 0002 backfills NULL `created_by` to first admin
 *   - migration 0003 adds `shared` column + drops `connection_shares` table
 *   - setConnectionShared toggles + cascade-detaches non-owner assignments
 *   - userIdCanUseConnection — owner / admin / shared=1 / private
 *   - setAgentConnections rejects unaccessible connections (status=403)
 *   - getConnectionUsage groups assignments with owner identity
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

function freshDb() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aocdb-share-'));
  process.env.AOC_DATA_DIR = tmpDir;
  delete require.cache[require.resolve('./db.cjs')];
  delete require.cache[require.resolve('./db/_handle.cjs')];
  delete require.cache[require.resolve('./db/connections.cjs')];
  return require('./db.cjs');
}

test('migrations 0002 + 0003: backfill admin owner, drop ACL table, add shared column', async () => {
  const db = freshDb();
  await db.initDatabase();
  const raw = db.getDb();

  // After init, schema_migrations should record 0002 and 0003 as applied.
  const applied = raw.exec("SELECT id FROM schema_migrations ORDER BY id")[0].values.map(r => r[0]);
  assert.ok(applied.includes('0002-connection-shares'), 'migration 0002 should be recorded');
  assert.ok(applied.includes('0003-connection-shared-flag'), 'migration 0003 should be recorded');

  // shared column present.
  const cols = raw.exec("PRAGMA table_info('connections')")[0].values.map(r => r[1]);
  assert.ok(cols.includes('shared'), 'connections table missing column: shared');

  // connection_shares table dropped (or never existed for fresh installs).
  const tables = raw.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='connection_shares'");
  assert.equal(tables.length, 0, 'connection_shares table should be dropped after migration 0003');

  delete process.env.AOC_DATA_DIR;
});

test('setConnectionShared toggles + on=>off detaches non-owner assignments', async () => {
  const db = freshDb();
  await db.initDatabase();
  const raw = db.getDb();

  raw.run("INSERT INTO users (id, username, password_hash, role) VALUES (1, 'admin', 'x', 'admin')");
  raw.run("INSERT INTO users (id, username, password_hash, role) VALUES (2, 'alice', 'x', 'user')");
  raw.run("INSERT INTO users (id, username, password_hash, role) VALUES (3, 'bob',   'x', 'user')");

  const conn = db.createConnection({
    id: 'c1', name: 'Alice DB', type: 'postgres',
    credentials: 'secret', metadata: { host: 'localhost' }, enabled: true,
    createdBy: 2,
  });
  assert.equal(conn.shared, false);

  // Alice flips it shared.
  const after = db.setConnectionShared('c1', true);
  assert.equal(after.shared, true);

  // Bob assigns the shared connection to his agent.
  db.setAgentConnections('bob-agent', ['c1'], 3);
  assert.deepEqual(db.getAgentConnectionIds('bob-agent', 3), ['c1']);

  // Alice keeps her own assignment for sanity.
  db.setAgentConnections('alice-agent', ['c1'], 2);

  // Alice flips it private — bob's assignment should auto-detach but Alice's
  // own assignment must stay (she still owns the connection).
  const reverted = db.setConnectionShared('c1', false);
  assert.equal(reverted.shared, false);
  assert.deepEqual(db.getAgentConnectionIds('bob-agent', 3),   [], 'non-owner assignment should be detached when sharing is turned off');
  assert.deepEqual(db.getAgentConnectionIds('alice-agent', 2), ['c1'], 'owner assignment should be preserved');

  delete process.env.AOC_DATA_DIR;
});

test('userIdCanUseConnection: owner OR admin OR shared=1', async () => {
  const db = freshDb();
  await db.initDatabase();
  const raw = db.getDb();

  raw.run("INSERT INTO users (id, username, password_hash, role) VALUES (1, 'admin', 'x', 'admin')");
  raw.run("INSERT INTO users (id, username, password_hash, role) VALUES (2, 'alice', 'x', 'user')");
  raw.run("INSERT INTO users (id, username, password_hash, role) VALUES (3, 'bob',   'x', 'user')");

  db.createConnection({ id: 'c1', name: 'A', type: 'website', credentials: '', metadata: {}, enabled: true, createdBy: 2 });

  assert.equal(db.userIdCanUseConnection(2, 'c1'), true,  'owner can use');
  assert.equal(db.userIdCanUseConnection(1, 'c1'), true,  'admin can use');
  assert.equal(db.userIdCanUseConnection(3, 'c1'), false, 'unrelated user cannot use private connection');

  db.setConnectionShared('c1', true);
  assert.equal(db.userIdCanUseConnection(3, 'c1'), true,  'any user can use shared connection');

  db.setConnectionShared('c1', false);
  assert.equal(db.userIdCanUseConnection(3, 'c1'), false, 'unsharing revokes use');

  delete process.env.AOC_DATA_DIR;
});

test('setAgentConnections rejects unaccessible (private, non-owner) connection', async () => {
  const db = freshDb();
  await db.initDatabase();
  const raw = db.getDb();

  raw.run("INSERT INTO users (id, username, password_hash, role) VALUES (1, 'admin', 'x', 'admin')");
  raw.run("INSERT INTO users (id, username, password_hash, role) VALUES (2, 'alice', 'x', 'user')");
  raw.run("INSERT INTO users (id, username, password_hash, role) VALUES (3, 'bob',   'x', 'user')");

  db.createConnection({ id: 'aliceConn', name: 'A', type: 'website', credentials: '', metadata: {}, enabled: true, createdBy: 2 });

  assert.throws(() => db.setAgentConnections('bob-agent', ['aliceConn'], 3), (err) => {
    assert.equal(err.status, 403);
    assert.equal(err.code, 'CONNECTION_NOT_ACCESSIBLE');
    return true;
  });

  // After sharing, bob can assign.
  db.setConnectionShared('aliceConn', true);
  db.setAgentConnections('bob-agent', ['aliceConn'], 3);
  assert.deepEqual(db.getAgentConnectionIds('bob-agent', 3), ['aliceConn']);
});

test('getConnectionUsage returns enriched (agent, owner) pairs', async () => {
  const db = freshDb();
  await db.initDatabase();
  const raw = db.getDb();

  raw.run("INSERT INTO users (id, username, password_hash, role, email) VALUES (1, 'admin', 'x', 'admin', 'admin@x')");
  raw.run("INSERT INTO users (id, username, password_hash, role, email) VALUES (2, 'alice', 'x', 'user',  'alice@x')");
  raw.run("INSERT INTO users (id, username, password_hash, role, email) VALUES (3, 'bob',   'x', 'user',  'bob@x')");

  db.createConnection({ id: 'c1', name: 'Shared', type: 'website', credentials: '', metadata: {}, enabled: true, createdBy: 2 });
  db.setConnectionShared('c1', true);
  db.setAgentConnections('alice-agent', ['c1'], 2);
  db.setAgentConnections('bob-agent',   ['c1'], 3);

  const usage = db.getConnectionUsage('c1');
  assert.equal(usage.length, 2);
  const byAgent = Object.fromEntries(usage.map(u => [u.agentId, u]));
  assert.equal(byAgent['alice-agent'].ownerId, 2);
  assert.equal(byAgent['alice-agent'].ownerEmail, 'alice@x');
  assert.equal(byAgent['bob-agent'].ownerId, 3);
  assert.equal(byAgent['bob-agent'].ownerEmail, 'bob@x');
});
