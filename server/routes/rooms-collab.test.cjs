'use strict';
/**
 * server/routes/rooms-collab.test.cjs
 *
 * Integration tests for the Room Collaboration endpoints added in Task 14:
 *   - POST   /rooms/:id/artifacts
 *   - GET    /rooms/:id/artifacts
 *   - GET    /rooms/:id/artifacts/:artifactId
 *   - GET    /rooms/:id/context
 *   - POST   /rooms/:id/context/append
 *   - GET    /rooms/:id/agents/:agentId/state
 *
 * Uses Node's built-in http module (same pattern as master.test.cjs).
 * Stubs all deps so no real DB / filesystem is touched.
 */

const test   = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http    = require('node:http');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function jsonReq(server, method, path, body, headers) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        'content-type': 'application/json',
        ...(headers || {}),
        ...(data ? { 'content-length': Buffer.byteLength(data) } : {}),
      },
    }, res => {
      let buf = '';
      res.on('data', c => (buf += c));
      res.on('end', () => {
        resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ─── Stub factories ───────────────────────────────────────────────────────────

/**
 * Build a minimal stub `db` object whose authMiddleware injects req.user.
 */
function makeDb({ user = { userId: 1, username: 'alice', role: 'admin' }, room = null } = {}) {
  return {
    authMiddleware(req, _res, next) {
      req.user = user;
      next();
    },
    getMissionRoomById() {
      return room;
    },
    // Other db methods referenced by existing routes (not under test, but must exist)
    authMiddlewareWithQueryToken(req, _res, next) { req.user = user; next(); },
    listMissionRoomsForUser() { return []; },
    userOwnsProject() { return false; },
    ensureProjectDefaultRoom() { return null; },
    listMissionMessages() { return []; },
    createMissionMessage() { return {}; },
    getUserMasterAgentId() { return null; },
    upsertAgentProfile() {},
    getAgentProfile() { return null; },
    renameAgentProfile() {},
    deleteAgentProfile() {},
    updateMissionRoomMembers() { return {}; },
    createMissionRoom() { return {}; },
    deleteMissionRoom() {},
    requireAgentOwnership(req, res, next) { next(); },
  };
}

/**
 * Build a minimal stub `parsers` (barrel) object with artifact + context fns.
 * Each function stores its call args in the `calls` array and returns `stub.<fnName>`.
 */
function makeParsers(stubs = {}) {
  const calls = {};
  const handler = (name, defaultReturn) => (...args) => {
    if (!calls[name]) calls[name] = [];
    calls[name].push(args);
    if (stubs[name]) return stubs[name](...args);
    return defaultReturn;
  };

  return {
    _calls: calls,
    // ── artifact functions ──
    createArtifact: handler('createArtifact', {
      artifact: { id: 'art-1', roomId: 'room-1', category: 'briefs', title: 'Test', createdBy: 'alice' },
      version:  { id: 'ver-1', artifactId: 'art-1', versionNumber: 1 },
    }),
    listArtifacts: handler('listArtifacts', [
      { id: 'art-1', roomId: 'room-1', category: 'briefs', title: 'Test', pinned: false, archived: false },
    ]),
    getArtifact: handler('getArtifact', {
      artifact: { id: 'art-1', roomId: 'room-1', category: 'briefs', title: 'Test' },
      versions: [{ id: 'ver-1', versionNumber: 1 }],
    }),
    getArtifactContent: handler('getArtifactContent', {
      version: { id: 'ver-1', versionNumber: 1 },
      content: 'hello world',
    }),
    addArtifactVersion: handler('addArtifactVersion', {
      version:  { id: 'ver-2', versionNumber: 2 },
      artifact: { id: 'art-1', latestVersionId: 'ver-2' },
    }),
    pinArtifact:     handler('pinArtifact',     { id: 'art-1', pinned: true }),
    archiveArtifact: handler('archiveArtifact', { id: 'art-1', archived: true }),
    deleteArtifact:  handler('deleteArtifact',  undefined),
    // ── context functions ──
    getRoomContext:  handler('getRoomContext',  { content: '', path: '/fake/CONTEXT.md' }),
    appendToContext: handler('appendToContext', { content: '---\n### ts — alice\n\nhello\n\n' }),
    clearContext:    handler('clearContext',    undefined),
    // ── agent room state ──
    getAgentRoomState: handler('getAgentRoomState', { state: {} }),
    setAgentRoomState: handler('setAgentRoomState', { state: { foo: 'bar' } }),
    // ── other parsers referenced by existing routes (must exist so router loads) ──
    parseAgentRegistry() { return []; },
    getAgentDetail() { return null; },
    updateAgent() { return {}; },
    saveAgentFile() { return {}; },
    getAgentFile() { return {}; },
    injectSoulStandard() { return {}; },
    provisionAgent() { return { agentId: 'x', agentName: 'X', bindings: [] }; },
    deleteAgent() {},
    getAllSessions() { return []; },
  };
}

/**
 * Spin up a test Express app with the rooms router mounted at /api.
 */
function setupApp(db, parsers) {
  const app = express();
  app.use(express.json());
  app.use('/api', require('./rooms.cjs')({
    db,
    parsers,
    broadcast() {},
    emitRoomMessage() {},
    canAccessAgent() { return true; },
    getAgentDisplayName(id) { return id; },
    restartGateway() {},
    groupRoomsForClient(rooms) { return rooms; },
    withRoomAccess(req, res, roomId) {
      return { id: roomId, memberAgentIds: [], createdBy: 1, kind: 'global', isSystem: false };
    },
    validateAccessibleAgentIds(req, ids) { return ids; },
    roomAgents() { return []; },
    resolveMentions() { return []; },
    forwardRoomMentionToAgent() { return Promise.resolve(); },
    vSave() {},
  }));
  return app.listen(0);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test('POST /api/rooms/:id/artifacts creates artifact and first version', async () => {
  const db = makeDb();
  const parsers = makeParsers();
  const server = setupApp(db, parsers);

  const res = await jsonReq(server, 'POST', '/api/rooms/room-1/artifacts', {
    category: 'briefs',
    title:    'My Brief',
    content:  '# Brief content',
    fileName: 'brief.md',
  });
  server.close();

  assert.equal(res.status, 201);
  assert.ok(res.body.artifact, 'response has artifact key');
  assert.ok(res.body.version,  'response has version key');
  assert.equal(res.body.artifact.category, 'briefs');

  // Verify parsers.createArtifact was called with correct roomId
  const [callArgs] = parsers._calls.createArtifact;
  assert.equal(callArgs[0].roomId, 'room-1');
  assert.equal(callArgs[0].title,  'My Brief');
  assert.equal(callArgs[0].createdBy, 'alice');
});

test('POST /api/rooms/:id/artifacts returns 400 for invalid/missing category', async () => {
  const db = makeDb();
  const parsers = makeParsers({
    createArtifact() {
      throw new Error('Invalid category "bad-cat". Must be one of: briefs, outputs, research, decisions, assets');
    },
  });
  const server = setupApp(db, parsers);

  const res = await jsonReq(server, 'POST', '/api/rooms/room-1/artifacts', {
    category: 'bad-cat',
    title:    'Oops',
    content:  'x',
    fileName: 'x.txt',
  });
  server.close();

  assert.equal(res.status, 400);
  assert.match(res.body.error, /Invalid category/);
});

test('GET /api/rooms/:id/artifacts returns artifact list', async () => {
  const db = makeDb();
  const parsers = makeParsers();
  const server = setupApp(db, parsers);

  const res = await jsonReq(server, 'GET', '/api/rooms/room-1/artifacts');
  server.close();

  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.artifacts), 'artifacts is an array');
  assert.equal(res.body.artifacts.length, 1);
  assert.equal(res.body.artifacts[0].id, 'art-1');

  // Verify roomId was forwarded
  const [callArgs] = parsers._calls.listArtifacts;
  assert.equal(callArgs[0].roomId, 'room-1');
});

test('GET /api/rooms/:id/artifacts/:artifactId returns artifact with versions', async () => {
  const db = makeDb();
  const parsers = makeParsers();
  const server = setupApp(db, parsers);

  const res = await jsonReq(server, 'GET', '/api/rooms/room-1/artifacts/art-1');
  server.close();

  assert.equal(res.status, 200);
  assert.ok(res.body.artifact, 'response has artifact');
  assert.ok(Array.isArray(res.body.versions), 'response has versions array');
  assert.equal(res.body.versions.length, 1);

  const [callArgs] = parsers._calls.getArtifact;
  assert.equal(callArgs[0], 'art-1');
});

test('GET /api/rooms/:id/artifacts/:artifactId returns 404 when not found', async () => {
  const db = makeDb();
  const parsers = makeParsers({ getArtifact() { return null; } });
  const server = setupApp(db, parsers);

  const res = await jsonReq(server, 'GET', '/api/rooms/room-1/artifacts/missing');
  server.close();

  assert.equal(res.status, 404);
  assert.match(res.body.error, /not found/i);
});

test('GET /api/rooms/:id/context returns empty string for new room', async () => {
  const db = makeDb();
  const parsers = makeParsers();
  const server = setupApp(db, parsers);

  const res = await jsonReq(server, 'GET', '/api/rooms/room-1/context');
  server.close();

  assert.equal(res.status, 200);
  assert.equal(res.body.content, '');
  assert.ok(typeof res.body.path === 'string', 'path is a string');

  const [callArgs] = parsers._calls.getRoomContext;
  assert.equal(callArgs[0], 'room-1');
});

test('POST /api/rooms/:id/context/append adds entry and returns new content', async () => {
  const db = makeDb();
  const parsers = makeParsers();
  const server = setupApp(db, parsers);

  const res = await jsonReq(server, 'POST', '/api/rooms/room-1/context/append', {
    body: 'Added a note',
  });
  server.close();

  assert.equal(res.status, 200);
  assert.ok(typeof res.body.content === 'string', 'content is string');
  assert.ok(res.body.content.includes('alice'), 'authorId defaults to username');

  const [callArgs] = parsers._calls.appendToContext;
  assert.equal(callArgs[0], 'room-1');
  assert.equal(callArgs[1].authorId, 'alice');
  assert.equal(callArgs[1].body, 'Added a note');
});

test('POST /api/rooms/:id/context/append returns 400 when body is missing', async () => {
  const db = makeDb();
  const parsers = makeParsers();
  const server = setupApp(db, parsers);

  const res = await jsonReq(server, 'POST', '/api/rooms/room-1/context/append', {});
  server.close();

  assert.equal(res.status, 400);
  assert.match(res.body.error, /body is required/);
});

test('GET /api/rooms/:id/agents/:agentId/state returns {} for unknown agent', async () => {
  const db = makeDb();
  const parsers = makeParsers();
  const server = setupApp(db, parsers);

  const res = await jsonReq(server, 'GET', '/api/rooms/room-1/agents/unknown-agent/state');
  server.close();

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.state, {});

  const [callArgs] = parsers._calls.getAgentRoomState;
  assert.equal(callArgs[0], 'unknown-agent');
  assert.equal(callArgs[1], 'room-1');
});

test('PUT /api/rooms/:id/agents/:agentId/state stores and returns merged state', async () => {
  const db = makeDb();
  const parsers = makeParsers();
  const server = setupApp(db, parsers);

  const res = await jsonReq(server, 'PUT', '/api/rooms/room-1/agents/agent-1/state', {
    state: { foo: 'bar' },
  });
  server.close();

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.state, { foo: 'bar' });

  const [callArgs] = parsers._calls.setAgentRoomState;
  assert.equal(callArgs[0], 'agent-1');
  assert.equal(callArgs[1], 'room-1');
  assert.deepEqual(callArgs[2], { foo: 'bar' });
});

