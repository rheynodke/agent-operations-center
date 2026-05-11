// server/lib/embed/kill-switch.cjs
'use strict';

const db = require('../db.cjs');

const _cache = new Map();
const CACHE_TTL_MS = 30_000;

function _now() { return Date.now(); }

/**
 * Returns { enabled, disableMode } for the given embedId.
 * Result is cached for 30 seconds. Non-existent embed returns { enabled: false, disableMode: null }.
 */
function isEnabled(embedId) {
  const cached = _cache.get(embedId);
  if (cached && cached.expiresAt > _now()) {
    return { enabled: cached.enabled, disableMode: cached.disableMode };
  }
  const row = db.getEmbedById(embedId);
  if (!row) return { enabled: false, disableMode: null };
  const result = { enabled: row.enabled === 1, disableMode: row.disableMode ?? null };
  _cache.set(embedId, { ...result, expiresAt: _now() + CACHE_TTL_MS });
  return result;
}

/**
 * Updates enabled state and optional mode for the given embedId.
 * Invalidates cache entry immediately.
 * Returns { enabled, disableMode }.
 */
function toggleEnabled(embedId, { enabled, mode = null } = {}) {
  db.updateEmbed(embedId, { enabled: enabled ? 1 : 0, disableMode: enabled ? null : mode });
  _cache.delete(embedId);
  return { enabled: !!enabled, disableMode: enabled ? null : mode };
}

/**
 * Disables all embeds belonging to ownerId.
 * Returns array of embed ids that were updated.
 */
function disableAllForOwner(ownerId, { mode = 'emergency' } = {}) {
  const embeds = db.listEmbedsForOwner(ownerId);
  const ids = [];
  for (const e of embeds) {
    db.updateEmbed(e.id, { enabled: 0, disableMode: mode });
    _cache.delete(e.id);
    ids.push(e.id);
  }
  return ids;
}

/** Clears in-memory cache. Only for use in tests. */
function _resetCacheForTests() { _cache.clear(); }

module.exports = { isEnabled, toggleEnabled, disableAllForOwner, _resetCacheForTests };
