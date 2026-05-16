'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const express = require('express');
const request = require('supertest');

function freshTempMetricsDb() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-metrics-route-'));
  process.env.AOC_METRICS_DB_PATH = path.join(tmpDir, 'm.db');
  delete require.cache[require.resolve('../lib/metrics/db.cjs')];
  delete require.cache[require.resolve('../lib/metrics/queries.cjs')];
  return require('../lib/metrics/queries.cjs');
}

function makeStubDb() {
  return {
    authMiddleware(req, res, next) {
      const role = req.headers['x-test-role'];
      if (!role) return res.status(401).json({ error: 'Missing role header' });
      req.user = { userId: 1, role, username: `test-${role}` };
      next();
    },
    requireAdmin(req, res, next) {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
      next();
    },
    getUsersByIds(ids) {
      return ids.map((id) => ({ id, username: `user${id}`, display_name: `User ${id}` }));
    },
  };
}

function buildApp() {
  delete require.cache[require.resolve('./gateway-metrics.cjs')];
  const app = express();
  app.use('/api/admin/gateway-metrics', require('./gateway-metrics.cjs')({ db: makeStubDb() }));
  return app;
}

function seedSamples(q) {
  const now = Date.now();
  q.insertSample({ ts: now - 1000, user_id: 1, state: 'running', rss_mb: 100, cpu_percent: 1, messages_1h: 5,  messages_24h: 100 });
  q.insertSample({ ts: now - 2000, user_id: 2, state: 'running', rss_mb: 200, cpu_percent: 2, messages_1h: 10, messages_24h: 200 });
  q.insertSample({ ts: now - 3000, user_id: 3, state: 'stopped', rss_mb: null, cpu_percent: null, messages_1h: null, messages_24h: 50 });
}

// --- auth guard ---

test('rejects request without role header (401)', async () => {
  freshTempMetricsDb();
  const app = buildApp();
  const res = await request(app).get('/api/admin/gateway-metrics/aggregate?range=1h');
  assert.strictEqual(res.status, 401);
});

test('rejects non-admin role (403)', async () => {
  freshTempMetricsDb();
  const app = buildApp();
  const res = await request(app)
    .get('/api/admin/gateway-metrics/aggregate?range=1h')
    .set('x-test-role', 'user');
  assert.strictEqual(res.status, 403);
});

// --- happy paths ---

test('GET /aggregate returns cluster KPIs for admin', async () => {
  const q = freshTempMetricsDb();
  seedSamples(q);
  const app = buildApp();
  const res = await request(app)
    .get('/api/admin/gateway-metrics/aggregate?range=1h')
    .set('x-test-role', 'admin');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.totalCount, 3);
  assert.strictEqual(res.body.runningCount, 2);
  assert.strictEqual(res.body.totalRssMb, 300);
  assert.strictEqual(res.body.totalMessages24h, 350);
});

test('GET /timeseries returns per-user series with username enriched', async () => {
  const q = freshTempMetricsDb();
  seedSamples(q);
  const app = buildApp();
  const res = await request(app)
    .get('/api/admin/gateway-metrics/timeseries?range=1h')
    .set('x-test-role', 'admin');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.range, '1h');
  assert.strictEqual(res.body.bucketMs, 30_000);
  assert.ok(Array.isArray(res.body.users));
  assert.ok(res.body.users.length >= 1);
  for (const u of res.body.users) {
    assert.ok(typeof u.userId === 'number');
    assert.strictEqual(u.username, `user${u.userId}`);
    assert.ok(Array.isArray(u.points));
  }
});

test('GET /timeseries with userId filters to single user', async () => {
  const q = freshTempMetricsDb();
  seedSamples(q);
  const app = buildApp();
  const res = await request(app)
    .get('/api/admin/gateway-metrics/timeseries?range=1h&userId=2')
    .set('x-test-role', 'admin');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.users.length, 1);
  assert.strictEqual(res.body.users[0].userId, 2);
});

test('GET /state-timeline returns bucketed state counts', async () => {
  const q = freshTempMetricsDb();
  seedSamples(q);
  const app = buildApp();
  const res = await request(app)
    .get('/api/admin/gateway-metrics/state-timeline?range=1h')
    .set('x-test-role', 'admin');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.range, '1h');
  assert.ok(Array.isArray(res.body.points));
  const totals = res.body.points.reduce((acc, p) => {
    acc.running += p.running;
    acc.stopped += p.stopped;
    return acc;
  }, { running: 0, stopped: 0 });
  assert.strictEqual(totals.running, 2);
  assert.strictEqual(totals.stopped, 1);
});

test('GET /leaderboard returns top-N by metric with username', async () => {
  const q = freshTempMetricsDb();
  seedSamples(q);
  const app = buildApp();
  const res = await request(app)
    .get('/api/admin/gateway-metrics/leaderboard?range=1h&metric=rss&limit=2')
    .set('x-test-role', 'admin');
  assert.strictEqual(res.status, 200);
  assert.ok(Array.isArray(res.body));
  assert.strictEqual(res.body.length, 2);
  assert.strictEqual(res.body[0].userId, 2);
  assert.strictEqual(res.body[0].username, 'user2');
  assert.strictEqual(res.body[0].value, 200);
});

// --- input validation ---

test('GET /aggregate with unknown range → 400', async () => {
  freshTempMetricsDb();
  const app = buildApp();
  const res = await request(app)
    .get('/api/admin/gateway-metrics/aggregate?range=99d')
    .set('x-test-role', 'admin');
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.code, 'BAD_RANGE');
});

test('GET /leaderboard with unknown metric → 400', async () => {
  freshTempMetricsDb();
  const app = buildApp();
  const res = await request(app)
    .get('/api/admin/gateway-metrics/leaderboard?range=1h&metric=foo')
    .set('x-test-role', 'admin');
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.code, 'BAD_METRIC');
});

test('GET /leaderboard without metric → 400', async () => {
  freshTempMetricsDb();
  const app = buildApp();
  const res = await request(app)
    .get('/api/admin/gateway-metrics/leaderboard?range=1h')
    .set('x-test-role', 'admin');
  assert.strictEqual(res.status, 400);
});
