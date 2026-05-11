// server/lib/embed/proxy.test.cjs
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');

// AOC_DLP_MASTER_KEY MUST be set BEFORE any require that pulls in encryption.cjs
process.env.AOC_DLP_MASTER_KEY = crypto.randomBytes(32).toString('hex');

// ---------------------------------------------------------------------------
// Helpers — mirror the audit-log.test.cjs pattern exactly
// ---------------------------------------------------------------------------

function setupDb() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aocdb-proxy-'));
  process.env.AOC_DATA_DIR = tmpDir;
  // Clear require cache so each test gets a fresh db + embed module instances
  Object.keys(require.cache).forEach(k => {
    if (k.includes('/server/lib/db') || k.includes('/server/lib/embed/')) {
      delete require.cache[k];
    }
  });
  const db = require('../db.cjs');
  return { db, tmpDir };
}

// createUser takes { username, password, role } — NOT { email, passwordHash }
function makeUser(db, suffix) {
  const user = db.createUser({ username: `test-${suffix}`, password: 'password123', role: 'admin' });
  return user.id;
}

async function _setup(prefix) {
  const { db } = setupDb();
  await db.initDatabase();

  const userId = makeUser(db, prefix);
  const agentId = `a-${prefix}`;
  db.upsertAgentProfile({
    agentId, role: 'main', provisionedBy: userId,
    avatarPresetId: '1', color: '#000',
  });
  const embed = db.createEmbed({
    agentId, ownerId: userId, mode: 'private',
    productionOrigin: 'https://x.com', brandName: 'X',
    welcomeTitle: 'X', dlpPreset: 'internal-tool-default',
  });

  // Reset encryption master key cache so the fresh DB env is picked up
  const enc = require('./encryption.cjs');
  enc._resetMasterKeyCacheForTests();

  // Reset kill-switch cache so stale entries from a previous test don't bleed in
  const ks = require('./kill-switch.cjs');
  ks._resetCacheForTests();

  // Reset rate-limiter so per-IP counters from previous tests don't bleed in
  const rl = require('./rate-limit.cjs');
  rl._resetForTests();

  const proxy = require('./proxy.cjs');

  return { db, userId, embedId: embed.id, embedToken: embed.embedToken, proxy };
}

// ---------------------------------------------------------------------------
// Stub providers and gateways
// ---------------------------------------------------------------------------

const cleanProvider = {
  async generate() {
    return { text: '{"clean": true, "redactions": []}' };
  },
};

const stubGateway = {
  async sendMessage({ content }) {
    return { text: `Echo: ${content}`, tokens: { in: 10, out: 12 } };
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Test 1 — kill switch off → 503 + code 'embed_disabled'
test('handleMessage rejects when kill switch off', async () => {
  const { db, embedId, embedToken, proxy } = await _setup('p1');
  db.updateEmbed(embedId, { enabled: 0, disableMode: 'maintenance' });

  const r = await proxy.handleMessage({
    embedToken,
    origin: 'https://x.com',
    visitorUuid: 'v1',
    content: 'hello',
    clientIp: '1.2.3.4',
    dlpProvider: cleanProvider,
    gateway: stubGateway,
  });

  assert.strictEqual(r.status, 503);
  assert.strictEqual(r.code, 'embed_disabled');
});

// Test 2 — bad origin → 403
test('handleMessage rejects bad origin', async () => {
  const { embedToken, proxy } = await _setup('p2');

  const r = await proxy.handleMessage({
    embedToken,
    origin: 'https://attacker.com',
    visitorUuid: 'v2',
    content: 'hello',
    clientIp: '1.2.3.4',
    dlpProvider: cleanProvider,
    gateway: stubGateway,
  });

  assert.strictEqual(r.status, 403);
});

// Test 3 — bad token → 401 'invalid_token'
test('handleMessage rejects bad token', async () => {
  // Requires any db setup so require.cache is warm; use a fresh one
  const { proxy } = await _setup('p3');

  const r = await proxy.handleMessage({
    embedToken: 'invalid-token-xyz',
    origin: 'https://x.com',
    visitorUuid: 'v3',
    content: 'hello',
    clientIp: '1.2.3.4',
    dlpProvider: cleanProvider,
    gateway: stubGateway,
  });

  assert.strictEqual(r.status, 401);
  assert.strictEqual(r.code, 'invalid_token');
});

// Test 4 — happy path → 200, body.text echoes input
test('handleMessage processes happy path', async () => {
  const { embedToken, proxy } = await _setup('p4');

  const r = await proxy.handleMessage({
    embedToken,
    origin: 'https://x.com',
    visitorUuid: 'v4',
    content: 'hello agent',
    clientIp: '1.2.3.4',
    dlpProvider: cleanProvider,
    gateway: stubGateway,
  });

  assert.strictEqual(r.status, 200);
  assert.ok(r.body.text.includes('Echo: hello agent'), `Expected echo, got: ${r.body.text}`);
});

// Test 5 — DLP-flagged response → redact action, text contains '[redacted:', original path not in text
test('handleMessage redacts DLP-flagged response', async () => {
  const { embedToken, proxy } = await _setup('p5');

  const dirtyGateway = {
    async sendMessage() {
      return { text: 'See /Users/admin/secret.txt for config', tokens: { in: 5, out: 8 } };
    },
  };

  const r = await proxy.handleMessage({
    embedToken,
    origin: 'https://x.com',
    visitorUuid: 'v5',
    content: 'where is config',
    clientIp: '1.2.3.4',
    dlpProvider: cleanProvider,
    gateway: dirtyGateway,
  });

  assert.strictEqual(r.status, 200);
  assert.ok(r.body.text.includes('[redacted:'), `Expected redaction marker, got: ${r.body.text}`);
  assert.ok(!r.body.text.includes('admin'), `Expected 'admin' to be redacted, got: ${r.body.text}`);
});

// Test 6 — rate limit: set rateLimitPerIp=2, 3rd call returns 429
test('handleMessage rate-limits aggressive client', async () => {
  const { db, embedId, embedToken, proxy } = await _setup('p6');
  db.updateEmbed(embedId, { rateLimitPerIp: 2 });

  // First two calls should succeed
  for (let i = 0; i < 2; i++) {
    const r = await proxy.handleMessage({
      embedToken,
      origin: 'https://x.com',
      visitorUuid: `v6-${i}`,
      content: 'hi',
      clientIp: '9.9.9.9',
      dlpProvider: cleanProvider,
      gateway: stubGateway,
    });
    assert.strictEqual(r.status, 200, `Expected 200 on call ${i + 1}, got ${r.status}`);
  }

  // Third call must be rate-limited
  const r3 = await proxy.handleMessage({
    embedToken,
    origin: 'https://x.com',
    visitorUuid: 'v6-x',
    content: 'hi',
    clientIp: '9.9.9.9',
    dlpProvider: cleanProvider,
    gateway: stubGateway,
  });

  assert.strictEqual(r3.status, 429);
});
