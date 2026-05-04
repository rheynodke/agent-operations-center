/**
 * helpers/versioning-helper.cjs
 *
 * Shorthand wrapper around versioning.saveVersion — saves a version snapshot
 * after a successful file write. Used by multiple route modules.
 */
'use strict';

/**
 * Create a vSave function bound to the given dependencies.
 *
 * @param {{ versioning: object, db: object }} deps
 * @returns {(scopeKey: string, content: string, req: object, op?: string) => void}
 */
function createVSave(deps) {
  const { versioning, db } = deps;

  return function vSave(scopeKey, content, req, op = 'edit') {
    try {
      versioning.saveVersion(db.getDb(), {
        scopeKey,
        content,
        savedBy: req.user?.username || null,
        op,
        persist: db.persist,
      });
    } catch (e) {
      console.warn('[versioning] saveVersion failed:', e.message);
    }
  };
}

module.exports = { createVSave };
