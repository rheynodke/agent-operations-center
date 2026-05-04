'use strict';
const test = require('node:test');
const assert = require('node:assert');

const { gatewayForReq } = require('./gateway-context.cjs');
const { gatewayPool } = require('../lib/gateway-ws.cjs');

test('gatewayForReq: returns connection for valid req.user.userId', () => {
  const conn = gatewayForReq({ user: { userId: 7 } });
  assert.equal(conn.userId, 7);
});

test('gatewayForReq: same userId returns same connection (pool identity)', () => {
  const a = gatewayForReq({ user: { userId: 8 } });
  const b = gatewayForReq({ user: { userId: 8 } });
  assert.strictEqual(a, b);
});

test('gatewayForReq: different userIds return different connections', () => {
  const a = gatewayForReq({ user: { userId: 9 } });
  const b = gatewayForReq({ user: { userId: 10 } });
  assert.notStrictEqual(a, b);
});

test('gatewayForReq: throws 401 if req.user.userId missing', () => {
  assert.throws(() => gatewayForReq({}), (e) => e.status === 401);
  assert.throws(() => gatewayForReq({ user: {} }), (e) => e.status === 401);
  assert.throws(() => gatewayForReq(null), (e) => e.status === 401);
});

test('gatewayForReq: shim consistency — userId=1 returns gatewayProxy', () => {
  const { gatewayProxy } = require('../lib/gateway-ws.cjs');
  assert.strictEqual(gatewayForReq({ user: { userId: 1 } }), gatewayProxy);
});
