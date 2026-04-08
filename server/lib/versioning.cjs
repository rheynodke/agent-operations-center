'use strict';
/**
 * versioning.cjs
 * File version history stored in SQLite.
 *
 * scope_key conventions:
 *   agent:{agentId}:{fileName}           — agent workspace file (IDENTITY.md, etc.)
 *   skill:{agentId}:{skillName}          — agent-specific skill SKILL.md
 *   skill:global:{slug}                  — global/managed skill SKILL.md
 *   skill-script:{agentId}:{skill}:{file} — script inside a skill dir
 *   script:agent:{agentId}:{file}        — agent workspace script
 *   script:global:{file}                 — shared workspace script
 */

const crypto = require('crypto');

const MAX_VERSIONS = 50; // max versions to keep per scope_key

function sha256(content) {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Save a new version snapshot.
 * Skips if content is identical to the latest version (dedup via checksum).
 * Prunes old versions beyond MAX_VERSIONS.
 *
 * @param {object} db - sql.js database instance
 * @param {object} opts
 * @param {string} opts.scopeKey
 * @param {string} opts.content
 * @param {string} [opts.savedBy]
 * @param {string} [opts.op]   - 'create' | 'edit' | 'delete'
 * @param {string} [opts.label]
 * @param {function} opts.persist - db.persist function
 */
function saveVersion(db, { scopeKey, content, savedBy = null, op = 'edit', label = null, persist }) {
  if (!db) return null;

  const checksum = sha256(content);
  const size     = Buffer.byteLength(content, 'utf-8');

  // Dedup: skip if last version has same checksum
  const latest = db.exec(
    `SELECT checksum FROM file_versions WHERE scope_key = ? ORDER BY saved_at DESC LIMIT 1`,
    [scopeKey]
  );
  if (latest.length > 0 && latest[0].values.length > 0) {
    if (latest[0].values[0][0] === checksum) return null; // no change
  }

  // Insert new version
  const stmt = db.prepare(`
    INSERT INTO file_versions (scope_key, content, content_size, checksum, op, saved_by, label)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run([scopeKey, content, size, checksum, op, savedBy, label]);
  stmt.free();

  // Prune old versions beyond MAX_VERSIONS
  const countRes = db.exec(
    `SELECT COUNT(*) FROM file_versions WHERE scope_key = ?`,
    [scopeKey]
  );
  const count = countRes?.[0]?.values?.[0]?.[0] || 0;
  if (count > MAX_VERSIONS) {
    const excess = count - MAX_VERSIONS;
    db.run(
      `DELETE FROM file_versions WHERE scope_key = ? AND id IN (
         SELECT id FROM file_versions WHERE scope_key = ? ORDER BY saved_at ASC LIMIT ?
       )`,
      [scopeKey, scopeKey, excess]
    );
  }

  if (persist) persist();
  return checksum;
}

/**
 * List version history for a scope_key (newest first).
 */
function listVersions(db, { scopeKey, limit = 30 }) {
  if (!db) return [];
  const res = db.exec(
    `SELECT id, scope_key, content_size, checksum, op, saved_by, saved_at, label
     FROM file_versions WHERE scope_key = ?
     ORDER BY saved_at DESC LIMIT ?`,
    [scopeKey, limit]
  );
  if (!res.length) return [];
  const cols = res[0].columns;
  return res[0].values.map(row => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
}

/**
 * Get a specific version by id (includes content).
 */
function getVersion(db, id) {
  if (!db) return null;
  const res = db.exec(
    `SELECT id, scope_key, content, content_size, checksum, op, saved_by, saved_at, label
     FROM file_versions WHERE id = ?`,
    [id]
  );
  if (!res.length || !res[0].values.length) return null;
  const cols = res[0].columns;
  return Object.fromEntries(cols.map((c, i) => [c, res[0].values[0][i]]));
}

/**
 * Delete a specific version by id.
 */
function deleteVersion(db, id, persist) {
  if (!db) return;
  const stmt = db.prepare('DELETE FROM file_versions WHERE id = ?');
  stmt.run([id]);
  stmt.free();
  if (persist) persist();
}

/**
 * Get the latest version for a scope_key (includes content).
 */
function getLatestVersion(db, scopeKey) {
  if (!db) return null;
  const res = db.exec(
    `SELECT id, scope_key, content, content_size, checksum, op, saved_by, saved_at, label
     FROM file_versions WHERE scope_key = ? ORDER BY saved_at DESC LIMIT 1`,
    [scopeKey]
  );
  if (!res.length || !res[0].values.length) return null;
  const cols = res[0].columns;
  return Object.fromEntries(cols.map((c, i) => [c, res[0].values[0][i]]));
}

/**
 * List all scope_keys that have version history, with latest version info.
 * Useful for a "all versioned files" overview.
 */
function listAllScopes(db, { prefix = null, limit = 100 } = {}) {
  if (!db) return [];
  let sql = `
    SELECT scope_key,
           COUNT(*) as version_count,
           MAX(saved_at) as last_saved_at,
           MAX(saved_by) as last_saved_by
    FROM file_versions
  `;
  const params = [];
  if (prefix) {
    sql += ` WHERE scope_key LIKE ?`;
    params.push(`${prefix}%`);
  }
  sql += ` GROUP BY scope_key ORDER BY last_saved_at DESC LIMIT ?`;
  params.push(limit);

  const res = db.exec(sql, params);
  if (!res.length) return [];
  const cols = res[0].columns;
  return res[0].values.map(row => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
}

module.exports = { saveVersion, listVersions, getVersion, deleteVersion, getLatestVersion, listAllScopes };
