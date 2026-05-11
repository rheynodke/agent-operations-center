// server/routes/embed.test.cjs
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');

// AOC_DLP_MASTER_KEY MUST be set BEFORE any require that pulls in embed modules.
process.env.AOC_DLP_MASTER_KEY = crypto.randomBytes(32).toString('hex');

// ─── Per-test DB isolation (mirror of proxy.test.cjs pattern) ───────────────

function setupDb() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aocdb-routes-'));
  process.env.AOC_DATA_DIR = tmpDir;
  // Clear require cache so each test gets a fresh db + embed module instances
  Object.keys(require.cache).forEach(k => {
    if (
      k.includes('/server/lib/db') ||
      k.includes('/server/lib/embed/') ||
      k.includes('/server/routes/embed')
    ) {
      delete require.cache[k];
    }
  });
  const db = require('../lib/db.cjs');
  return { db, tmpDir };
}

// Helper: generate a dashboard JWT for a user (owner auth for playground)
function makeOwnerJwt(db, user) {
  return db.generateToken(user);
}

// createUser uses { username, password, role } in current codebase
function makeUser(db, suffix) {
  const user = db.createUser({ username: `test-${suffix}`, password: 'password123', role: 'admin' });
  return user.id;
}

async function _setup(prefix) {
  const { db } = setupDb();
  await db.initDatabase();
  const userId = makeUser(db, prefix);
  db.upsertAgentProfile({
    agentId: `a-${prefix}`,
    role: 'main',
    provisionedBy: userId,
    avatarPresetId: '1',
    color: '#000',
  });
  const embed = db.createEmbed({
    agentId: `a-${prefix}`,
    ownerId: userId,
    mode: 'private',
    productionOrigin: 'https://x.com',
    brandName: 'X',
    welcomeTitle: 'Halo',
    welcomeSubtitle: 'Sub',
    dlpPreset: 'internal-tool-default',
  });
  return { db, userId, embed };
}

async function _publicSetup(prefix) {
  const { db } = setupDb();
  await db.initDatabase();
  const userId = makeUser(db, prefix);
  db.upsertAgentProfile({
    agentId: `a-${prefix}`,
    role: 'main',
    provisionedBy: userId,
    avatarPresetId: '1',
    color: '#000',
  });
  const embed = db.createEmbed({
    agentId: `a-${prefix}`,
    ownerId: userId,
    mode: 'public',
    productionOrigin: 'https://x.com',
    brandName: 'X',
    welcomeTitle: 'Halo',
    welcomeSubtitle: 'Sub',
    dlpPreset: 'internal-tool-default',
  });
  return { db, userId, embed };
}

// Build a minimal Express app with the embed routers mounted
function _app(db) {
  const express = require('express');
  const cookieParser = require('cookie-parser');

  // Stub proxy module so tests don't hit a real gateway
  const proxyPath = require.resolve('../lib/embed/proxy.cjs');
  require.cache[proxyPath] = {
    exports: {
      handleMessage: async ({ embedToken, content }) => {
        if (embedToken === 'invalid') {
          return { status: 401, body: { error: 'invalid_token' } };
        }
        return {
          status: 200,
          body: {
            text: `Echo: ${content}`,
            session_id: 'sess-stub',
            action: 'pass',
            redaction_count: 0,
          },
        };
      },
    },
    id: proxyPath,
    filename: proxyPath,
    loaded: true,
    children: [],
  };

  // Also reset kill-switch + rate-limiter caches so previous tests don't bleed in
  try {
    const ks = require('../lib/embed/kill-switch.cjs');
    ks._resetCacheForTests();
  } catch (_) {}
  try {
    const rl = require('../lib/embed/rate-limit.cjs');
    rl._resetForTests();
  } catch (_) {}

  const router = require('./embed.cjs');

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/embed', router.api);
  app.use('/embed', router.serve);
  return app;
}

