// server/lib/embed/ip-hash.test.cjs
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const ipHash = require('./ip-hash.cjs');

test('hashIp produces 64-char hex (sha256)', () => {
  const h = ipHash.hashIp({ ip: '1.2.3.4', ownerId: 1 });
  assert.strictEqual(h.length, 64);
  assert.match(h, /^[0-9a-f]+$/);
});

test('same ip + same owner + same day produces same hash', () => {
  const a = ipHash.hashIp({ ip: '1.2.3.4', ownerId: 1 });
  const b = ipHash.hashIp({ ip: '1.2.3.4', ownerId: 1 });
  assert.strictEqual(a, b);
});

test('different owners produce different hashes for same ip', () => {
  const a = ipHash.hashIp({ ip: '1.2.3.4', ownerId: 1 });
  const b = ipHash.hashIp({ ip: '1.2.3.4', ownerId: 2 });
  assert.notStrictEqual(a, b);
});

test('different days produce different hashes (test via dateOverride)', () => {
  const a = ipHash.hashIp({ ip: '1.2.3.4', ownerId: 1, dateOverride: '2026-05-10' });
  const b = ipHash.hashIp({ ip: '1.2.3.4', ownerId: 1, dateOverride: '2026-05-11' });
  assert.notStrictEqual(a, b);
});

test('extractClientIp from req.headers honors X-Forwarded-For when from trusted proxy', () => {
  const req = {
    headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' },
    socket: { remoteAddress: '10.0.0.1' },
  };
  const trustedProxies = ['10.0.0.1'];
  const ip = ipHash.extractClientIp(req, { trustedProxies });
  assert.strictEqual(ip, '203.0.113.5');
});

test('extractClientIp falls back to socket when proxy not trusted', () => {
  const req = {
    headers: { 'x-forwarded-for': '1.2.3.4' },
    socket: { remoteAddress: '5.6.7.8' },
  };
  const ip = ipHash.extractClientIp(req, { trustedProxies: [] });
  assert.strictEqual(ip, '5.6.7.8');
});
