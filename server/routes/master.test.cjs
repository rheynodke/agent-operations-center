'use strict';
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('node:http');

function jsonReq(server, method, p, body, headers) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1', port, path: p, method,
      headers: { 'content-type': 'application/json', ...(headers || {}), ...(data ? { 'content-length': Buffer.byteLength(data) } : {}) },
    }, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

/**
 * Build a stub db whose authMiddleware injects req.user = user
 * without any real JWT machinery.
 */
function makeDb({ user, masterAgentId, profiles }) {
  return {
    authMiddleware(req, _res, next) {
      req.user = user;
      next();
    },
    getUserMasterAgentId(userId) {
      return masterAgentId || null;
    },
    getAllAgentProfiles() {
      return profiles || [];
    },
    getAgentProfile(agentId) {
      return (profiles || []).find(p => p.agent_id === agentId) || null;
    },
  };
}

function setupApp(db, gatewayPoolStub) {
  const app = express();
  app.use(express.json());
  app.use('/api', require('./master.cjs')({ db, gatewayPool: gatewayPoolStub }));
  return app.listen(0);
}

test('GET /api/master/team returns the user\'s sub-agents (excludes master)', async () => {
  const userId = 1;
  const db = makeDb({
    user: { userId, role: 'user' },
    masterAgentId: 'oz-master',
    profiles: [
      { agent_id: 'oz-master', display_name: 'Oz',  provisioned_by: userId, role: null,         is_master: 1, last_active_at: null },
      { agent_id: 'pm-1',      display_name: 'PM',   provisioned_by: userId, role: 'pm-analyst', is_master: 0, last_active_at: null },
      { agent_id: 'swe-1',     display_name: 'SWE',  provisioned_by: userId, role: 'swe',        is_master: 0, last_active_at: null },
    ],
  });

  const server = setupApp(db, {});
  const res = await jsonReq(server, 'GET', '/api/master/team', null, { authorization: 'Bearer dummy' });
  server.close();

  assert.equal(res.status, 200);
  const ids = res.body.team.map(a => a.id).sort();
  assert.deepEqual(ids, ['pm-1', 'swe-1']);
  assert.ok(!ids.includes('oz-master'));
});

test('POST /api/master/delegate calls gateway sessions.create with target agent', async () => {
  const userId = 1;
  const db = makeDb({
    user: { userId, role: 'user' },
    masterAgentId: 'oz-master',
    profiles: [
      { agent_id: 'oz-master', display_name: 'Oz', provisioned_by: userId, is_master: 1 },
      { agent_id: 'pm-1',      display_name: 'PM',  provisioned_by: userId, is_master: 0 },
    ],
  });

  const calls = [];
  const stub = {
    forUser(uid) {
      return {
        sessionsCreate: async (agentId, opts) => {
          calls.push({ kind: 'sessions.create', uid, agentId, opts });
          return { sessionKey: `sess-${agentId}-1` };
        },
        chatSend: async (sessionKey, message) => {
          calls.push({ kind: 'chat.send', sessionKey, message });
          return { ok: true };
        },
      };
    },
  };

  const server = setupApp(db, stub);
  const res = await jsonReq(server, 'POST', '/api/master/delegate',
    { targetAgentId: 'pm-1', task: 'write PRD for reset password' },
    { authorization: 'Bearer dummy' });
  server.close();

  assert.equal(res.status, 201);
  assert.equal(res.body.sessionKey, 'sess-pm-1-1');
  assert.equal(res.body.targetAgentId, 'pm-1');
  assert.ok(calls.find(c => c.kind === 'sessions.create' && c.agentId === 'pm-1'));
  assert.ok(calls.find(c => c.kind === 'chat.send' && c.message.includes('write PRD')));
});

test('POST /api/master/delegate returns 403 if user has no master', async () => {
  const userId = 2;
  const db = makeDb({
    user: { userId, role: 'user' },
    masterAgentId: null,
    profiles: [],
  });

  const server = setupApp(db, {});
  const res = await jsonReq(server, 'POST', '/api/master/delegate',
    { targetAgentId: 'pm-1', task: 'do thing' },
    { authorization: 'Bearer dummy' });
  server.close();

  assert.equal(res.status, 403);
  assert.match(res.body.error, /master/i);
});

test('POST /api/master/delegate returns 404 if target is not owned by user', async () => {
  const userId = 1;
  const db = makeDb({
    user: { userId, role: 'user' },
    masterAgentId: 'oz-master',
    profiles: [
      { agent_id: 'oz-master',     display_name: 'Oz', provisioned_by: userId, is_master: 1 },
      { agent_id: 'someone-elses', display_name: 'X',  provisioned_by: 999,    is_master: 0 },
    ],
  });

  const server = setupApp(db, { forUser: () => ({ sessionsCreate: async () => ({}), chatSend: async () => ({}) }) });
  const res = await jsonReq(server, 'POST', '/api/master/delegate',
    { targetAgentId: 'someone-elses', task: 'x' },
    { authorization: 'Bearer dummy' });
  server.close();

  assert.equal(res.status, 404);
});
