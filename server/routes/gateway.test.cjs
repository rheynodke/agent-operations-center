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

function call(method, urlPath, user) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { method, port, path: '/api' + urlPath,
        headers: { 'content-type': 'application/json', 'x-test-user': JSON.stringify(user) } },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null }));
      }
    );
    req.on('error', reject);
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

test.after(() => {
  orchestrator.spawnGateway = origSpawn;
  orchestrator.stopGateway = origStop;
  orchestrator.restartGateway = origRestart;
  server.close();
});
