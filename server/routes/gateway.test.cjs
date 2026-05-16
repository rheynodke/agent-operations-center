'use strict';
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('node:http');

// Stub orchestrator BEFORE requiring the router
const orchestrator = require('../lib/gateway-orchestrator.cjs');
const calls = [];
const origSpawn = orchestrator.spawnGateway;
const origStop  = orchestrator.stopGateway;
const origRestart = orchestrator.restartGateway;
orchestrator.spawnGateway   = async (uid) => { calls.push(['spawn', Number(uid)]); return { port: 19000, pid: 1234 }; };
orchestrator.stopGateway    = async (uid) => { calls.push(['stop',  Number(uid)]); };
orchestrator.restartGateway = async (uid) => { calls.push(['restart', Number(uid)]); return { port: 19001, pid: 1235 }; };

const stubDb = {
  authMiddleware: (req, _res, next) => {
    const u = req.headers['x-test-user'];
    req.user = u ? JSON.parse(u) : null;
    next();
  },
  requireAdmin: (req, res, next) =>
    req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'admin only' }),
};

const router = require('./gateway.cjs')({ db: stubDb, parsers: { OPENCLAW_HOME: '/tmp' }, aiLib: {}, metrics: {} });
const app = express();
app.use(express.json());
app.use('/api', router);
const server = app.listen(0);
const port = server.address().port;

function call(method, urlPath, user, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const req = http.request(
      { method, port, path: '/api' + urlPath,
        headers: {
          'content-type': 'application/json',
          'x-test-user': JSON.stringify(user),
          ...(payload ? { 'content-length': Buffer.byteLength(payload) } : {}),
        } },
      (res) => {
        let chunks = '';
        res.on('data', (c) => (chunks += c));
        res.on('end', () => resolve({ status: res.statusCode, body: chunks ? JSON.parse(chunks) : null }));
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function callWithHomeResolver({ method, url, user, homeResolver }) {
  return new Promise((resolve, reject) => {
    const subApp = express();
    subApp.use(express.json());
    const subRouter = require('./gateway.cjs')({
      db: stubDb,
      parsers: { OPENCLAW_HOME: '/tmp' },
      aiLib: {},
      metrics: {},
      homeResolver,
    });
    subApp.use('/api', subRouter);
    const subServer = subApp.listen(0);
    const subPort = subServer.address().port;
    const req = http.request(
      { method, port: subPort, path: '/api' + url,
        headers: { 'content-type': 'application/json', 'x-test-user': JSON.stringify(user || {}) } },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          subServer.close();
          resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null });
        });
      },
    );
    req.on('error', (err) => { subServer.close(); reject(err); });
    req.end();
  });
}

test('POST /gateway/start (non-admin) → spawnGateway with own userId', async () => {
  calls.length = 0;
  const r = await call('POST', '/gateway/start', { userId: 5, role: 'user', username: 'u5' });
  assert.equal(r.status, 200);
  assert.deepEqual(calls[0], ['spawn', 5]);
});

test('POST /gateway/start (admin id=1) → 400 (external gateway)', async () => {
  calls.length = 0;
  const r = await call('POST', '/gateway/start', { userId: 1, role: 'admin', username: 'admin' });
  assert.equal(r.status, 400);
  assert.equal(calls.length, 0);
});

test('POST /admin/users/7/gateway/restart (admin) → restartGateway(7)', async () => {
  calls.length = 0;
  const r = await call('POST', '/admin/users/7/gateway/restart', { userId: 1, role: 'admin', username: 'admin' });
  assert.equal(r.status, 200);
  assert.deepEqual(calls[0], ['restart', 7]);
});

test('POST /admin/users/7/gateway/restart (non-admin) → 403', async () => {
  calls.length = 0;
  const r = await call('POST', '/admin/users/7/gateway/restart', { userId: 5, role: 'user', username: 'u5' });
  assert.equal(r.status, 403);
  assert.equal(calls.length, 0);
});

test('POST /admin/users/1/gateway/restart → 400 (admin external)', async () => {
  calls.length = 0;
  const r = await call('POST', '/admin/users/1/gateway/restart', { userId: 1, role: 'admin', username: 'admin' });
  assert.equal(r.status, 400);
  assert.equal(calls.length, 0);
});

test('POST /gateway/stop (non-admin) → stopGateway with own userId', async () => {
  calls.length = 0;
  const r = await call('POST', '/gateway/stop', { userId: 5, role: 'user', username: 'u5' });
  assert.equal(r.status, 200);
  assert.deepEqual(calls[0], ['stop', 5]);
});

test('GET /admin/gateways requires admin role', async () => {
  const realList = orchestrator.listGatewaysRich;
  orchestrator.listGatewaysRich = async () => [];
  try {
    // No-auth case: stub treats missing role as not-admin → 403 (the call
    // helper can't transmit a literally undefined header without throwing
    // ERR_HTTP_INVALID_HEADER_VALUE, so we pass an empty user object).
    const noAuth = await call('GET', '/admin/gateways', {});
    assert.equal(noAuth.status, 403);

    const userTok = await call('GET', '/admin/gateways', {
      userId: 5, role: 'user', username: 'odooplm',
    });
    assert.equal(userTok.status, 403);

    const adminTok = await call('GET', '/admin/gateways', {
      userId: 1, role: 'admin', username: 'admin',
    });
    assert.equal(adminTok.status, 200);
    assert.ok(Array.isArray(adminTok.body.gateways));
    assert.ok(typeof adminTok.body.probedAt === 'string');
  } finally {
    orchestrator.listGatewaysRich = realList;
  }
});

