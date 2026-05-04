'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Sandbox HOME so chokidar doesn't watch the real ~/.openclaw
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-watchpool-'));
process.env.OPENCLAW_HOME = path.join(tmp, '.openclaw');
process.env.OPENCLAW_WORKSPACE = path.join(tmp, '.openclaw', 'workspace');
fs.mkdirSync(path.join(process.env.OPENCLAW_HOME, 'users', '7', '.openclaw'), { recursive: true });
fs.mkdirSync(path.join(process.env.OPENCLAW_WORKSPACE), { recursive: true });

// Force fresh require so config picks up env vars
delete require.cache[require.resolve('./config.cjs')];
delete require.cache[require.resolve('./watchers.cjs')];
const { WatcherPool, LiveFeedWatcher } = require('./watchers.cjs');

test('LiveFeedWatcher tags broadcasts with ownerUserId', () => {
  const w = new LiveFeedWatcher({ ownerUserId: 42 });
  const captured = [];
  w.addListener(e => captured.push(e));
  w.broadcast({ type: 'test', payload: { x: 1 } });
  assert.equal(captured.length, 1);
  assert.equal(captured[0].ownerUserId, 42);
  assert.equal(captured[0].type, 'test');
});

test('LiveFeedWatcher default ownerUserId is 1 (admin back-compat)', () => {
  const w = new LiveFeedWatcher();
  const captured = [];
  w.addListener(e => captured.push(e));
  w.broadcast({ type: 'test' });
  assert.equal(captured[0].ownerUserId, 1);
});

test('WatcherPool.ensureForUser is idempotent (one watcher per userId)', () => {
  const pool = new WatcherPool();
  const w1 = pool.ensureForUser(7);
  const w2 = pool.ensureForUser(7);
  assert.strictEqual(w1, w2);
  assert.equal(pool.list().length, 1);
  pool.removeForUser(7);
  assert.equal(pool.list().length, 0);
});

test('WatcherPool fans out tagged events from inner watchers', () => {
  const pool = new WatcherPool();
  const captured = [];
  pool.addListener(e => captured.push(e));
  const w = pool.ensureForUser(99);
  w.broadcast({ type: 'session:update' });
  assert.equal(captured.length, 1);
  assert.equal(captured[0].ownerUserId, 99);
  pool.removeForUser(99);
});

test.after(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});
