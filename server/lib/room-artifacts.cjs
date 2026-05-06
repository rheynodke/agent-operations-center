'use strict';

/**
 * server/lib/room-artifacts.cjs
 *
 * Artifact management for HQ / mission rooms.
 * Supports versioned file storage (text content) with SHA-256 dedup,
 * category filtering, pin/archive toggles, and disk cleanup on delete.
 *
 * Storage layout:
 *   <OPENCLAW_HOME>/rooms/<roomId>/<artifactId>/<versionNumber>/<fileName>
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const db     = require('./db.cjs');
const config = require('./config.cjs');

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_CATEGORIES = new Set(['briefs', 'outputs', 'research', 'decisions', 'assets']);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve the on-disk root for a room's artifact storage.
 * @param {string} roomId
 * @returns {string}
 */
function roomDir(roomId) {
  return path.join(config.OPENCLAW_HOME, 'rooms', roomId);
}

/**
 * Resolve the on-disk path for a specific artifact version.
 * @param {string} roomId
 * @param {string} artifactId
 * @param {number} versionNumber
 * @param {string} fileName
 * @returns {string}
 */
function versionFilePath(roomId, artifactId, versionNumber, fileName) {
  return path.join(roomDir(roomId), artifactId, String(versionNumber), fileName);
}

/**
 * Normalise a raw DB row from room_artifacts into a JS object.
 * @param {object} row
 * @returns {object}
 */
function normalizeArtifact(row) {
  if (!row || !row.id) return null;
  return {
    id:              row.id,
    roomId:          row.room_id,
    category:        row.category,
    title:           row.title,
    description:     row.description || undefined,
    tags:            (() => { try { return row.tags ? JSON.parse(row.tags) : []; } catch { return []; } })(),
    createdBy:       row.created_by,
    createdAt:       row.created_at,
    updatedAt:       row.updated_at,
    pinned:          row.pinned === 1 || row.pinned === true,
    archived:        row.archived === 1 || row.archived === true,
    latestVersionId: row.latest_version_id || null,
  };
}

/**
 * Normalise a raw DB row from room_artifact_versions.
 * @param {object} row
 * @returns {object}
 */
function normalizeVersion(row) {
  if (!row || !row.id) return null;
  return {
    id:            row.id,
    artifactId:    row.artifact_id,
    versionNumber: row.version_number,
    filePath:      row.file_path,
    fileName:      row.file_name,
    mimeType:      row.mime_type || 'text/plain',
    sizeBytes:     row.size_bytes,
    sha256:        row.sha256,
    createdBy:     row.created_by,
    createdAt:     row.created_at,
  };
}

/**
 * Compute the next version number for an artifact.
 * Returns 1 if no versions exist yet.
 * @param {string} artifactId
 * @returns {number}
 */
function nextVersionNumber(artifactId) {
  const raw = db.getDb();
  const res = raw.exec(
    'SELECT MAX(version_number) AS max_ver FROM room_artifact_versions WHERE artifact_id = ?',
    [artifactId]
  );
  if (!res.length || !res[0].values.length || res[0].values[0][0] == null) return 1;
  return res[0].values[0][0] + 1;
}

/**
 * Write file content to disk, creating directories as needed.
 * @param {string} filePath
 * @param {string} content
 */
