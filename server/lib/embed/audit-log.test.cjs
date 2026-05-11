// server/lib/embed/audit-log.test.cjs
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Set master key BEFORE any require that pulls in encryption.cjs
process.env.AOC_DLP_MASTER_KEY = crypto.randomBytes(32).toString('hex');

// ---------------------------------------------------------------------------
// Helpers (mirrors embed-sessions.test.cjs / encryption.test.cjs pattern)
// ---------------------------------------------------------------------------

function setupDb() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aocdb-audit-log-'));
  process.env.AOC_DATA_DIR = tmpDir;
  // Clear require cache so each test gets a fresh db + encryption instance
  Object.keys(require.cache).forEach(k => {
    if (k.includes('/server/lib/db') || k.includes('/server/lib/embed/')) {
      delete require.cache[k];
    }
  });
  const db = require('../db.cjs');
  return { db, tmpDir };
}

// createUser takes { username, password, role }
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

  // Reset encryption master key cache after fresh DB
  const enc = require('./encryption.cjs');
  enc._resetMasterKeyCacheForTests();

  const auditLog = require('./audit-log.cjs');

  return { db, userId, embedId: embed.id, enc, auditLog };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('writeEvent encrypts sensitive fields — ciphertext present, plaintext NOT in stored string', async () => {
  const { db, userId, embedId, auditLog } = await _setup('al1');

  const sensitive = { ipRaw: '192.168.1.1', email: 'alice@example.com' };
  const rowId = auditLog.writeEvent({
    embedId,
    ownerId: userId,
    eventType: 'dlp.block',
    severity: 'warn',
    origin: 'https://x.com',
    sensitiveContextData: sensitive,
    publicContextData: { action: 'block', ruleId: 'r1' },
  });

  assert.ok(typeof rowId === 'number', 'writeEvent should return numeric row id');

  // Read the raw context_data from DB to verify encryption
  const events = db.listAuditEvents({ embedId });
  assert.strictEqual(events.length, 1);
  const raw = events[0].contextData;

  // encryptedSensitive key must be present in the stored JSON
  const parsed = JSON.parse(raw);
  assert.ok(parsed.encryptedSensitive, 'encryptedSensitive key must be present');

  // Plaintext of sensitive fields must NOT appear verbatim in stored JSON string
  assert.ok(!raw.includes('192.168.1.1'), 'raw IP must not be stored in plaintext');
  assert.ok(!raw.includes('alice@example.com'), 'email must not be stored in plaintext');

  // Public fields should still be readable without decryption
  assert.strictEqual(parsed.action, 'block');
  assert.strictEqual(parsed.ruleId, 'r1');
});

test('readEventDecrypted decrypts sensitive data back correctly', async () => {
  const { db, userId, embedId, auditLog } = await _setup('al2');

  const sensitive = { ipRaw: '10.0.0.42', token: 'sk-supersecret' };
  auditLog.writeEvent({
    embedId,
    ownerId: userId,
    eventType: 'session.start',
    severity: 'info',
    sensitiveContextData: sensitive,
    publicContextData: { trafficType: 'production' },
  });

  const events = db.listAuditEvents({ embedId });
  assert.strictEqual(events.length, 1);

  const decrypted = auditLog.readEventDecrypted(events[0]);

  // sensitive block should be restored exactly
  assert.deepStrictEqual(decrypted.sensitive, sensitive);

  // public block should contain only public fields (no encryptedSensitive)
  assert.strictEqual(decrypted.public.trafficType, 'production');
  assert.ok(!('encryptedSensitive' in decrypted.public), 'encryptedSensitive must not leak into public block');
});

test('writeEvent with no sensitiveContextData still works — only public data stored', async () => {
  const { db, userId, embedId, auditLog } = await _setup('al3');

  const rowId = auditLog.writeEvent({
    embedId,
    ownerId: userId,
    eventType: 'rate_limit.warn',
    severity: 'warn',
    origin: 'https://x.com',
    publicContextData: { remaining: 5, windowMs: 60000 },
  });

  assert.ok(typeof rowId === 'number');

  const events = db.listAuditEvents({ embedId });
  assert.strictEqual(events.length, 1);

  const parsed = JSON.parse(events[0].contextData);
  // No encrypted block
  assert.ok(!('encryptedSensitive' in parsed), 'no encryptedSensitive when no sensitive data provided');
  assert.strictEqual(parsed.remaining, 5);
  assert.strictEqual(parsed.windowMs, 60000);
});

test('readEventDecrypted returns sensitive=null when no encryptedSensitive block', async () => {
  const { db, userId, embedId, auditLog } = await _setup('al4');

  auditLog.writeEvent({
    embedId,
    ownerId: userId,
    eventType: 'tool.violation',
    severity: 'error',
    publicContextData: { toolName: 'bash', reason: 'blocked' },
  });

  const events = db.listAuditEvents({ embedId });
  assert.strictEqual(events.length, 1);

  const decrypted = auditLog.readEventDecrypted(events[0]);

  assert.strictEqual(decrypted.sensitive, null, 'sensitive must be null when no encrypted block present');
  assert.strictEqual(decrypted.public.toolName, 'bash');
  assert.strictEqual(decrypted.public.reason, 'blocked');
});
