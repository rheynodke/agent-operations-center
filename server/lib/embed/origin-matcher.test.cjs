'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const om = require('./origin-matcher.cjs');

test('exact production origin matches', () => {
  const r = om.matchOrigin('https://example.com', { productionOrigin: 'https://example.com', devOrigins: [] });
  assert.deepStrictEqual(r, { matched: true, source: 'production' });
});

test('mismatch returns matched=false', () => {
  const r = om.matchOrigin('https://attacker.com', { productionOrigin: 'https://example.com', devOrigins: [] });
  assert.strictEqual(r.matched, false);
});

test('localhost wildcard pattern matches', () => {
  const r = om.matchOrigin('http://localhost:5173', { productionOrigin: 'https://example.com', devOrigins: ['http://localhost:*'] });
  assert.deepStrictEqual(r, { matched: true, source: 'dev' });
});

test('127.0.0.1 wildcard matches', () => {
  const r = om.matchOrigin('http://127.0.0.1:8080', { productionOrigin: 'https://example.com', devOrigins: ['http://127.0.0.1:*'] });
  assert.strictEqual(r.matched, true);
});

test('*.local wildcard matches subdomains', () => {
  const r = om.matchOrigin('http://staging.local', { productionOrigin: 'https://example.com', devOrigins: ['*.local'] });
  assert.strictEqual(r.matched, true);
});

test('null/empty origin rejected', () => {
  const r1 = om.matchOrigin(null, { productionOrigin: 'https://example.com', devOrigins: [] });
  assert.strictEqual(r1.matched, false);
  const r2 = om.matchOrigin('', { productionOrigin: 'https://example.com', devOrigins: [] });
  assert.strictEqual(r2.matched, false);
});

test('case-insensitive scheme/host', () => {
  const r = om.matchOrigin('HTTPS://Example.COM', { productionOrigin: 'https://example.com', devOrigins: [] });
  assert.strictEqual(r.matched, true);
});

test('overly permissive pattern rejected at compile time', () => {
  assert.throws(() => om.compilePattern('*'));
  assert.throws(() => om.compilePattern('.*'));
});