function writeFileToDisk(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a new artifact record + first version. Writes content to disk.
 *
 * @param {object} opts
 * @param {string} opts.roomId
 * @param {string} opts.category  — must be one of VALID_CATEGORIES
 * @param {string} opts.title
 * @param {string} [opts.description]
 * @param {string[]} [opts.tags]
 * @param {string} opts.createdBy
 * @param {string} opts.content
 * @param {string} opts.fileName
 * @param {string} [opts.mimeType]
 * @returns {{ artifact: object, version: object }}
 */
function createArtifact({
  roomId, category, title, description, tags = [],
  createdBy, content, fileName, mimeType = 'text/plain',
}) {
  if (!VALID_CATEGORIES.has(category)) {
    throw new Error(`Invalid category "${category}". Must be one of: ${[...VALID_CATEGORIES].join(', ')}`);
  }
  if (!roomId)    throw new Error('createArtifact: roomId is required');
  if (!title)     throw new Error('createArtifact: title is required');
  if (!createdBy) throw new Error('createArtifact: createdBy is required');
  if (content == null) throw new Error('createArtifact: content is required');
  if (!fileName)  throw new Error('createArtifact: fileName is required');

  const raw = db.getDb();
  const now = new Date().toISOString();

  // 1. Create artifact row
  const artifactId  = crypto.randomUUID();
  const tagsJson    = JSON.stringify(Array.isArray(tags) ? tags : []);

  raw.run(
    `INSERT INTO room_artifacts (id, room_id, category, title, description, tags, created_by, created_at, updated_at, pinned, archived, latest_version_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL)`,
    [artifactId, roomId, category, title, description || null, tagsJson, createdBy, now, now]
  );

  // 2. Create first version
  const versionId     = crypto.randomUUID();
  const versionNumber = 1;
  const sha256        = crypto.createHash('sha256').update(content).digest('hex');
  const sizeBytes     = Buffer.byteLength(content, 'utf-8');
  const filePath      = versionFilePath(roomId, artifactId, versionNumber, fileName);

  writeFileToDisk(filePath, content);

  raw.run(
    `INSERT INTO room_artifact_versions (id, artifact_id, version_number, file_path, file_name, mime_type, size_bytes, sha256, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [versionId, artifactId, versionNumber, filePath, fileName, mimeType, sizeBytes, sha256, createdBy, now]
  );

  // 3. Update latest_version_id on artifact
  raw.run(
    `UPDATE room_artifacts SET latest_version_id = ?, updated_at = ? WHERE id = ?`,
    [versionId, now, artifactId]
  );

  db.persist();

  // 4. Read back normalised rows
  const artifactStmt = raw.prepare('SELECT * FROM room_artifacts WHERE id = ?');
  artifactStmt.bind([artifactId]);
  artifactStmt.step();
  const artifactRow = artifactStmt.getAsObject();
  artifactStmt.free();

  const versionStmt = raw.prepare('SELECT * FROM room_artifact_versions WHERE id = ?');
  versionStmt.bind([versionId]);
  versionStmt.step();
  const versionRow = versionStmt.getAsObject();
  versionStmt.free();

  return {
    artifact: normalizeArtifact(artifactRow),
    version:  normalizeVersion(versionRow),
  };
}

/**
 * Add a new version to an existing artifact. Writes content to disk.
 *
 * @param {object} opts
 * @param {string} opts.artifactId
 * @param {string} opts.content
 * @param {string} opts.fileName
 * @param {string} [opts.mimeType]
 * @param {string} opts.createdBy
 * @returns {{ version: object, artifact: object }}
 */
function addArtifactVersion({ artifactId, content, fileName, mimeType = 'text/plain', createdBy }) {
  if (!artifactId) throw new Error('addArtifactVersion: artifactId is required');
  if (content == null) throw new Error('addArtifactVersion: content is required');
  if (!fileName)  throw new Error('addArtifactVersion: fileName is required');
  if (!createdBy) throw new Error('addArtifactVersion: createdBy is required');

  const raw = db.getDb();

  // Fetch the artifact to get roomId
  const artStmt = raw.prepare('SELECT * FROM room_artifacts WHERE id = ?');
  artStmt.bind([artifactId]);
  artStmt.step();
  const artifactRow = artStmt.getAsObject();
  artStmt.free();
  if (!artifactRow.id) throw new Error(`addArtifactVersion: artifact "${artifactId}" not found`);

  const roomId        = artifactRow.room_id;
  const versionNumber = nextVersionNumber(artifactId);
  const now           = new Date().toISOString();
  const versionId     = crypto.randomUUID();
  const sha256        = crypto.createHash('sha256').update(content).digest('hex');
  const sizeBytes     = Buffer.byteLength(content, 'utf-8');
  const filePath      = versionFilePath(roomId, artifactId, versionNumber, fileName);

  writeFileToDisk(filePath, content);

  raw.run(
    `INSERT INTO room_artifact_versions (id, artifact_id, version_number, file_path, file_name, mime_type, size_bytes, sha256, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [versionId, artifactId, versionNumber, filePath, fileName, mimeType, sizeBytes, sha256, createdBy, now]
  );

  // Update artifact's latest_version_id + updated_at
  raw.run(
    `UPDATE room_artifacts SET latest_version_id = ?, updated_at = ? WHERE id = ?`,
    [versionId, now, artifactId]
  );

  db.persist();

  // Read back updated artifact
  const artStmt2 = raw.prepare('SELECT * FROM room_artifacts WHERE id = ?');
  artStmt2.bind([artifactId]);
  artStmt2.step();
  const updatedArtRow = artStmt2.getAsObject();
  artStmt2.free();

  const verStmt = raw.prepare('SELECT * FROM room_artifact_versions WHERE id = ?');
  verStmt.bind([versionId]);
  verStmt.step();
  const versionRow = verStmt.getAsObject();
  verStmt.free();

  return {
    version:  normalizeVersion(versionRow),
    artifact: normalizeArtifact(updatedArtRow),
  };
}

/**
 * List artifacts for a room. Optionally filter by category; defaults to non-archived.
 *
 * @param {object} opts
 * @param {string} opts.roomId
 * @param {string} [opts.category]
 * @param {boolean} [opts.archived=false]
 * @returns {object[]}
 */
function listArtifacts({ roomId, category, archived = false } = {}) {
  if (!roomId) throw new Error('listArtifacts: roomId is required');

  const raw    = db.getDb();
  const params = [roomId, archived ? 1 : 0];
  let sql = 'SELECT * FROM room_artifacts WHERE room_id = ? AND archived = ?';

  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }

  sql += ' ORDER BY pinned DESC, created_at DESC';

  const res = raw.exec(sql, params);
  if (!res.length) return [];

  const { columns, values } = res[0];
  return values.map(row => {
    const obj = {};
    columns.forEach((col, i) => { obj[col] = row[i]; });
    return normalizeArtifact(obj);
  });
}

/**
 * Get a single artifact with all its versions.
 *
 * @param {string} artifactId
 * @returns {{ artifact: object, versions: object[] } | null}
 */
function getArtifact(artifactId) {
  if (!artifactId) throw new Error('getArtifact: artifactId is required');
  const raw = db.getDb();

  const artStmt = raw.prepare('SELECT * FROM room_artifacts WHERE id = ?');
  artStmt.bind([artifactId]);
  artStmt.step();
  const artifactRow = artStmt.getAsObject();
  artStmt.free();

  if (!artifactRow.id) return null;

  const verRes = raw.exec(
    'SELECT * FROM room_artifact_versions WHERE artifact_id = ? ORDER BY version_number ASC',
    [artifactId]
  );

  let versions = [];
  if (verRes.length) {
    const { columns, values } = verRes[0];
    versions = values.map(row => {
      const obj = {};
      columns.forEach((col, i) => { obj[col] = row[i]; });
      return normalizeVersion(obj);
    });
  }

  return {
    artifact: normalizeArtifact(artifactRow),
    versions,
  };
}

/**
 * Get a specific version's content from disk.
 *
 * @param {string} artifactId
 * @param {number} versionNumber
 * @returns {{ version: object, content: string } | null}
 */
function getArtifactContent(artifactId, versionNumber) {
  if (!artifactId)    throw new Error('getArtifactContent: artifactId is required');
  if (versionNumber == null) throw new Error('getArtifactContent: versionNumber is required');

  const raw = db.getDb();
  const res = raw.exec(
    'SELECT * FROM room_artifact_versions WHERE artifact_id = ? AND version_number = ?',
    [artifactId, Number(versionNumber)]
  );

  if (!res.length || !res[0].values.length) return null;

  const { columns, values } = res[0];
  const obj = {};
  columns.forEach((col, i) => { obj[col] = values[0][i]; });
  const version = normalizeVersion(obj);

  let content;
  try {
    content = fs.readFileSync(version.filePath, 'utf-8');
  } catch {
    return null;
  }

  return { version, content };
}

/**
 * Pin or unpin an artifact.
 *
 * @param {string} artifactId
 * @param {boolean} pinned
 * @returns {object} updated Artifact
 */
function pinArtifact(artifactId, pinned) {
  if (!artifactId) throw new Error('pinArtifact: artifactId is required');
  const raw = db.getDb();
  const now = new Date().toISOString();

  raw.run(
    'UPDATE room_artifacts SET pinned = ?, updated_at = ? WHERE id = ?',
    [pinned ? 1 : 0, now, artifactId]
  );
  db.persist();

  const stmt = raw.prepare('SELECT * FROM room_artifacts WHERE id = ?');
  stmt.bind([artifactId]);
  stmt.step();
  const row = stmt.getAsObject();
  stmt.free();

  if (!row.id) throw new Error(`pinArtifact: artifact "${artifactId}" not found`);
  return normalizeArtifact(row);
}

/**
 * Archive or unarchive an artifact.
 *
 * @param {string} artifactId
 * @param {boolean} archived
 * @returns {object} updated Artifact
 */
function archiveArtifact(artifactId, archived) {
  if (!artifactId) throw new Error('archiveArtifact: artifactId is required');
  const raw = db.getDb();
  const now = new Date().toISOString();

  raw.run(
    'UPDATE room_artifacts SET archived = ?, updated_at = ? WHERE id = ?',
    [archived ? 1 : 0, now, artifactId]
  );
  db.persist();

  const stmt = raw.prepare('SELECT * FROM room_artifacts WHERE id = ?');
  stmt.bind([artifactId]);
  stmt.step();
  const row = stmt.getAsObject();
  stmt.free();

  if (!row.id) throw new Error(`archiveArtifact: artifact "${artifactId}" not found`);
  return normalizeArtifact(row);
}

/**
 * Delete an artifact + all its versions. Cascades in DB; purges disk directory.
 *
 * @param {string} artifactId
 * @returns {void}
 */
function deleteArtifact(artifactId) {
  if (!artifactId) throw new Error('deleteArtifact: artifactId is required');
  const raw = db.getDb();

  // Fetch artifact first for roomId (needed for disk path)
  const stmt = raw.prepare('SELECT room_id FROM room_artifacts WHERE id = ?');
  stmt.bind([artifactId]);
  stmt.step();
  const row = stmt.getAsObject();
  stmt.free();

  const roomId = row.room_id || null;

  // Cascade delete (room_artifact_versions has ON DELETE CASCADE)
  raw.run('DELETE FROM room_artifacts WHERE id = ?', [artifactId]);
  db.persist();

  // Purge disk directory
  if (roomId) {
    const dirPath = path.join(roomDir(roomId), artifactId);
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
    } catch (_) { /* best-effort */ }
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  createArtifact,
  addArtifactVersion,
  listArtifacts,
  getArtifact,
  getArtifactContent,
  pinArtifact,
  archiveArtifact,
  deleteArtifact,
};
