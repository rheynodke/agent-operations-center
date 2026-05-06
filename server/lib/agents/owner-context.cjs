'use strict';

/**
 * Request-scoped owner context for multi-tenant resolvers.
 *
 * Under the composite-PK schema (agent_profiles is keyed by agent_id +
 * provisioned_by), the same agent slug may exist for multiple users. The
 * helpers in this folder (detail/files/skills/tools/skillScripts) all
 * derive per-tenant filesystem paths from `db.getAgentOwner(agentId)`
 * which can return null when the slug is ambiguous.
 *
 * Routes that have already authenticated the caller can call
 * `withOwnerContext(req.user.userId, () => next())` to make the resolver
 * prefer THAT user's home over a global lookup. The middleware in
 * `requireAgentOwnership` does this automatically.
 */
const { AsyncLocalStorage } = require('node:async_hooks');

const store = new AsyncLocalStorage();

function withOwnerContext(ownerId, fn) {
  return store.run({ ownerId: Number(ownerId) || null }, fn);
}

function getOwnerContext() {
  const s = store.getStore();
  return s?.ownerId ?? null;
}

module.exports = { withOwnerContext, getOwnerContext };
