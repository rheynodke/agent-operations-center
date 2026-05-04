'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// Use a tmp HOME so we don't pollute real ~/.openclaw
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-dashstats-'));
process.env.OPENCLAW_HOME = path.join(tmp, '.openclaw');
process.env.AOC_DATA_DIR = tmp;
fs.mkdirSync(process.env.OPENCLAW_HOME, { recursive: true });

// Force fresh require so config picks up the env vars
delete require.cache[require.resolve('../config.cjs')];
delete require.cache[require.resolve('../db.cjs')];
delete require.cache[require.resolve('./opencode.cjs')];
delete require.cache[require.resolve('./gateway.cjs')];
delete require.cache[require.resolve('./index.cjs')];
const sessions = require('./index.cjs');
const db = require('../db.cjs');

test('getDashboardStats(uid=1) returns admin defaults with port 18789', async () => {
  await db.initDatabase();
  const stats = sessions.getDashboardStats(1);
  assert.equal(stats.gateway.port, 18789);
  assert.equal(stats.gateway.mode, 'external');
  assert.equal(stats.gateway.status, 'running');
  assert.equal(typeof stats.sessions.total, 'number');
  assert.equal(typeof stats.cost.total, 'number');
});

test('getDashboardStats(uid=99) returns empty for non-admin with no data', async () => {
  await db.initDatabase();
  const stats = sessions.getDashboardStats(99);
  assert.equal(stats.gateway.mode, 'managed');
  assert.equal(stats.gateway.status, 'stopped');
  assert.equal(stats.sessions.total, 0);
  assert.equal(stats.agents.total, 0);
  assert.equal(stats.cost.total, 0);
});

test('getDashboardStats(uid) cost: scoped via projects.created_by', async () => {
  await db.initDatabase();
  const sqlDb = db.getDb();
  const now = new Date().toISOString();
  // Seed a project for user 99 with one done task that has cost 2.50
  sqlDb.run("INSERT OR IGNORE INTO users (id, username, password_hash, role) VALUES (99, 'u99', 'x', 'user')");
  sqlDb.run("INSERT OR IGNORE INTO projects (id, name, color, created_at, updated_at, created_by) VALUES ('proj99', 'Project 99', '#6366f1', ?, ?, 99)", [now, now]);
  // Insert a minimal task — required columns: id, title, status, created_at, updated_at
  sqlDb.run(
    "INSERT OR REPLACE INTO tasks (id, title, status, project_id, cost, created_at, updated_at) VALUES ('t99', 'Task', 'done', 'proj99', 2.5, ?, ?)",
    [now, now]
  );
  const r99 = sessions.getDashboardStats(99);
  assert.equal(r99.cost.total, 2.5, 'user 99 sees own cost');

  const r100 = sessions.getDashboardStats(100);
  assert.equal(r100.cost.total, 0, 'user 100 does NOT see user 99 cost');
});

test.after(async () => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});
