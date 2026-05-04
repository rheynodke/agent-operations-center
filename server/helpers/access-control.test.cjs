'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseOwnerParam, parseScopeUserId, canAccessAgent, filterAgentsByOwner } = require('./access-control.cjs');

test('parseOwnerParam: empty + user role → me', () => {
  assert.equal(parseOwnerParam({ query: {}, user: { id: 1, role: 'user' } }), 'me');
});

test('parseOwnerParam: empty + admin role → all', () => {
  assert.equal(parseOwnerParam({ query: {}, user: { id: 1, role: 'admin' } }), 'all');
});

test('parseOwnerParam: explicit me', () => {
  assert.equal(parseOwnerParam({ query: { owner: 'me' }, user: { id: 1, role: 'user' } }), 'me');
});

test('parseOwnerParam: explicit numeric id', () => {
  assert.equal(parseOwnerParam({ query: { owner: '7' }, user: { id: 1, role: 'admin' } }), 7);
});

test('parseOwnerParam: garbage → role-based fallback', () => {
  assert.equal(parseOwnerParam({ query: { owner: 'xyz' }, user: { id: 1, role: 'user' } }), 'me');
  assert.equal(parseOwnerParam({ query: { owner: 'xyz' }, user: { id: 1, role: 'admin' } }), 'all');
});

test('parseOwnerParam: zero or negative → fallback', () => {
  assert.equal(parseOwnerParam({ query: { owner: '0' }, user: { id: 1, role: 'admin' } }), 'all');
  assert.equal(parseOwnerParam({ query: { owner: '-3' }, user: { id: 1, role: 'admin' } }), 'all');
});

test('parseScopeUserId: admin can impersonate via ?owner=', () => {
  const req = { query: { owner: '7' }, user: { userId: 1, role: 'admin' } };
  assert.equal(parseScopeUserId(req), 7);
});

test('parseScopeUserId: non-admin ignores ?owner=', () => {
  const req = { query: { owner: '7' }, user: { userId: 5, role: 'user' } };
  assert.equal(parseScopeUserId(req), 5);
});

test('parseScopeUserId: no ?owner= returns self for admin', () => {
  const req = { query: {}, user: { userId: 1, role: 'admin' } };
  assert.equal(parseScopeUserId(req), 1);
});

test('parseScopeUserId: garbage ?owner= returns self', () => {
  const req = { query: { owner: 'foo' }, user: { userId: 1, role: 'admin' } };
  assert.equal(parseScopeUserId(req), 1);
});

test('parseScopeUserId: ?owner=0 or negative returns self (invalid id)', () => {
  const req = { query: { owner: '0' }, user: { userId: 1, role: 'admin' } };
  assert.equal(parseScopeUserId(req), 1);
});

// ─── 'main' agent strict per-user (slice 1.5.e) ─────────────────────────────

test("canAccessAgent: 'main' is admin-private — non-admin returns false", () => {
  const req = { user: { userId: 5, role: 'user' } };
  const stubDb = { userOwnsAgent: () => false };
  assert.equal(canAccessAgent(req, 'main', stubDb), false);
});

test("canAccessAgent: admin can access 'main' (via userOwnsAgent admin bypass)", () => {
  const req = { user: { userId: 1, role: 'admin' } };
  const stubDb = { userOwnsAgent: (r) => r.user.role === 'admin' };
  assert.equal(canAccessAgent(req, 'main', stubDb), true);
});

test("filterAgentsByOwner: non-admin does NOT see 'main'", () => {
  const all = [{ id: 'main' }, { id: 'agent-a' }];
  const user = { userId: 5, role: 'user' };
  const owner = (id) => id === 'agent-a' ? 5 : 1;
  const out = filterAgentsByOwner(all, user, 'me', owner);
  assert.deepEqual(out.map(a => a.id), ['agent-a']);
});

test("filterAgentsByOwner: admin sees 'main' in own scope (owner=1)", () => {
  const all = [{ id: 'main' }, { id: 'agent-a' }];
  const user = { userId: 1, role: 'admin' };
  const owner = () => 1;
  const out = filterAgentsByOwner(all, user, 'me', owner);
  assert.deepEqual(out.map(a => a.id).sort(), ['agent-a', 'main']);
});

test("filterAgentsByOwner: admin scope=2 does NOT see 'main' (it belongs to user 1)", () => {
  const all = [{ id: 'main' }, { id: 'agent-b' }];
  const user = { userId: 1, role: 'admin' };
  const owner = (id) => id === 'agent-b' ? 2 : 0;
  const out = filterAgentsByOwner(all, user, 2, owner);
  assert.deepEqual(out.map(a => a.id), ['agent-b']);
});
