'use strict';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('node:http');
const path = require('path');
const fs = require('fs');
const os = require('os');

function startServer() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-fb-'));
  process.env.AOC_DATA_DIR = tmpDir;
  delete require.cache[require.resolve('../lib/db.cjs')];
  delete require.cache[require.resolve('../lib/db/satisfaction.cjs')];
  delete require.cache[require.resolve('./feedback.cjs')];
  const db = require('../lib/db.cjs');

  const stubDb = {
    ...db,
    authMiddleware: (req, _res, next) => {
      const u = req.headers['x-test-user'];
      req.user = u ? JSON.parse(u) : null;
      next();
    },
    getAgentOwner: () => 1,  // simulate ownership lookup
    requireAdmin: (req, res, next) =>
      req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'admin only' }),
  };

  const router = require('./feedback.cjs')({ db: stubDb });
  const app = express();
  app.use(express.json());
  app.use('/api', router);
  const server = app.listen(0);
  return { db, server, port: server.address().port };
}

function call(port, method, urlPath, user, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const req = http.request(
      { method, port, path: '/api' + urlPath,
        headers: { 'content-type': 'application/json', 'x-test-user': JSON.stringify(user || null), 'content-length': Buffer.byteLength(data) } },
      (res) => {
        let buf = '';
        res.on('data', c => buf += c);
        res.on('end', () => resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }));
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ---------- Task 16 ----------

test('POST /api/feedback/message records rating with user as owner', async () => {
  const { db, server, port } = startServer();
  await db.initDatabase();
  const user = { userId: 1, role: 'user', username: 'rheyno' };

  const r = await call(port, 'POST', '/feedback/message', user, {
    messageId: 'm1', sessionId: 's1', agentId: 'a1',
    rating: 'positive',
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);

  const rows = db.getMessageRatings({ sessionId: 's1' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].rating, 'positive');
  assert.equal(rows[0].source, 'button');
  assert.equal(rows[0].channel, 'dashboard');
  server.close();
});

test('POST /api/feedback/message rejects unauthenticated', async () => {
  const { db, server, port } = startServer();
  await db.initDatabase();
  const r = await call(port, 'POST', '/feedback/message', null, {
    messageId: 'm1', sessionId: 's1', agentId: 'a1', rating: 'positive',
  });
  assert.equal(r.status, 401);
  server.close();
});

test('POST /api/feedback/message validates rating value', async () => {
  const { db, server, port } = startServer();
  await db.initDatabase();
  const user = { userId: 1, role: 'user' };
  const r = await call(port, 'POST', '/feedback/message', user, {
    messageId: 'm1', sessionId: 's1', agentId: 'a1', rating: 'maybe',
  });
  assert.equal(r.status, 400);
  server.close();
});

test('POST /api/feedback/message: same key flips rating (last-write-wins)', async () => {
  const { db, server, port } = startServer();
  await db.initDatabase();
  const user = { userId: 1, role: 'user' };

  await call(port, 'POST', '/feedback/message', user, {
    messageId: 'm1', sessionId: 's1', agentId: 'a1', rating: 'positive',
  });
  await call(port, 'POST', '/feedback/message', user, {
    messageId: 'm1', sessionId: 's1', agentId: 'a1', rating: 'negative', reason: 'oops',
  });

  const rows = db.getMessageRatings({ sessionId: 's1' });
  assert.equal(rows.length, 1, 'still 1 row (replaced)');
  assert.equal(rows[0].rating, 'negative');
  assert.equal(rows[0].reason, 'oops');
  server.close();
});

// ---------- Task 17 ----------

test('GET /api/satisfaction/agent/:id/metrics returns daily metrics for range', async () => {
  const { db, server, port } = startServer();
  await db.initDatabase();
  // Seed
  db.upsertDailyMetric({
    agentId: 'a1', ownerId: 1, day: '2026-05-09', channel: 'all',
    sessionCount: 3, messageCount: 30, endorsedCount: 10, flaggedCount: 2,
    hallucinationRate: 2/30, endorsementRate: 10/30,
  });

  const user = { userId: 1, role: 'user' };
  const r = await call(port, 'GET', '/satisfaction/agent/a1/metrics?range=7d', user);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.metrics));
  assert.ok(r.body.metrics.length >= 1);
  server.close();
});

test('GET /api/satisfaction/agent/:id/flagged-messages returns flagged ratings', async () => {
  const { db, server, port } = startServer();
  await db.initDatabase();
  db.recordRating({
    messageId: 'm1', sessionId: 's1', agentId: 'a1', ownerId: 1,
    channel: 'dashboard', source: 'button', rating: 'negative',
    reason: 'wrong', createdAt: Date.now(),
  });
  db.recordRating({
    messageId: 'm2', sessionId: 's1', agentId: 'a1', ownerId: 1,
    channel: 'dashboard', source: 'button', rating: 'positive',
    createdAt: Date.now(),
  });

  const user = { userId: 1, role: 'user' };
  const r = await call(port, 'GET', '/satisfaction/agent/a1/flagged-messages?limit=20', user);
  assert.equal(r.status, 200);
  assert.equal(r.body.flagged.length, 1);
  assert.equal(r.body.flagged[0].messageId, 'm1');
  server.close();
});

test('GET /api/satisfaction/health returns reflection queue + provider info', async () => {
  const { server, port } = startServer();
  const user = { userId: 1, role: 'admin' };
  const r = await call(port, 'GET', '/satisfaction/health', user);
  assert.equal(r.status, 200);
  assert.ok(r.body.reflection);
  assert.ok(r.body.llm_provider);
  server.close();
});

// ---------- Task 18 ----------

test('POST /api/feedback/internal/reflect (admin) calls reflection service', async () => {
  const { db, server, port } = startServer();
  await db.initDatabase();

  // Create a fake JSONL fixture
  const jsonlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonl-'));
  const jsonlPath = path.join(jsonlDir, 's-trigger.jsonl');
  const lines = [
    JSON.stringify({ type: 'session', id: 's-trigger', timestamp: 0 }),
  ];
  for (let i = 0; i < 12; i++) {
    lines.push(JSON.stringify({
      type: 'message', id: 'm' + i,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: 'message ' + i + ' '.repeat(100),
    }));
  }
  fs.writeFileSync(jsonlPath, lines.join('\n'));

  const user = { userId: 1, role: 'admin' };
  const r = await call(port, 'POST', '/feedback/internal/reflect', user, {
    sessionId: 's-trigger', agentId: 'a1', ownerId: 1,
    workspace: jsonlDir,
    jsonlPath,
    mockLlm: true,
  });
  assert.equal(r.status, 200);
  assert.ok(['completed', 'skipped_too_short', 'skipped_no_signal', 'failed'].includes(r.body.status));
  server.close();
});

test('POST /api/feedback/internal/reflect rejects non-admin', async () => {
  const { server, port } = startServer();
  const user = { userId: 1, role: 'user' };
  const r = await call(port, 'POST', '/feedback/internal/reflect', user, {
    sessionId: 's1', agentId: 'a1', ownerId: 1,
  });
  assert.equal(r.status, 403);
  server.close();
});
