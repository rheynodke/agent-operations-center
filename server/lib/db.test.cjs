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

test('setUserMasterAgent + getUserMasterAgentId roundtrip', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aocdb-ma1-'));
  process.env.AOC_DATA_DIR = tmpDir;
  delete require.cache[require.resolve('./db.cjs')];
  const db = require('./db.cjs');
  await db.initDatabase();
  const raw = db.getDb();
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('alice', 'x', 'user')");
  // id=1 for first user
  assert.equal(db.getUserMasterAgentId(1), null);
  db.setUserMasterAgent(1, 'alice-master');
  assert.equal(db.getUserMasterAgentId(1), 'alice-master');

  delete process.env.AOC_DATA_DIR;
  delete require.cache[require.resolve('./db.cjs')];
});

test('getUserById exposes master_agent_id', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aocdb-ma2-'));
  process.env.AOC_DATA_DIR = tmpDir;
  delete require.cache[require.resolve('./db.cjs')];
  const db = require('./db.cjs');
  await db.initDatabase();
  const raw = db.getDb();
  raw.run("INSERT INTO users (username, password_hash, role) VALUES ('bob', 'x', 'user')");
  db.setUserMasterAgent(1, 'bob-master');
  const fetched = db.getUserById(1);
  assert.equal(fetched.master_agent_id, 'bob-master');

  delete process.env.AOC_DATA_DIR;
  delete require.cache[require.resolve('./db.cjs')];
});

test('markAgentProfileMaster sets is_master flag', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aocdb-ma3-'));
  process.env.AOC_DATA_DIR = tmpDir;
  delete require.cache[require.resolve('./db.cjs')];
  const db = require('./db.cjs');
  await db.initDatabase();
  db.upsertAgentProfile({ agentId: 'a1', displayName: 'A1', provisionedBy: null });
  db.markAgentProfileMaster('a1');
  const p = db.getAgentProfile('a1');
  assert.equal(p.is_master, 1);

  delete process.env.AOC_DATA_DIR;
  delete require.cache[require.resolve('./db.cjs')];
});

// ─── HQ Room column + index + getHqRoomForUser tests ──────────────────────────

test('mission_rooms gains is_hq, is_system, owner_user_id columns', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-hq-'));
  process.env.AOC_DATA_DIR = tmpDir;
  delete require.cache[require.resolve('./db.cjs')];
  const db = require('./db.cjs');
  await db.initDatabase();
  const raw = db.getDb();
  const cols = raw.exec("PRAGMA table_info(mission_rooms)")[0].values.map(r => r[1]);
  assert.ok(cols.includes('is_hq'),         'missing is_hq column');
  assert.ok(cols.includes('is_system'),     'missing is_system column');
  assert.ok(cols.includes('owner_user_id'), 'missing owner_user_id column');
  delete process.env.AOC_DATA_DIR;
  delete require.cache[require.resolve('./db.cjs')];
});

test('partial unique index prevents two HQ rooms per user', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-hq2-'));
  process.env.AOC_DATA_DIR = tmpDir;
  delete require.cache[require.resolve('./db.cjs')];
  const db = require('./db.cjs');
  await db.initDatabase();
  const raw = db.getDb();
  const now = new Date().toISOString();
  raw.run("INSERT INTO mission_rooms (id, kind, name, member_agent_ids, created_at, updated_at, is_hq, owner_user_id) VALUES ('hq-1', 'global', 'HQ', '[]', ?, ?, 1, 42)", [now, now]);
  let threw = false;
  try {
    raw.run("INSERT INTO mission_rooms (id, kind, name, member_agent_ids, created_at, updated_at, is_hq, owner_user_id) VALUES ('hq-2', 'global', 'HQ', '[]', ?, ?, 1, 42)", [now, now]);
  } catch (_) { threw = true; }
  assert.ok(threw, 'expected unique constraint violation');
  delete process.env.AOC_DATA_DIR;
  delete require.cache[require.resolve('./db.cjs')];
});

test('getHqRoomForUser returns null when no HQ exists', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-hq3-'));
  process.env.AOC_DATA_DIR = tmpDir;
  delete require.cache[require.resolve('./db.cjs')];
  const db = require('./db.cjs');
  await db.initDatabase();
  const result = db.getHqRoomForUser(99);
  assert.equal(result, null);
  delete process.env.AOC_DATA_DIR;
  delete require.cache[require.resolve('./db.cjs')];
});

test('getHqRoomForUser returns the HQ row after inserting one', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-hq4-'));
  process.env.AOC_DATA_DIR = tmpDir;
  delete require.cache[require.resolve('./db.cjs')];
  const db = require('./db.cjs');
  await db.initDatabase();
  const raw = db.getDb();
  const now = new Date().toISOString();
  raw.run("INSERT INTO mission_rooms (id, kind, name, member_agent_ids, created_at, updated_at, is_hq, is_system, owner_user_id) VALUES ('hq-a', 'global', 'HQ', '[]', ?, ?, 1, 1, 7)", [now, now]);
  const result = db.getHqRoomForUser(7);
  assert.ok(result, 'should return the HQ room');
  assert.equal(result.id, 'hq-a');
  assert.equal(result.kind, 'global');
  assert.equal(result.name, 'HQ');
  assert.equal(result.isHq, true, 'isHq should be true');
  assert.equal(result.isSystem, true, 'isSystem should be true');
  assert.equal(result.ownerUserId, 7, 'ownerUserId should be 7');
  delete process.env.AOC_DATA_DIR;
  delete require.cache[require.resolve('./db.cjs')];
});

