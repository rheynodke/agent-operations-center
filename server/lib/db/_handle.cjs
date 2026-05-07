'use strict';

/**
 * Shared sql.js handle + persist accessors for the split db modules.
 *
 * Why this file exists: pre-split, every helper in `db.cjs` reached the
 * single module-private `db` variable directly. After splitting, domain
 * modules in `db/*.cjs` need that same handle without a circular require
 * back to `db.cjs`. They import this lightweight module instead; `db.cjs`
 * registers the handle here after `initDatabase()` finishes.
 *
 * Contract: `setHandle()` is called exactly once by `db.cjs::initDatabase`.
 * `getDb()` returning null means a domain function was called before init —
 * we throw rather than silently no-op so the bug surfaces immediately.
 */

let _db = null;
let _persist = () => {};
let _persistNow = () => {};

function setHandle(db, { persist, persistNow }) {
  _db = db;
  if (typeof persist === 'function') _persist = persist;
  if (typeof persistNow === 'function') _persistNow = persistNow;
}

function getDb() {
  return _db; // callers may need to handle null gracefully (e.g. test harness)
}

function persist() { _persist(); }
function persistNow() { _persistNow(); }

module.exports = { setHandle, getDb, persist, persistNow };