test('PUT /api/rooms/:id/agents/:agentId/state returns 400 when state is missing', async () => {
  const db = makeDb();
  const parsers = makeParsers();
  const server = setupApp(db, parsers);

  const res = await jsonReq(server, 'PUT', '/api/rooms/room-1/agents/agent-1/state', {});
  server.close();

  assert.equal(res.status, 400);
  assert.match(res.body.error, /state must be an object/);
});

test('DELETE /api/rooms/:id/context returns 403 for non-owner non-admin', async () => {
  // User 2 tries to clear context on a room owned by user 1
  const db = makeDb({
    user: { userId: 2, username: 'bob', role: 'user' },
    room: { id: 'room-1', createdBy: 1 },
  });
  const parsers = makeParsers();
  const server = setupApp(db, parsers);

  const res = await jsonReq(server, 'DELETE', '/api/rooms/room-1/context');
  server.close();

  assert.equal(res.status, 403);
  assert.match(res.body.error, /owner/i);
});

test('DELETE /api/rooms/:id/context succeeds for room owner', async () => {
  // User 1 clears context on their own room
  const db = makeDb({
    user: { userId: 1, username: 'alice', role: 'user' },
    room: { id: 'room-1', createdBy: 1 },
  });
  const parsers = makeParsers();
  const server = setupApp(db, parsers);

  const res = await jsonReq(server, 'DELETE', '/api/rooms/room-1/context');
  server.close();

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.ok(parsers._calls.clearContext, 'clearContext was called');
});