// Build a private visitor JWT signed with the embed's signing secret
function makeVisitorJwt(signingSecret, visitorId = 'visitor-1') {
  const jwt = require('jsonwebtoken');
  return jwt.sign(
    { visitor_id: visitorId, name: 'Test User', email: 'test@example.com', role: 'user' },
    signingSecret,
    { algorithm: 'HS256', expiresIn: '5m' },
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test('GET /embed/:id/loader.js returns JS', async () => {
  const request = require('supertest');
  const { embed } = await _setup('r1');
  const app = _app();

  const res = await request(app).get(`/embed/${embed.id}/loader.js`);
  assert.strictEqual(res.status, 200);
  assert.match(res.headers['content-type'], /javascript/);
  assert.ok(res.text.length > 100, 'loader.js should be at least 100 chars');
  assert.ok(res.text.includes('window.AOC_EMBED'), 'loader.js should define window.AOC_EMBED');
});

test('GET /embed/:id/loader.js 404 for unknown id', async () => {
  const request = require('supertest');
  await _setup('r1b'); // ensures DB is warmed
  const app = _app();

  const res = await request(app).get('/embed/non-existent-id/loader.js');
  assert.strictEqual(res.status, 404);
});

test('GET /embed/:id/config.json returns sanitized branding (no signingSecret, no embedToken)', async () => {
  const request = require('supertest');
  const { embed } = await _setup('r2');
  const app = _app();

  const res = await request(app).get(`/embed/${embed.id}/config.json`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.brandName, 'X');
  assert.strictEqual(res.body.welcomeTitle, 'Halo');
  assert.strictEqual(res.body.signingSecret, undefined, 'signingSecret must NOT be exposed');
  assert.strictEqual(res.body.embedToken, undefined, 'embedToken must NOT be exposed publicly');
});

test('POST /api/embed/session creates session with valid token + origin (private mode)', async () => {
  const request = require('supertest');
  const { embed } = await _setup('r3');
  const app = _app();

  // Build a valid private-mode visitor JWT
  const visitorJwt = makeVisitorJwt(embed.signingSecret, 'v-r3');

  const res = await request(app)
    .post('/api/embed/session')
    .set('X-Embed-Token', embed.embedToken)
    .set('Authorization', `Bearer ${visitorJwt}`)
    .set('Origin', 'https://x.com')
    .send({});

  assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert.ok(res.body.session_id, 'response should have session_id');
  assert.ok(res.body.session_token, 'response should have session_token');
  assert.strictEqual(res.body.welcome_title, 'Halo');
});

test('POST /api/embed/session rejects bad embed token', async () => {
  const request = require('supertest');
  await _setup('r4bad'); // warm DB
  const app = _app();

  const res = await request(app)
    .post('/api/embed/session')
    .set('X-Embed-Token', 'completely-invalid-token')
    .set('Origin', 'https://x.com')
    .send({ visitor_uuid: 'v-bad' });

  assert.strictEqual(res.status, 401);
});

test('POST /api/embed/message delegates to proxy and returns echo', async () => {
  const request = require('supertest');
  const { embed } = await _setup('r5');
  const app = _app();

  // First create a session
  const visitorJwt = makeVisitorJwt(embed.signingSecret, 'v-r5');
  const sessionRes = await request(app)
    .post('/api/embed/session')
    .set('X-Embed-Token', embed.embedToken)
    .set('Authorization', `Bearer ${visitorJwt}`)
    .set('Origin', 'https://x.com')
    .send({});
  assert.strictEqual(sessionRes.status, 200, `Session creation failed: ${JSON.stringify(sessionRes.body)}`);
  const sessionToken = sessionRes.body.session_token;

  // Now send a message using the session token
  const msgRes = await request(app)
    .post('/api/embed/message')
    .set('X-Embed-Token', embed.embedToken)
    .set('Authorization', `Bearer ${sessionToken}`)
    .set('Origin', 'https://x.com')
    .send({ content: 'Hi agent' });

  assert.strictEqual(msgRes.status, 200, `Message failed: ${JSON.stringify(msgRes.body)}`);
  assert.match(msgRes.body.text, /Echo: Hi agent/);
});

test('DELETE /api/embed/session clears session (204)', async () => {
  const request = require('supertest');
  const { embed } = await _setup('r6');
  const app = _app();

  // Create session first
  const visitorJwt = makeVisitorJwt(embed.signingSecret, 'v-r6');
  const sessionRes = await request(app)
    .post('/api/embed/session')
    .set('X-Embed-Token', embed.embedToken)
    .set('Authorization', `Bearer ${visitorJwt}`)
    .set('Origin', 'https://x.com')
    .send({});
  assert.strictEqual(sessionRes.status, 200, `Session creation failed: ${JSON.stringify(sessionRes.body)}`);
  const sessionToken = sessionRes.body.session_token;

  const delRes = await request(app)
    .delete('/api/embed/session')
    .set('X-Embed-Token', embed.embedToken)
    .set('Authorization', `Bearer ${sessionToken}`)
    .set('Origin', 'https://x.com');

  assert.strictEqual(delRes.status, 204);
});

// ─── Admin router tests ───────────────────────────────────────────────────────

/**
 * Build an Express app that mounts api + serve + admin routers.
 * Returns a JWT for the given user so tests can authenticate as that user.
 */
async function _adminSetup(prefix) {
  const { db } = setupDb();
  await db.initDatabase();

  // Create a user with a unique username
  const user = db.createUser({ username: `tadmin-${prefix}`, password: 'pw123', role: 'admin' });
  const userId = user.id;
  const token = db.generateToken(user);

  db.upsertAgentProfile({
    agentId: `ta-${prefix}`,
    role: 'main',
    provisionedBy: userId,
    avatarPresetId: '1',
    color: '#000',
  });

  return { db, userId, token };
}

function _adminApp() {
  const express = require('express');
  const cookieParser = require('cookie-parser');

  // Stub proxy so tests don't hit real gateway
  const proxyPath = require.resolve('../lib/embed/proxy.cjs');
  require.cache[proxyPath] = {
    exports: {
      handleMessage: async ({ content }) => ({
        status: 200,
        body: { text: `Echo: ${content}`, session_id: 'sess-stub', action: 'pass', redaction_count: 0 },
      }),
    },
    id: proxyPath,
    filename: proxyPath,
    loaded: true,
    children: [],
  };

  try { require('../lib/embed/kill-switch.cjs')._resetCacheForTests(); } catch (_) {}
  try { require('../lib/embed/rate-limit.cjs')._resetForTests(); } catch (_) {}

  const router = require('./embed.cjs');
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/embed', router.api);
  app.use('/embed', router.serve);
  app.use('/api/embed/admin', router.admin);
  return app;
}

test('POST /api/embed/admin/embeds creates embed (private mode) for authenticated user', async () => {
  const request = require('supertest');
  const { token, userId } = await _adminSetup('a1');
  const app = _adminApp();

  const res = await request(app)
    .post('/api/embed/admin/embeds')
    .set('Authorization', `Bearer ${token}`)
    .send({
      agentId: 'ta-a1',
      mode: 'private',
      productionOrigin: 'https://my.com',
      brandName: 'My Brand',
      welcomeTitle: 'Hi',
      dlpPreset: 'internal-tool-default',
    });

  assert.strictEqual(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert.ok(res.body.id, 'response should have id');
  assert.ok(res.body.embedToken, 'response should have embedToken');
  assert.ok(res.body.signingSecret, 'response should have signingSecret for private mode');
});

test('GET /api/embed/admin/embeds lists embeds for owner (strips secrets)', async () => {
  const request = require('supertest');
  const { db, token, userId } = await _adminSetup('a2');
  const app = _adminApp();

  // Create an embed directly via DB
  db.createEmbed({
    agentId: 'ta-a2',
    ownerId: userId,
    mode: 'private',
    productionOrigin: 'https://a2.com',
    brandName: 'A2 Brand',
    welcomeTitle: 'Hello',
    dlpPreset: 'internal-tool-default',
  });

  const res = await request(app)
    .get('/api/embed/admin/embeds')
    .set('Authorization', `Bearer ${token}`);

  assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert.ok(Array.isArray(res.body), 'response should be an array');
  assert.ok(res.body.length >= 1, 'should have at least one embed');
  // Secrets must be stripped in list view
  assert.strictEqual(res.body[0].signingSecret, undefined, 'signingSecret must be stripped from list');
  assert.strictEqual(res.body[0].turnstileSecret, undefined, 'turnstileSecret must be stripped from list');
});

test('PATCH /api/embed/admin/embeds/:id updates embed fields', async () => {
  const request = require('supertest');
  const { db, token, userId } = await _adminSetup('a3');
  const app = _adminApp();

  const embed = db.createEmbed({
    agentId: 'ta-a3',
    ownerId: userId,
    mode: 'private',
    productionOrigin: 'https://a3.com',
    brandName: 'A3 Brand',
    welcomeTitle: 'Old Title',
    dlpPreset: 'internal-tool-default',
  });

  const res = await request(app)
    .patch(`/api/embed/admin/embeds/${embed.id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ brandName: 'Updated Brand', welcomeTitle: 'New Title' });

  assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert.strictEqual(res.body.brandName, 'Updated Brand');
  assert.strictEqual(res.body.welcomeTitle, 'New Title');
});

test('POST /api/embed/admin/embeds/:id/toggle toggles kill switch', async () => {
  const request = require('supertest');
  const { db, token, userId } = await _adminSetup('a4');
  const app = _adminApp();

  const embed = db.createEmbed({
    agentId: 'ta-a4',
    ownerId: userId,
    mode: 'private',
    productionOrigin: 'https://a4.com',
    brandName: 'A4 Brand',
    welcomeTitle: 'Hi',
    dlpPreset: 'internal-tool-default',
  });

  // Toggle off (disable)
  const res = await request(app)
    .post(`/api/embed/admin/embeds/${embed.id}/toggle`)
    .set('Authorization', `Bearer ${token}`)
    .send({ enabled: false, mode: 'maintenance' });

  assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert.strictEqual(res.body.ok, true);
  assert.strictEqual(res.body.enabled, false);

  // Verify DB reflects the change
  const updated = db.getEmbedById(embed.id);
  assert.strictEqual(updated.enabled, 0);
  assert.strictEqual(updated.disableMode, 'maintenance');
});

test('POST /api/embed/admin/disable-all disables all owner embeds', async () => {
  const request = require('supertest');
  const { db, token, userId } = await _adminSetup('a5');
  const app = _adminApp();

  // Create two embeds
  const e1 = db.createEmbed({
    agentId: 'ta-a5',
    ownerId: userId,
    mode: 'private',
    productionOrigin: 'https://a5a.com',
    brandName: 'A5a',
    welcomeTitle: 'Hi',
    dlpPreset: 'internal-tool-default',
  });
  const e2 = db.createEmbed({
    agentId: 'ta-a5',
    ownerId: userId,
    mode: 'private',
    productionOrigin: 'https://a5b.com',
    brandName: 'A5b',
    welcomeTitle: 'Hi',
    dlpPreset: 'internal-tool-default',
  });

  const res = await request(app)
    .post('/api/embed/admin/disable-all')
    .set('Authorization', `Bearer ${token}`)
    .send({ mode: 'emergency' });

  assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert.ok(Array.isArray(res.body.disabled), 'disabled should be an array');
  assert.ok(res.body.disabled.length >= 2, 'should have disabled at least 2 embeds');

  // Verify both are disabled
  const r1 = db.getEmbedById(e1.id);
  const r2 = db.getEmbedById(e2.id);
  assert.strictEqual(r1.enabled, 0, 'first embed should be disabled');
  assert.strictEqual(r2.enabled, 0, 'second embed should be disabled');
});

// ─── typingPhrases validation + roundtrip (admin PATCH) ──────────────────────

test('PATCH /api/embed/admin/embeds/:id rejects typingPhrases array of 6 entries → 400', async () => {
  const request = require('supertest');
  const { db, token, userId } = await _adminSetup('tp-v1');
  const app = _adminApp();

  const embed = db.createEmbed({
    agentId: 'ta-tp-v1', ownerId: userId, mode: 'private',
    productionOrigin: 'https://tp1.com', brandName: 'TP1',
    welcomeTitle: 'Hi', dlpPreset: 'internal-tool-default',
  });

  const res = await request(app)
    .patch(`/api/embed/admin/embeds/${embed.id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ typingPhrases: ['a', 'b', 'c', 'd', 'e', 'f'] });

  assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert.ok(res.body.error.includes('max 5'), `Expected "max 5" in error, got: ${res.body.error}`);
});

test('PATCH /api/embed/admin/embeds/:id rejects typingPhrases entry of 81 chars → 400', async () => {
  const request = require('supertest');
  const { db, token, userId } = await _adminSetup('tp-v2');
  const app = _adminApp();

  const embed = db.createEmbed({
    agentId: 'ta-tp-v2', ownerId: userId, mode: 'private',
    productionOrigin: 'https://tp2.com', brandName: 'TP2',
    welcomeTitle: 'Hi', dlpPreset: 'internal-tool-default',
  });

  const longPhrase = 'x'.repeat(81);
  const res = await request(app)
    .patch(`/api/embed/admin/embeds/${embed.id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ typingPhrases: [longPhrase] });

  assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert.ok(res.body.error.includes('1-80'), `Expected "1-80" in error, got: ${res.body.error}`);
});

test('PATCH /api/embed/admin/embeds/:id rejects typingPhrases with empty string entry → 400', async () => {
  const request = require('supertest');
  const { db, token, userId } = await _adminSetup('tp-v3');
  const app = _adminApp();

  const embed = db.createEmbed({
    agentId: 'ta-tp-v3', ownerId: userId, mode: 'private',
    productionOrigin: 'https://tp3.com', brandName: 'TP3',
    welcomeTitle: 'Hi', dlpPreset: 'internal-tool-default',
  });

  const res = await request(app)
    .patch(`/api/embed/admin/embeds/${embed.id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ typingPhrases: ['Halo', ''] });

  assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert.ok(res.body.error.includes('1-80'), `Expected "1-80" in error, got: ${res.body.error}`);
});

test('PATCH /api/embed/admin/embeds/:id with valid typingPhrases → 200, GET returns same array', async () => {
  const request = require('supertest');
  const { db, token, userId } = await _adminSetup('tp-v4');
  const app = _adminApp();

  const embed = db.createEmbed({
    agentId: 'ta-tp-v4', ownerId: userId, mode: 'private',
    productionOrigin: 'https://tp4.com', brandName: 'TP4',
    welcomeTitle: 'Hi', dlpPreset: 'internal-tool-default',
  });

  const phrases = ['Halo!', 'Sebentar...', 'Mengetik'];
  const patchRes = await request(app)
    .patch(`/api/embed/admin/embeds/${embed.id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ typingPhrases: phrases });

  assert.strictEqual(patchRes.status, 200, `Expected 200, got ${patchRes.status}: ${JSON.stringify(patchRes.body)}`);
  assert.deepStrictEqual(patchRes.body.typingPhrases, phrases, 'PATCH response should include updated typingPhrases');

  // GET to verify persistence
  const getRes = await request(app)
    .get(`/api/embed/admin/embeds/${embed.id}`)
    .set('Authorization', `Bearer ${token}`);

  assert.strictEqual(getRes.status, 200);
  assert.deepStrictEqual(getRes.body.typingPhrases, phrases, 'GET should return the same typingPhrases');
});

test('PATCH /api/embed/admin/embeds/:id with typingPhrases null → 200, GET returns null', async () => {
  const request = require('supertest');
  const { db, token, userId } = await _adminSetup('tp-v5');
  const app = _adminApp();

  const embed = db.createEmbed({
    agentId: 'ta-tp-v5', ownerId: userId, mode: 'private',
    productionOrigin: 'https://tp5.com', brandName: 'TP5',
    welcomeTitle: 'Hi', dlpPreset: 'internal-tool-default',
  });

  // First set a value
  await request(app)
    .patch(`/api/embed/admin/embeds/${embed.id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ typingPhrases: ['Sebentar'] });

  // Then set to null
  const patchRes = await request(app)
    .patch(`/api/embed/admin/embeds/${embed.id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ typingPhrases: null });

  assert.strictEqual(patchRes.status, 200, `Expected 200, got ${patchRes.status}: ${JSON.stringify(patchRes.body)}`);
  assert.strictEqual(patchRes.body.typingPhrases, null, 'PATCH response should have typingPhrases: null');

  // GET to verify persistence
  const getRes = await request(app)
    .get(`/api/embed/admin/embeds/${embed.id}`)
    .set('Authorization', `Bearer ${token}`);

  assert.strictEqual(getRes.status, 200);
  assert.strictEqual(getRes.body.typingPhrases, null, 'GET should return null typingPhrases');
});

test('PATCH /api/embed/admin/embeds/:id rejects avatarUrl with external URL → 400', async () => {
  const request = require('supertest');
  const { db, token, userId } = await _adminSetup('au-v1');
  const app = _adminApp();

  const embed = db.createEmbed({
    agentId: 'ta-au-v1', ownerId: userId, mode: 'private',
    productionOrigin: 'https://au1.com', brandName: 'AU1',
    welcomeTitle: 'Hi', dlpPreset: 'internal-tool-default',
  });

  const res = await request(app)
    .patch(`/api/embed/admin/embeds/${embed.id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ avatarUrl: 'https://evil.com/avatar.png' });

  assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert.ok(res.body.error.includes('/embed-uploads/'), `Expected /embed-uploads/ in error, got: ${res.body.error}`);
});

test('PATCH /api/embed/admin/embeds/:id accepts avatarUrl null → 200', async () => {
  const request = require('supertest');
  const { db, token, userId } = await _adminSetup('au-v2');
  const app = _adminApp();

  const embed = db.createEmbed({
    agentId: 'ta-au-v2', ownerId: userId, mode: 'private',
    productionOrigin: 'https://au2.com', brandName: 'AU2',
    welcomeTitle: 'Hi', dlpPreset: 'internal-tool-default',
  });

  const res = await request(app)
    .patch(`/api/embed/admin/embeds/${embed.id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ avatarUrl: null });

  assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
});

test('PATCH /api/embed/admin/embeds/:id accepts avatarUrl with /embed-uploads/ path → 200', async () => {
  const request = require('supertest');
  const { db, token, userId } = await _adminSetup('au-v3');
  const app = _adminApp();

  const embed = db.createEmbed({
    agentId: 'ta-au-v3', ownerId: userId, mode: 'private',
    productionOrigin: 'https://au3.com', brandName: 'AU3',
    welcomeTitle: 'Hi', dlpPreset: 'internal-tool-default',
  });

  const res = await request(app)
    .patch(`/api/embed/admin/embeds/${embed.id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ avatarUrl: `/embed-uploads/${embed.id}/avatar.png` });

  assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
});

// ─── Playground traffic_type tests ───────────────────────────────────────────

/**
 * Set up a fresh DB with an owner user, agent, and embed for playground tests.
 * Returns the full user object so we can generate a dashboard JWT.
 */
async function _playgroundSetup(prefix) {
  const { db } = setupDb();
  await db.initDatabase();

  const user = db.createUser({ username: `pg-user-${prefix}`, password: 'pw123', role: 'admin' });
  const userId = user.id;
  const ownerJwt = db.generateToken(user);

  db.upsertAgentProfile({
    agentId: `pg-a-${prefix}`,
    role: 'main',
    provisionedBy: userId,
    avatarPresetId: '1',
    color: '#000',
  });
  const embed = db.createEmbed({
    agentId: `pg-a-${prefix}`,
    ownerId: userId,
    mode: 'private',
    productionOrigin: 'https://x.com',
    brandName: 'PG Brand',
    welcomeTitle: 'Halo',
    dlpPreset: 'internal-tool-default',
    dailyMessageQuota: 5,
    dailyTokenQuota: 500,
  });

  return { db, userId, user, ownerJwt, embed };
}

test('POST /api/embed/session: playground flag without owner JWT → 403', async () => {
  const request = require('supertest');
  const { embed } = await _playgroundSetup('pg1');
  const app = _app();

  const res = await request(app)
    .post('/api/embed/session')
    .set('X-Embed-Token', embed.embedToken)
    .set('Origin', 'https://x.com')
    .send({ playground: true });

  assert.strictEqual(res.status, 403, `Expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert.ok(res.body.error.includes('owner authentication'), `Expected owner auth error, got: ${res.body.error}`);
});

test('POST /api/embed/session: playground flag with invalid JWT → 403', async () => {
  const request = require('supertest');
  const { embed } = await _playgroundSetup('pg2');
  const app = _app();

  const res = await request(app)
    .post('/api/embed/session')
    .set('X-Embed-Token', embed.embedToken)
    .set('Authorization', 'Bearer this.is.not.valid')
    .set('Origin', 'https://x.com')
    .send({ playground: true });

  assert.strictEqual(res.status, 403, `Expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
});

test('POST /api/embed/session: playground flag with owner JWT → 200 + traffic_type=playground in DB', async () => {
  const request = require('supertest');
  const { db, ownerJwt, embed } = await _playgroundSetup('pg3');
  const app = _app();

  const res = await request(app)
    .post('/api/embed/session')
    .set('X-Embed-Token', embed.embedToken)
    .set('Authorization', `Bearer ${ownerJwt}`)
    .set('Origin', 'https://x.com')
    .send({ playground: true });

  assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert.ok(res.body.session_id, 'response should have session_id');
  assert.ok(res.body.session_token, 'response should have session_token');

  // Verify DB row has traffic_type = 'playground'
  const session = db.getSessionById(res.body.session_id);
  assert.ok(session, 'session should exist in DB');
  assert.strictEqual(session.trafficType, 'playground', 'session traffic_type should be playground');
});

test('POST /api/embed/session: playground from non-owner non-admin JWT → 403', async () => {
  const request = require('supertest');
  const { db, embed } = await _playgroundSetup('pg4');
  const app = _app();

  // Create a different user (not the embed owner, and not admin — role='user')
  const otherUser = db.createUser({ username: 'pg-other-pg4', password: 'pw123', role: 'user' });
  const otherJwt = db.generateToken(otherUser);

  const res = await request(app)
    .post('/api/embed/session')
    .set('X-Embed-Token', embed.embedToken)
    .set('Authorization', `Bearer ${otherJwt}`)
    .set('Origin', 'https://x.com')
    .send({ playground: true });

  assert.strictEqual(res.status, 403, `Expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert.ok(res.body.error.includes('owner authentication'), `Expected owner auth error, got: ${res.body.error}`);
});

test('POST /api/embed/session: playground from admin JWT (not owner) → 200 (admin bypass)', async () => {
  const request = require('supertest');
  const { db, embed } = await _playgroundSetup('pg4b');
  const app = _app();

  // Admin users can access playground for any embed (same pattern as other admin bypass in embed admin routes)
  const adminUser = db.createUser({ username: 'pg-admin-pg4b', password: 'pw123', role: 'admin' });
  const adminJwt = db.generateToken(adminUser);

  const res = await request(app)
    .post('/api/embed/session')
    .set('X-Embed-Token', embed.embedToken)
    .set('Authorization', `Bearer ${adminJwt}`)
    .set('Origin', 'https://x.com')
    .send({ playground: true });

  assert.strictEqual(res.status, 200, `Expected 200 for admin, got ${res.status}: ${JSON.stringify(res.body)}`);
  const session = db.getSessionById(res.body.session_id);
  assert.strictEqual(session.trafficType, 'playground', 'admin playground should have trafficType=playground');
});

test('POST /api/embed/session: production session unaffected (quota still enforced on message)', async () => {
  const request = require('supertest');
  const { embed } = await _playgroundSetup('pg5');
  const app = _app();

  // A normal private-mode production session works as before
  const visitorJwt = makeVisitorJwt(embed.signingSecret, 'v-pg5');
  const res = await request(app)
    .post('/api/embed/session')
    .set('X-Embed-Token', embed.embedToken)
    .set('Authorization', `Bearer ${visitorJwt}`)
    .set('Origin', 'https://x.com')
    .send({});

  assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert.ok(res.body.session_id, 'should have session_id');
});

test('POST /api/embed/session: playground bypasses daily message quota (quota burned for production)', async () => {
  const request = require('supertest');
  const { db, ownerJwt, embed } = await _playgroundSetup('pg6');
  const app = _app();

  // Burn production quota to the limit (directly via DB)
  const quotaMod = require('../lib/embed/quota.cjs');
  const today = quotaMod._today();
  quotaMod.incrementDailyMetric(embed.id, embed.ownerId, today, 'production', {
    messageDelta: embed.dailyMessageQuota,
  });

  // Playground session should still be created (not subject to production quota)
  const res = await request(app)
    .post('/api/embed/session')
    .set('X-Embed-Token', embed.embedToken)
    .set('Authorization', `Bearer ${ownerJwt}`)
    .set('Origin', 'https://x.com')
    .send({ playground: true });

  assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
  const session = db.getSessionById(res.body.session_id);
  assert.strictEqual(session.trafficType, 'playground', 'must be playground session');
});

test('POST /api/embed/session: agent-service token rejected for playground → 403', async () => {
  const request = require('supertest');
  const { db, userId, embed } = await _playgroundSetup('pg7');
  const app = _app();

  // Mint an agent-service token (not a dashboard user JWT)
  const agentToken = db.generateAgentServiceToken({ agentId: `pg-a-pg7`, ownerId: userId });

  const res = await request(app)
    .post('/api/embed/session')
    .set('X-Embed-Token', embed.embedToken)
    .set('Authorization', `Bearer ${agentToken}`)
    .set('Origin', 'https://x.com')
    .send({ playground: true });

  assert.strictEqual(res.status, 403, `Expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert.ok(
    res.body.error.includes('agent token') || res.body.error.includes('owner authentication'),
    `Expected agent token error, got: ${res.body.error}`,
  );
});

// ─── typingPhrases in public config.json ─────────────────────────────────────

test('GET /embed/:id/config.json includes typingPhrases when set via PATCH', async () => {
  const request = require('supertest');
  const { db, token, userId } = await _adminSetup('cfg-tp1');
  const app = _adminApp();

  const embed = db.createEmbed({
    agentId: 'ta-cfg-tp1', ownerId: userId, mode: 'private',
    productionOrigin: 'https://cfg-tp1.com', brandName: 'CFG1',
    welcomeTitle: 'Hi', dlpPreset: 'internal-tool-default',
  });

  // PATCH to set typingPhrases
  const phrases = ['A', 'B'];
  const patchRes = await request(app)
    .patch(`/api/embed/admin/embeds/${embed.id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ typingPhrases: phrases });
  assert.strictEqual(patchRes.status, 200, `PATCH failed: ${JSON.stringify(patchRes.body)}`);

  // GET config.json (public route — no auth needed)
  const cfgRes = await request(app).get(`/embed/${embed.id}/config.json`);
  assert.strictEqual(cfgRes.status, 200, `config.json failed: ${JSON.stringify(cfgRes.body)}`);
  assert.deepStrictEqual(cfgRes.body.typingPhrases, phrases,
    `Expected typingPhrases ${JSON.stringify(phrases)}, got ${JSON.stringify(cfgRes.body.typingPhrases)}`);
});

test('GET /embed/:id/config.json returns typingPhrases as null when not set', async () => {
  const request = require('supertest');
  const { db, userId } = await _adminSetup('cfg-tp2');
  const app = _adminApp();

  const embed = db.createEmbed({
    agentId: 'ta-cfg-tp2', ownerId: userId, mode: 'private',
    productionOrigin: 'https://cfg-tp2.com', brandName: 'CFG2',
    welcomeTitle: 'Hi', dlpPreset: 'internal-tool-default',
  });

  // No PATCH — typingPhrases should be null by default
  const cfgRes = await request(app).get(`/embed/${embed.id}/config.json`);
  assert.strictEqual(cfgRes.status, 200, `config.json failed: ${JSON.stringify(cfgRes.body)}`);
  // Match convention: field present and null (same as welcomeSubtitle, avatarUrl etc.)
  assert.ok('typingPhrases' in cfgRes.body,
    'typingPhrases field must be present in config.json response');
  assert.strictEqual(cfgRes.body.typingPhrases, null,
    `Expected typingPhrases to be null, got ${JSON.stringify(cfgRes.body.typingPhrases)}`);
});

// ─── DLP tester route tests ───────────────────────────────────────────────────

/**
 * Setup for dlp-test route tests: owner user + embed + dashboard JWT.
 */
async function _dlpTestSetup(prefix) {
  const { db } = setupDb();
  await db.initDatabase();

  const user = db.createUser({ username: `dlp-user-${prefix}`, password: 'pw123', role: 'admin' });
  const userId = user.id;
  const ownerJwt = db.generateToken(user);

  db.upsertAgentProfile({
    agentId: `dlp-a-${prefix}`,
    role: 'main',
    provisionedBy: userId,
    avatarPresetId: '1',
    color: '#000',
  });
  const embed = db.createEmbed({
    agentId: `dlp-a-${prefix}`,
    ownerId: userId,
    mode: 'private',
    productionOrigin: 'https://dlp-test.com',
    brandName: 'DLP Test',
    welcomeTitle: 'Hi',
    dlpPreset: 'customer-service-default',
  });

  return { db, userId, user, ownerJwt, embed };
}

test('POST /api/embed/admin/embeds/:id/dlp-test: 200 with matches when text has email (customer-service preset)', async () => {
  const request = require('supertest');
  const { ownerJwt, embed } = await _dlpTestSetup('dt1');
  const app = _adminApp();

  const res = await request(app)
    .post(`/api/embed/admin/embeds/${embed.id}/dlp-test`)
    .set('Authorization', `Bearer ${ownerJwt}`)
    .send({ text: 'Contact admin@example.com for support' });

  assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert.ok(Array.isArray(res.body.matches), 'matches should be array');
  assert.ok(res.body.matches.length > 0, 'should have at least one match for email');
  assert.ok(typeof res.body.redacted === 'string', 'redacted should be string');
  assert.ok(res.body.redacted.includes('[redacted:'), 'redacted should contain redaction marker');
  assert.ok(Array.isArray(res.body.warnings), 'warnings should be array');

  const emailMatch = res.body.matches.find(m => m.type === 'pii-email');
  assert.ok(emailMatch, 'should have a pii-email match');
  assert.ok(emailMatch.text === 'admin@example.com', `match text should be email, got ${emailMatch.text}`);
});

test('POST /api/embed/admin/embeds/:id/dlp-test: 403 when JWT not owner / not admin', async () => {
  const request = require('supertest');
  const { db, embed } = await _dlpTestSetup('dt2');
  const app = _adminApp();

  // Create a different non-admin user who does NOT own this embed
  const otherUser = db.createUser({ username: 'dlp-other-dt2', password: 'pw123', role: 'user' });
  const otherJwt = db.generateToken(otherUser);

  const res = await request(app)
    .post(`/api/embed/admin/embeds/${embed.id}/dlp-test`)
    .set('Authorization', `Bearer ${otherJwt}`)
    .send({ text: 'Test text' });

  assert.strictEqual(res.status, 403, `Expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert.ok(res.body.error === 'forbidden', `Expected forbidden, got: ${res.body.error}`);
});

test('POST /api/embed/admin/embeds/:id/dlp-test: 400 when text > 10_000 chars', async () => {
  const request = require('supertest');
  const { ownerJwt, embed } = await _dlpTestSetup('dt3');
  const app = _adminApp();

  const longText = 'a'.repeat(10_001);

  const res = await request(app)
    .post(`/api/embed/admin/embeds/${embed.id}/dlp-test`)
    .set('Authorization', `Bearer ${ownerJwt}`)
    .send({ text: longText });

  assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert.ok(
    res.body.error === 'text_too_long' || (res.body.error && res.body.error.includes('too_long')),
    `Expected text_too_long error, got: ${res.body.error}`,
  );
});

test('POST /api/embed/admin/embeds/:id/dlp-test: 401 when no JWT', async () => {
  const request = require('supertest');
  const { embed } = await _dlpTestSetup('dt4');
  const app = _adminApp();

  const res = await request(app)
    .post(`/api/embed/admin/embeds/${embed.id}/dlp-test`)
    .send({ text: 'Test text' });

  // authMiddleware returns 401 when no JWT provided
  assert.ok(res.status === 401 || res.status === 403, `Expected 401 or 403, got ${res.status}`);
});

test('POST /api/embed/admin/embeds/:id/dlp-test: allowlistOverride overrides saved patterns', async () => {
  const request = require('supertest');
  const { db, ownerJwt, embed } = await _dlpTestSetup('dt5');
  const app = _adminApp();

  // First: without allowlist — expect email match
  const resWithout = await request(app)
    .post(`/api/embed/admin/embeds/${embed.id}/dlp-test`)
    .set('Authorization', `Bearer ${ownerJwt}`)
    .send({ text: 'Contact admin@example.com' });

  assert.strictEqual(resWithout.status, 200);
  assert.ok(resWithout.body.matches.length > 0, 'without allowlist: should have matches');

  // Second: with allowlistOverride matching the email — expect no matches
  const resWith = await request(app)
    .post(`/api/embed/admin/embeds/${embed.id}/dlp-test`)
    .set('Authorization', `Bearer ${ownerJwt}`)
    .send({
      text: 'Contact admin@example.com',
      allowlistOverride: ['admin@example.com'],
    });

  assert.strictEqual(resWith.status, 200);
  assert.strictEqual(resWith.body.matches.length, 0, 'with allowlistOverride: email should be exempted');
  assert.ok(resWith.body.redacted.includes('admin@example.com'), 'allowlisted email should appear unredacted');
});

test('POST /api/embed/admin/embeds/:id/dlp-test: 400 when text is not a string', async () => {
  const request = require('supertest');
  const { ownerJwt, embed } = await _dlpTestSetup('dt6');
  const app = _adminApp();

  const res = await request(app)
    .post(`/api/embed/admin/embeds/${embed.id}/dlp-test`)
    .set('Authorization', `Bearer ${ownerJwt}`)
    .send({ text: 12345 });

  assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
});

test('POST /api/embed/admin/embeds/:id/dlp-test: admin (non-owner) can test any embed', async () => {
  const request = require('supertest');
  const { db, embed } = await _dlpTestSetup('dt7');
  const app = _adminApp();

  // Create a separate admin user who does NOT own this embed
  const adminUser = db.createUser({ username: 'dlp-superadmin-dt7', password: 'pw123', role: 'admin' });
  const adminJwt = db.generateToken(adminUser);

  const res = await request(app)
    .post(`/api/embed/admin/embeds/${embed.id}/dlp-test`)
    .set('Authorization', `Bearer ${adminJwt}`)
    .send({ text: 'Contact admin@example.com' });

  assert.strictEqual(res.status, 200, `Expected 200 for admin, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert.ok(Array.isArray(res.body.matches), 'admin: matches should be array');
});

test('POST /api/embed/admin/embeds/:id/dlp-test: agent-service token → 403', async () => {
  const request = require('supertest');
  const { db, userId, embed } = await _dlpTestSetup('dt8');
  const app = _adminApp();

  const agentToken = db.generateAgentServiceToken({ agentId: `dlp-a-dt8`, ownerId: userId });

  const res = await request(app)
    .post(`/api/embed/admin/embeds/${embed.id}/dlp-test`)
    .set('Authorization', `Bearer ${agentToken}`)
    .send({ text: 'Contact admin@example.com' });

  assert.strictEqual(res.status, 403, `Expected 403 for agent-service token, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert.strictEqual(res.body.error, 'agent_service_token_not_allowed');
});

// ─── Avatar upload route tests ────────────────────────────────────────────────

/**
 * Setup for avatar upload route tests.
 * Uses _adminSetup which creates an admin user + agent + JWT.
 */
async function _avatarSetup(prefix) {
  const { db } = setupDb();
  await db.initDatabase();

  const user = db.createUser({ username: `av-user-${prefix}`, password: 'pw123', role: 'admin' });
  const userId = user.id;
  const ownerJwt = db.generateToken(user);

  db.upsertAgentProfile({
    agentId: `av-a-${prefix}`,
    role: 'main',
    provisionedBy: userId,
    avatarPresetId: '1',
    color: '#000',
  });

  const embed = db.createEmbed({
    agentId: `av-a-${prefix}`,
    ownerId: userId,
    mode: 'private',
    productionOrigin: 'https://av-test.com',
    brandName: 'AV Brand',
    welcomeTitle: 'Hi',
    dlpPreset: 'internal-tool-default',
  });

  return { db, userId, user, ownerJwt, embed };
}

/**
 * Build a minimal PNG buffer (1x1 white pixel) that passes mime validation.
 * Since we're using multer memoryStorage, the buffer is passed as-is.
 */
function _minimalPngBuffer() {
  // A valid 1x1 PNG — 68 bytes
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, // IDAT chunk
    0x54, 0x08, 0xd7, 0x63, 0xf8, 0xff, 0xff, 0x3f,
    0x00, 0x05, 0xfe, 0x02, 0xfe, 0xdc, 0xcc, 0x59,
    0xe7, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, // IEND chunk
    0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
}

test('POST /api/embed/admin/embeds/:id/avatar: valid PNG → 200, avatarUrl returned', async () => {
  const request = require('supertest');
  const { db, ownerJwt, embed } = await _avatarSetup('av1');
  const app = _adminApp();

  const res = await request(app)
    .post(`/api/embed/admin/embeds/${embed.id}/avatar`)
    .set('Authorization', `Bearer ${ownerJwt}`)
    .attach('file', _minimalPngBuffer(), { filename: 'avatar.png', contentType: 'image/png' });

  assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert.ok(res.body.avatarUrl, 'response should have avatarUrl');
  assert.ok(
    res.body.avatarUrl.startsWith('/embed-uploads/'),
    `avatarUrl should start with /embed-uploads/, got: ${res.body.avatarUrl}`,
  );

  // DB should be updated
  const updated = db.getEmbedById(embed.id);
  assert.strictEqual(updated.avatarSource, 'custom', 'avatarSource should be custom after upload');
  assert.ok(updated.avatarUrl && updated.avatarUrl.includes('avatar.png'), 'avatarUrl should contain avatar.png');
});

test('POST /api/embed/admin/embeds/:id/avatar: without file → 400', async () => {
  const request = require('supertest');
  const { ownerJwt, embed } = await _avatarSetup('av2');
  const app = _adminApp();

  // Send JSON body (no multipart) — multer will leave req.file undefined
  // and the route should return 400 "file required"
  const res = await request(app)
    .post(`/api/embed/admin/embeds/${embed.id}/avatar`)
    .set('Authorization', `Bearer ${ownerJwt}`)
    .send({});

  assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert.ok(res.body.error, 'response should have error field');
});

test('POST /api/embed/admin/embeds/:id/avatar: cross-owner → 403', async () => {
  const request = require('supertest');
  const { db, embed } = await _avatarSetup('av3');
  const app = _adminApp();

  // Create a different user (non-admin) who does NOT own this embed
  const otherUser = db.createUser({ username: 'av-other-av3', password: 'pw123', role: 'user' });
  const otherJwt = db.generateToken(otherUser);

  const res = await request(app)
    .post(`/api/embed/admin/embeds/${embed.id}/avatar`)
    .set('Authorization', `Bearer ${otherJwt}`)
    .attach('file', _minimalPngBuffer(), { filename: 'avatar.png', contentType: 'image/png' });

  assert.strictEqual(res.status, 403, `Expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
});

test('POST /api/embed/admin/embeds/:id/avatar: admin JWT (not owner) → 200', async () => {
  const request = require('supertest');
  const { db, embed } = await _avatarSetup('av4');
  const app = _adminApp();

  // Create a separate admin who does NOT own this embed — admin bypass should allow
  const adminUser = db.createUser({ username: 'av-admin-av4', password: 'pw123', role: 'admin' });
  const adminJwt = db.generateToken(adminUser);

  const res = await request(app)
    .post(`/api/embed/admin/embeds/${embed.id}/avatar`)
    .set('Authorization', `Bearer ${adminJwt}`)
    .attach('file', _minimalPngBuffer(), { filename: 'avatar.png', contentType: 'image/png' });

  assert.strictEqual(res.status, 200, `Expected 200 for admin bypass, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert.ok(res.body.avatarUrl, 'response should have avatarUrl');
});

test('POST /api/embed/admin/embeds/:id/avatar: agent-service token → 403', async () => {
  const request = require('supertest');
  const { db, userId, embed } = await _avatarSetup('av5');
  const app = _adminApp();

  const agentToken = db.generateAgentServiceToken({ agentId: `av-a-av5`, ownerId: userId });

  const res = await request(app)
    .post(`/api/embed/admin/embeds/${embed.id}/avatar`)
    .set('Authorization', `Bearer ${agentToken}`)
    .attach('file', _minimalPngBuffer(), { filename: 'avatar.png', contentType: 'image/png' });

  assert.strictEqual(res.status, 403, `Expected 403 for agent-service token, got ${res.status}: ${JSON.stringify(res.body)}`);
});

test('DELETE /api/embed/admin/embeds/:id/avatar: removes file, reverts DB to avatarSource=agent, avatarUrl=null', async () => {
  const request = require('supertest');
  const { db, ownerJwt, embed } = await _avatarSetup('av6');
  const app = _adminApp();

  // Upload first
  const uploadRes = await request(app)
    .post(`/api/embed/admin/embeds/${embed.id}/avatar`)
    .set('Authorization', `Bearer ${ownerJwt}`)
    .attach('file', _minimalPngBuffer(), { filename: 'avatar.png', contentType: 'image/png' });
  assert.strictEqual(uploadRes.status, 200, `Upload failed: ${JSON.stringify(uploadRes.body)}`);

  // Verify upload updated DB
  const afterUpload = db.getEmbedById(embed.id);
  assert.strictEqual(afterUpload.avatarSource, 'custom');

  // Delete
  const delRes = await request(app)
    .delete(`/api/embed/admin/embeds/${embed.id}/avatar`)
    .set('Authorization', `Bearer ${ownerJwt}`);

  assert.strictEqual(delRes.status, 200, `Expected 200, got ${delRes.status}: ${JSON.stringify(delRes.body)}`);
  assert.strictEqual(delRes.body.ok, true, 'response should have ok: true');

  // DB reverted
  const afterDelete = db.getEmbedById(embed.id);
  assert.strictEqual(afterDelete.avatarSource, 'agent', 'avatarSource should revert to agent');
  assert.strictEqual(afterDelete.avatarUrl, null, 'avatarUrl should be null after delete');
});

test('GET /embed/:id/config.json after custom upload → avatarUrl is absolute URL', async () => {
  const request = require('supertest');
  const { db, ownerJwt, embed } = await _avatarSetup('av7');
  const app = _adminApp();

  // Upload a custom avatar
  const uploadRes = await request(app)
    .post(`/api/embed/admin/embeds/${embed.id}/avatar`)
    .set('Authorization', `Bearer ${ownerJwt}`)
    .attach('file', _minimalPngBuffer(), { filename: 'avatar.png', contentType: 'image/png' });
  assert.strictEqual(uploadRes.status, 200, `Upload failed: ${JSON.stringify(uploadRes.body)}`);

  // GET config.json — avatarUrl should be absolute
  const cfgRes = await request(app)
    .get(`/embed/${embed.id}/config.json`);

  assert.strictEqual(cfgRes.status, 200, `config.json failed: ${JSON.stringify(cfgRes.body)}`);
  assert.ok(cfgRes.body.avatarUrl, 'avatarUrl should be present');
  assert.ok(
    cfgRes.body.avatarUrl.startsWith('http://') || cfgRes.body.avatarUrl.startsWith('https://'),
    `avatarUrl should be absolute, got: ${cfgRes.body.avatarUrl}`,
  );
  assert.ok(
    cfgRes.body.avatarUrl.includes('/embed-uploads/'),
    `avatarUrl should contain /embed-uploads/, got: ${cfgRes.body.avatarUrl}`,
  );
});
