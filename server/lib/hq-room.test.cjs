'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

async function setupDb() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-hq-'));
  process.env.AOC_DATA_DIR = tmpDir;
  delete require.cache[require.resolve('./db.cjs')];
  delete require.cache[require.resolve('./hq-room.cjs')];
  const db = require('./db.cjs');
  await db.initDatabase();
  // Seed user 42 with master-1 via raw sql.js db
  const raw = db.getDb();
  raw.run("INSERT OR IGNORE INTO users (id, username, password_hash, role, created_at) VALUES (42, 'testuser', 'x', 'user', '2026-01-01')");
  raw.run("UPDATE users SET master_agent_id = 'master-1' WHERE id = 42");
  raw.run("INSERT OR IGNORE INTO agent_profiles (agent_id, provisioned_by) VALUES ('master-1', 42)");
  if (db.markAgentProfileMaster) db.markAgentProfileMaster('master-1');
  return { db, tmpDir };
}

function teardown() {
  delete process.env.AOC_DATA_DIR;
  delete require.cache[require.resolve('./db.cjs')];
  delete require.cache[require.resolve('./hq-room.cjs')];
}

test('ensureHqRoom creates a HQ room with correct flags', async () => {
  const { db } = await setupDb();
  const hq = require('./hq-room.cjs');
  const room = hq.ensureHqRoom(db, 42, 'master-1');
  assert.ok(room, 'should return room');
  assert.ok(room.id, 'room has id');
  assert.equal(room.isHq, true);
  assert.equal(room.isSystem, true);
  assert.equal(room.ownerUserId, 42);
  assert.ok(room.memberAgentIds.includes('master-1'), 'master should be in members');
  teardown();
});

test('ensureHqRoom is idempotent — second call returns same room', async () => {
  const { db } = await setupDb();
  const hq = require('./hq-room.cjs');
  const r1 = hq.ensureHqRoom(db, 42, 'master-1');
  const r2 = hq.ensureHqRoom(db, 42, 'master-1');
  assert.equal(r1.id, r2.id, 'same room id');
  teardown();
});

test('addAgentToHq adds agent to membership idempotently', async () => {
  const { db } = await setupDb();
  const hq = require('./hq-room.cjs');
  hq.ensureHqRoom(db, 42, 'master-1');
  hq.addAgentToHq(db, 42, 'pm-bot');
  hq.addAgentToHq(db, 42, 'pm-bot'); // idempotent
  const room = db.getHqRoomForUser(42);
  assert.ok(room.memberAgentIds.includes('pm-bot'));
  assert.ok(room.memberAgentIds.includes('master-1'));
  teardown();
});

test('removeAgentFromHq removes a non-master agent', async () => {
  const { db } = await setupDb();
  const hq = require('./hq-room.cjs');
  hq.ensureHqRoom(db, 42, 'master-1');
  hq.addAgentToHq(db, 42, 'pm-bot');
  hq.removeAgentFromHq(db, 42, 'pm-bot');
  const room = db.getHqRoomForUser(42);
  assert.ok(!room.memberAgentIds.includes('pm-bot'));
  assert.ok(room.memberAgentIds.includes('master-1'));
  teardown();
});

test('removeAgentFromHq refuses to remove master', async () => {
  const { db } = await setupDb();
  const hq = require('./hq-room.cjs');
  hq.ensureHqRoom(db, 42, 'master-1');
  assert.throws(() => hq.removeAgentFromHq(db, 42, 'master-1'), /master/i);
  teardown();
});

test('postHqSystemMessage creates a message in the HQ room', async () => {
  const { db } = await setupDb();
  const hq = require('./hq-room.cjs');
  hq.ensureHqRoom(db, 42, 'master-1');
  const msg = hq.postHqSystemMessage(db, 42, '🧭 master-1 → pm-bot: draft PRD');
  assert.ok(msg, 'message returned');
  assert.ok(msg.id);
  assert.equal(msg.authorType, 'system');
  assert.equal(msg.body, '🧭 master-1 → pm-bot: draft PRD');
  teardown();
});

test('postHqSystemMessage returns null when no HQ exists', async () => {
  const { db } = await setupDb();
  const hq = require('./hq-room.cjs');
  // No ensureHqRoom call — no HQ for user 42
  const msg = hq.postHqSystemMessage(db, 42, 'test');
  assert.equal(msg, null);
  teardown();
});
