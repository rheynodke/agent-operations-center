'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { probeActivity } = require('./gateway-activity-probe.cjs');

function withTempSessions(content, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-activity-'));
  const file = path.join(dir, 'sessions.json');
  fs.writeFileSync(file, JSON.stringify(content));
  try { return fn(file); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('probeActivity: counts non-heartbeat sessions within 1h and 24h windows', () => {
  const now = Date.now();
  const within1h = now - 30 * 60 * 1000;       // 30m ago
  const within24h = now - 12 * 60 * 60 * 1000; // 12h ago
  const old = now - 48 * 60 * 60 * 1000;       // 2d ago
  withTempSessions({
    'agent:main:telegram:direct:577142951': { sessionId: 'a', updatedAt: within1h },
    'agent:main:dashboard:abc': { sessionId: 'b', updatedAt: within24h },
    'agent:main:whatsapp:direct:+1': { sessionId: 'c', updatedAt: old },
    'agent:main:cron:job1': { sessionId: 'd', updatedAt: within1h },
    'agent:main:main:heartbeat': { sessionId: 'e', updatedAt: within1h },
  }, (file) => {
    const r = probeActivity({ sessionsFile: file, now });
    assert.equal(r.messagesLast1h, 1);
    assert.equal(r.messagesLast24h, 2);
    assert.equal(r.idleHeartbeatOnly, false);
    assert.equal(typeof r.lastActivityAt, 'string');
  });
});

test('probeActivity: idleHeartbeatOnly when only heartbeat/cron updated within 24h', () => {
  const now = Date.now();
  const recent = now - 60 * 1000;
  withTempSessions({
    'agent:main:cron:job1': { sessionId: 'd', updatedAt: recent },
    'agent:main:main:heartbeat': { sessionId: 'e', updatedAt: recent },
  }, (file) => {
    const r = probeActivity({ sessionsFile: file, now });
    assert.equal(r.messagesLast1h, 0);
    assert.equal(r.messagesLast24h, 0);
    assert.equal(r.idleHeartbeatOnly, true);
    assert.equal(r.lastActivityAt, null);
  });
});

test('probeActivity: returns null for missing file', () => {
  const r = probeActivity({ sessionsFile: '/nonexistent/sessions.json', now: Date.now() });
  assert.equal(r, null);
});

test('probeActivity: returns null for corrupt JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-activity-'));
  const file = path.join(dir, 'sessions.json');
  fs.writeFileSync(file, '{ not json');
  try {
    const r = probeActivity({ sessionsFile: file, now: Date.now() });
    assert.equal(r, null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('probeActivity: per-channel heartbeats and dreaming-narrative sessions are background', () => {
  const now = Date.now();
  const recent = now - 30 * 1000;
  withTempSessions({
    'agent:main:telegram:direct:577142951:heartbeat': { sessionId: 'h1', updatedAt: recent },
    'agent:main:whatsapp:direct:+6281293198124:heartbeat': { sessionId: 'h2', updatedAt: recent },
    'agent:main:dreaming-narrative-light-abc': { sessionId: 'd1', updatedAt: recent },
    'agent:main:dreaming-narrative-rem-xyz': { sessionId: 'd2', updatedAt: recent },
    'agent:main:cron:job1': { sessionId: 'c1', updatedAt: recent },
    'agent:main:cron:job1:run:abc': { sessionId: 'c2', updatedAt: recent },
  }, (file) => {
    const r = probeActivity({ sessionsFile: file, now });
    assert.equal(r.messagesLast1h, 0, 'no per-channel-heartbeat / dreaming / cron should count');
    assert.equal(r.messagesLast24h, 0);
    assert.equal(r.idleHeartbeatOnly, true);
    assert.equal(r.lastActivityAt, null);
  });
});

test('probeActivity: mixes real telegram activity with per-channel heartbeat', () => {
  const now = Date.now();
  const recent = now - 30 * 1000;
  withTempSessions({
    'agent:main:telegram:direct:577142951': { sessionId: 'real', updatedAt: recent },
    'agent:main:telegram:direct:577142951:heartbeat': { sessionId: 'hb', updatedAt: recent },
  }, (file) => {
    const r = probeActivity({ sessionsFile: file, now });
    assert.equal(r.messagesLast1h, 1, 'real telegram session counts; per-channel heartbeat does not');
    assert.equal(r.messagesLast24h, 1);
    assert.equal(r.idleHeartbeatOnly, false);
  });
});
