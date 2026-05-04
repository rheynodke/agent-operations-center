'use strict';
/**
 * Unit tests for GET /api/agents owner-scoping logic.
 * Tests the pure filterAgentsByOwner helper extracted to helpers/access-control.cjs.
 */

const test = require('node:test');
const assert = require('node:assert');
const { filterAgentsByOwner } = require('../helpers/access-control.cjs');

// Fixture agents
const AGENTS = [
  { id: 'main' },
  { id: 'agent-alpha' },   // owned by user 1
  { id: 'agent-beta' },    // owned by user 2
  { id: 'agent-gamma' },   // no owner (legacy, null)
];

function ownerMap(agentId) {
  const map = {
    'agent-alpha': 1,
    'agent-beta': 2,
    'agent-gamma': null,
  };
  return map[agentId] ?? null;
}

test('admin with scope=all → sees every agent', () => {
  const admin = { role: 'admin', userId: 1 };
  const result = filterAgentsByOwner(AGENTS, admin, 'all', ownerMap);
  assert.deepStrictEqual(result.map(a => a.id), ['main', 'agent-alpha', 'agent-beta', 'agent-gamma']);
});

test('admin with scope=me → sees only own + main (main belongs to admin id=1)', () => {
  const admin = { role: 'admin', userId: 1 };
  const result = filterAgentsByOwner(AGENTS, admin, 'me', ownerMap);
  assert.deepStrictEqual(result.map(a => a.id), ['main', 'agent-alpha']);
});

test('admin with scope=<numeric user id> → sees that user\'s agents (NOT main, which is admin-private)', () => {
  const admin = { role: 'admin', userId: 1 };
  const result = filterAgentsByOwner(AGENTS, admin, 2, ownerMap);
  assert.deepStrictEqual(result.map(a => a.id), ['agent-beta']);
});

test("non-admin user → sees only own agents (NOT 'main' — admin-private)", () => {
  const user = { role: 'user', userId: 2 };
  const result = filterAgentsByOwner(AGENTS, user, 'me', ownerMap);
  assert.deepStrictEqual(result.map(a => a.id), ['agent-beta']);
});

test('non-admin user → cannot see legacy unowned agents or main', () => {
  const user = { role: 'user', userId: 99 };
  const result = filterAgentsByOwner(AGENTS, user, 'me', ownerMap);
  // 'main' is admin-private; agent-gamma has null owner; user 99 has no agents.
  assert.deepStrictEqual(result.map(a => a.id), []);
});

test("'main' is strict per-user (admin-private) — non-admin never sees it", () => {
  const user = { role: 'user', userId: 999 };
  const result = filterAgentsByOwner(AGENTS, user, 'me', ownerMap);
  assert.ok(!result.some(a => a.id === 'main'), 'main must NOT be visible to non-admin');
});

test('admin scope=all always includes legacy unowned agents', () => {
  const admin = { role: 'admin', userId: 1 };
  const result = filterAgentsByOwner(AGENTS, admin, 'all', ownerMap);
  assert.ok(result.some(a => a.id === 'agent-gamma'), 'unowned agent visible to admin/all');
});