// === Phase 2 Collaboration Schema Tests (Task 11) ===

test('room_artifacts table has expected columns', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-collab-artifacts-'));
  process.env.AOC_DATA_DIR = tmpDir;
  delete require.cache[require.resolve('./db.cjs')];
  const db = require('./db.cjs');
  await db.initDatabase();
  const raw = db.getDb();

  const result = raw.exec("PRAGMA table_info(room_artifacts)");
  assert.ok(result.length > 0, 'room_artifacts table should exist');
  const cols = result[0].values.map(r => r[1]);

  const expectedCols = ['id', 'room_id', 'category', 'title', 'description', 'tags', 'created_by', 'created_at', 'updated_at', 'pinned', 'archived', 'latest_version_id'];
  for (const col of expectedCols) {
    assert.ok(cols.includes(col), `room_artifacts table missing column: ${col}`);
  }

  delete process.env.AOC_DATA_DIR;
  delete require.cache[require.resolve('./db.cjs')];
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

test('room_artifact_versions table has expected columns', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-collab-versions-'));
  process.env.AOC_DATA_DIR = tmpDir;
  delete require.cache[require.resolve('./db.cjs')];
  const db = require('./db.cjs');
  await db.initDatabase();
  const raw = db.getDb();

  const result = raw.exec("PRAGMA table_info(room_artifact_versions)");
  assert.ok(result.length > 0, 'room_artifact_versions table should exist');
  const cols = result[0].values.map(r => r[1]);

  const expectedCols = ['id', 'artifact_id', 'version_number', 'file_path', 'file_name', 'mime_type', 'size_bytes', 'sha256', 'created_by', 'created_at'];
  for (const col of expectedCols) {
    assert.ok(cols.includes(col), `room_artifact_versions table missing column: ${col}`);
  }

  delete process.env.AOC_DATA_DIR;
  delete require.cache[require.resolve('./db.cjs')];
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

test('room_collaboration_sessions table has expected columns', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-collab-sessions-'));
  process.env.AOC_DATA_DIR = tmpDir;
  delete require.cache[require.resolve('./db.cjs')];
  const db = require('./db.cjs');
  await db.initDatabase();
  const raw = db.getDb();

  const result = raw.exec("PRAGMA table_info(room_collaboration_sessions)");
  assert.ok(result.length > 0, 'room_collaboration_sessions table should exist');
  const cols = result[0].values.map(r => r[1]);

  const expectedCols = ['id', 'room_id', 'session_key', 'agent_id', 'started_by', 'started_at', 'ended_at'];
  for (const col of expectedCols) {
    assert.ok(cols.includes(col), `room_collaboration_sessions table missing column: ${col}`);
  }

  delete process.env.AOC_DATA_DIR;
  delete require.cache[require.resolve('./db.cjs')];
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

test('mission_rooms has supports_collab column', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-collab-rooms-'));
  process.env.AOC_DATA_DIR = tmpDir;
  delete require.cache[require.resolve('./db.cjs')];
  const db = require('./db.cjs');
  await db.initDatabase();
  const raw = db.getDb();

  const result = raw.exec("PRAGMA table_info(mission_rooms)");
  assert.ok(result.length > 0, 'mission_rooms table should exist');
  const cols = result[0].values.map(r => r[1]);

  assert.ok(cols.includes('supports_collab'), 'mission_rooms table missing column: supports_collab');

  delete process.env.AOC_DATA_DIR;
  delete require.cache[require.resolve('./db.cjs')];
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

test('room_artifact_versions unique index prevents duplicate version numbers per artifact', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-collab-unique-'));
  process.env.AOC_DATA_DIR = tmpDir;
  delete require.cache[require.resolve('./db.cjs')];
  const db = require('./db.cjs');
  await db.initDatabase();
  const raw = db.getDb();
  const now = new Date().toISOString();

  raw.run("INSERT INTO mission_rooms (id, kind, name, member_agent_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
          ['room-test', 'global', 'Test Room', '[]', now, now]);

  raw.run("INSERT INTO room_artifacts (id, room_id, category, title, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          ['artifact-1', 'room-test', 'outputs', 'My Output', 'agent-1', now, now]);

  // First version insert — must succeed
  raw.run("INSERT INTO room_artifact_versions (id, artifact_id, version_number, file_path, file_name, sha256, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          ['version-1', 'artifact-1', 1, '/path/to/file1.md', 'file1.md', 'abc123', 'agent-1', now]);

  // Duplicate version_number on same artifact — must throw
  let threw = false;
  try {
    raw.run("INSERT INTO room_artifact_versions (id, artifact_id, version_number, file_path, file_name, sha256, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            ['version-2', 'artifact-1', 1, '/path/to/file2.md', 'file2.md', 'def456', 'agent-1', now]);
  } catch (_) { threw = true; }

  assert.ok(threw, 'expected unique constraint violation on duplicate artifact_id + version_number');

  delete process.env.AOC_DATA_DIR;
  delete require.cache[require.resolve('./db.cjs')];
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});
