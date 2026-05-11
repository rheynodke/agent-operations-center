// server/lib/db/embed-audit.test.cjs
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Use isolated test DB per embed-sessions.test.cjs pattern
function setupDb() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aocdb-embed-audit-'));
  process.env.AOC_DATA_DIR = tmpDir;
  // Clear require cache so each test gets a fresh db instance
  Object.keys(require.cache).forEach(k => {
    if (k.includes('/server/lib/db')) delete require.cache[k];
  });
  const db = require('../db.cjs');
  return { db, tmpDir };
}

test('writeAuditEvent inserts + returns id', async () => {
  const { db } = setupDb();
  await db.initDatabase();

  const id = db.writeAuditEvent({
    embedId: 'emb-1',
    sessionId: null,
    ownerId: 1,
    eventType: 'embed_create',
    severity: 'info',
    contextData: { foo: 'bar' },
  });
  assert.ok(id > 0);
});

test('listAuditEvents filters by embedId + sorts by created_at DESC', async () => {
  const { db } = setupDb();
  await db.initDatabase();

  db.writeAuditEvent({ embedId: 'emb-2', ownerId: 1, eventType: 'message', severity: 'info', contextData: {} });
  db.writeAuditEvent({ embedId: 'emb-2', ownerId: 1, eventType: 'dlp_redaction', severity: 'warning', contextData: {} });
  const events = db.listAuditEvents({ embedId: 'emb-2', limit: 10 });
  assert.strictEqual(events.length, 2);
  assert.ok(events[0].createdAt >= events[1].createdAt);
});

test('listAuditEvents filters by eventType', async () => {
  const { db } = setupDb();
  await db.initDatabase();

  db.writeAuditEvent({ embedId: 'emb-3', ownerId: 1, eventType: 'message', severity: 'info', contextData: {} });
  db.writeAuditEvent({ embedId: 'emb-3', ownerId: 1, eventType: 'auth_fail', severity: 'warning', contextData: {} });
  const filtered = db.listAuditEvents({ embedId: 'emb-3', eventType: 'auth_fail' });
  assert.strictEqual(filtered.length, 1);
  assert.strictEqual(filtered[0].eventType, 'auth_fail');
});

test('listAuditEvents pagination via cursor (id)', async () => {
  const { db } = setupDb();
  await db.initDatabase();

  for (let i = 0; i < 5; i++) {
    db.writeAuditEvent({ embedId: 'emb-4', ownerId: 1, eventType: 'message', severity: 'info', contextData: { i } });
  }
  const page1 = db.listAuditEvents({ embedId: 'emb-4', limit: 2 });
  assert.strictEqual(page1.length, 2);
  const page2 = db.listAuditEvents({ embedId: 'emb-4', limit: 2, cursor: page1[1].id });
  assert.strictEqual(page2.length, 2);
  assert.notStrictEqual(page1[0].id, page2[0].id);
});
