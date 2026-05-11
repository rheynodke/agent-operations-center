'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const auth = require('./auth-private.cjs');

const SECRET = 'a'.repeat(64);

test('verify returns decoded claims for valid HS256 JWT', () => {
  const token = jwt.sign({ visitor_id: 'u-1', name: 'Test' }, SECRET, { algorithm: 'HS256', expiresIn: '5m' });
  const r = auth.verifyPrivateJwt(token, SECRET);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.claims.visitor_id, 'u-1');
});

test('expired JWT rejected', () => {
  const token = jwt.sign({ visitor_id: 'u-2' }, SECRET, { algorithm: 'HS256', expiresIn: '-1s' });
  const r = auth.verifyPrivateJwt(token, SECRET);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'expired');
});

test('wrong secret rejected', () => {
  const token = jwt.sign({ visitor_id: 'u-3' }, SECRET, { algorithm: 'HS256', expiresIn: '5m' });
  const r = auth.verifyPrivateJwt(token, 'b'.repeat(64));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'invalid_signature');
});

test('non-HS256 algorithm rejected (alg confusion)', () => {
  const token = jwt.sign({ visitor_id: 'u-4' }, SECRET, { algorithm: 'HS512' });
  const r = auth.verifyPrivateJwt(token, SECRET);
  assert.strictEqual(r.ok, false);
});

test('malformed token rejected', () => {
  const r = auth.verifyPrivateJwt('not.a.token', SECRET);
  assert.strictEqual(r.ok, false);
});

test('missing visitor_id claim rejected', () => {
  const token = jwt.sign({ name: 'NoId' }, SECRET, { algorithm: 'HS256', expiresIn: '5m' });
  const r = auth.verifyPrivateJwt(token, SECRET);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'missing_visitor_id');
});

test('exp >5min from now rejected', () => {
  const token = jwt.sign({ visitor_id: 'u-5' }, SECRET, { algorithm: 'HS256', expiresIn: '1h' });
  const r = auth.verifyPrivateJwt(token, SECRET);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'exp_too_far');
});