test('GET /admin/gateways returns rows from orchestrator', async () => {
  const realList = orchestrator.listGatewaysRich;
  orchestrator.listGatewaysRich = async () => [{
    userId: 5, username: 'odooplm', displayName: null, agentId: 'tecno',
    port: 19003, pid: 62149, state: 'running',
    uptimeSeconds: 2418, rssMb: 287, cpuPercent: 0.4,
    startedAt: '2026-05-15T23:43:00.000Z',
    logFile: '/Users/itdke/.openclaw/users/5/.openclaw/logs/gateway.log',
    activity: { messagesLast1h: 1, messagesLast24h: 5, lastActivityAt: '...', idleHeartbeatOnly: false },
  }];
  try {
    const r = await call('GET', '/admin/gateways', { userId: 1, role: 'admin', username: 'admin' });
    assert.equal(r.status, 200);
    assert.equal(r.body.gateways.length, 1);
    assert.equal(r.body.gateways[0].state, 'running');
  } finally {
    orchestrator.listGatewaysRich = realList;
  }
});

test('GET /admin/gateways/:userId/logs returns tail lines', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-logtest-'));
  fs.mkdirSync(path.join(tmp, 'users', '5', '.openclaw', 'logs'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'users', '5', '.openclaw', 'logs', 'gateway.log'),
    Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n'),
  );

  // Re-mount the router with a homeResolver pointing to our tmp dir
  const r = await callWithHomeResolver({
    method: 'GET',
    url: '/admin/gateways/5/logs?lines=20',
    user: { userId: 1, role: 'admin', username: 'admin' },
    homeResolver: (uid) => path.join(tmp, uid === 1 ? '' : 'users/' + uid + '/.openclaw'),
  });

  fs.rmSync(tmp, { recursive: true, force: true });

  assert.equal(r.status, 200);
  assert.equal(r.body.notFound, false);
  // clampLines clamps lines:20 (within 10..2000) to 20 → tail emits exactly 20 lines
  assert.equal(r.body.lines.length, 20);
  assert.equal(r.body.lines[r.body.lines.length - 1], 'line19');
});

test('GET /admin/gateways/:userId/logs returns notFound for missing file', async () => {
  const r = await callWithHomeResolver({
    method: 'GET',
    url: '/admin/gateways/9999/logs',
    user: { userId: 1, role: 'admin', username: 'admin' },
    homeResolver: () => '/tmp/aoc-does-not-exist-' + Date.now(),
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.notFound, true);
  assert.deepEqual(r.body.lines, []);
});

test('POST /admin/users/:id/gateway/start invokes spawnGateway(uid)', async () => {
  calls.length = 0;
  const r = await call('POST', '/admin/users/5/gateway/start', {
    userId: 1, role: 'admin', username: 'admin',
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, port: 19000, pid: 1234 });
  assert.deepEqual(calls, [['spawn', 5]]);
});

test('POST /admin/users/1/gateway/start → 400 (admin external)', async () => {
  const r = await call('POST', '/admin/users/1/gateway/start', {
    userId: 1, role: 'admin', username: 'admin',
  });
  assert.equal(r.status, 400);
});

test('POST /admin/users/:id/gateway/start requires admin', async () => {
  const r = await call('POST', '/admin/users/5/gateway/start', {
    userId: 5, role: 'user', username: 'odooplm',
  });
  assert.equal(r.status, 403);
});

test('POST /admin/gateways/bulk returns per-user results', async () => {
  calls.length = 0;
  const r = await call('POST', '/admin/gateways/bulk', {
    userId: 1, role: 'admin', username: 'admin',
  }, { action: 'restart', userIds: [3, 5], delaySeconds: 0 });

  assert.equal(r.status, 200);
  assert.equal(r.body.results.length, 2);
  assert.equal(r.body.results[0].ok, true);
  assert.equal(r.body.results[1].ok, true);
  assert.deepEqual(calls, [['restart', 3], ['restart', 5]]);
});

test('POST /admin/gateways/bulk rejects unknown action', async () => {
  const r = await call('POST', '/admin/gateways/bulk', {
    userId: 1, role: 'admin', username: 'admin',
  }, { action: 'nuke', userIds: [3] });
  assert.equal(r.status, 400);
});

test('POST /admin/gateways/bulk requires admin', async () => {
  const r = await call('POST', '/admin/gateways/bulk', {
    userId: 5, role: 'user', username: 'odooplm',
  }, { action: 'restart', userIds: [3] });
  assert.equal(r.status, 403);
});

test.after(() => {
  orchestrator.spawnGateway = origSpawn;
  orchestrator.stopGateway = origStop;
  orchestrator.restartGateway = origRestart;
  server.close();
});