test('PATCH /api/rooms/:id/artifacts/:artifactId/pin sets pinned flag', async () => {
  const db = makeDb();
  const parsers = makeParsers();
  const server = setupApp(db, parsers);

  const res = await jsonReq(server, 'PATCH', '/api/rooms/room-1/artifacts/art-1/pin', { pinned: true });
  server.close();

  assert.equal(res.status, 200);
  assert.ok('artifact' in res.body, 'response has artifact key');
  const [agentId, pinned] = parsers._calls.pinArtifact[0];
  assert.equal(agentId, 'art-1');
  assert.equal(pinned, true);
});

test('PATCH /api/rooms/:id/artifacts/:artifactId/archive sets archived flag', async () => {
  const db = makeDb();
  const parsers = makeParsers();
  const server = setupApp(db, parsers);

  const res = await jsonReq(server, 'PATCH', '/api/rooms/room-1/artifacts/art-1/archive', { archived: true });
  server.close();

  assert.equal(res.status, 200);
  assert.ok('artifact' in res.body, 'response has artifact key');
});

test('DELETE /api/rooms/:id/artifacts/:artifactId removes artifact', async () => {
  const db = makeDb();
  const parsers = makeParsers();
  const server = setupApp(db, parsers);

  const res = await jsonReq(server, 'DELETE', '/api/rooms/room-1/artifacts/art-1');
  server.close();

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.ok(parsers._calls.deleteArtifact, 'deleteArtifact was called');
});
