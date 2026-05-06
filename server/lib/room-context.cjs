'use strict';

/**
 * server/lib/room-context.cjs
 *
 * Shared room context management and per-agent room state.
 *
 * CONTEXT.md (shared):
 *   - Plain Markdown file stored at <OPENCLAW_HOME>/rooms/<roomId>/CONTEXT.md
 *   - Append-only at the API level (agents can only append)
 *   - Each entry prepends a timestamp + author header
 *
 * Agent room state (per-user):
 *   - Stored in agent_profiles.meta JSON column
 *   - Shape: { roomState: { "<roomId>": { ...state } } }
 *   - Merged with existing state (non-destructive)
 */

const fs = require('fs');
const path = require('path');

const db = require('./db.cjs');
const config = require('./config.cjs');

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Resolve the on-disk directory for a room.
 * @param {string} roomId
 * @returns {string}
 */
function roomDir(roomId) {
  return path.join(config.OPENCLAW_HOME, 'rooms', roomId);
}

/**
 * Resolve the on-disk path to the CONTEXT.md file for a room.
 * @param {string} roomId
 * @returns {string}
 */
function contextFilePath(roomId) {
  return path.join(roomDir(roomId), 'CONTEXT.md');
}

// ─── Shared Room Context (CONTEXT.md) ──────────────────────────────────────

/**
 * Read the full CONTEXT.md for a room.
 *
 * @param {string} roomId
 * @returns {{ content: string, path: string }}
 *   - content: markdown string (empty '' if file doesn't exist)
 *   - path: absolute path to the file
 */
function getRoomContext(roomId) {
  const filePath = contextFilePath(roomId);
  let content = '';

  try {
    if (fs.existsSync(filePath)) {
      content = fs.readFileSync(filePath, 'utf-8');
    }
  } catch (err) {
    // File doesn't exist or is unreadable; return empty string
    content = '';
  }

  return { content, path: filePath };
}

/**
 * Append an entry to the room's CONTEXT.md.
 * Creates parent directories if they don't exist.
 * Entry format:
 *   ---
 *   ### [ISO timestamp] — [authorId]
 *
 *   [body text]
 *
 *
 * @param {string} roomId
 * @param {{ authorId: string, body: string }} options
 * @returns {{ content: string }} — the new full content after append
 */
function appendToContext(roomId, { authorId, body }) {
  if (!authorId || typeof authorId !== 'string') throw new Error('appendToContext: authorId is required');
  if (!body || typeof body !== 'string') throw new Error('appendToContext: body is required');
  const filePath = contextFilePath(roomId);
  const dir = path.dirname(filePath);

  // Ensure parent directories exist
  fs.mkdirSync(dir, { recursive: true });

  // Format the entry with ISO timestamp
  const timestamp = new Date().toISOString();
  const entry = `---\n### ${timestamp} — ${authorId}\n\n${body}\n\n`;

  // Read existing content (if any)
  let content = '';
  if (fs.existsSync(filePath)) {
    content = fs.readFileSync(filePath, 'utf-8');
  }

  // Append the new entry
  const newContent = content + entry;
  fs.writeFileSync(filePath, newContent, 'utf-8');

  return { content: newContent };
}

/**
 * Clear the CONTEXT.md file for a room (owner action only).
 * Caller is responsible for permission checks.
 *
 * @param {string} roomId
 * @returns {void}
 */
function clearContext(roomId) {
  const filePath = contextFilePath(roomId);

  try {
    if (fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '', 'utf-8');
    }
  } catch (err) {
    console.warn(`[room-context] clearContext failed for room ${roomId}:`, err.message);
  }
}

// ─── Per-Agent Room State (SQLite meta column) ─────────────────────────────

/**
 * Get per-room agent state for one agent.
 * Reads agent_profiles.meta and extracts roomState[roomId].
 *
 * @param {string} agentId
 * @param {string} roomId
 * @returns {{ state: object }}
 *   - state: the agent's state for this room, or {} if nothing stored
 */
function getAgentRoomState(agentId, roomId) {
  const raw = db.getDb();

  // Query the agent profile
  const result = raw.exec(
    'SELECT meta FROM agent_profiles WHERE agent_id = ?',
    [agentId]
  );

  if (!result || result.length === 0 || result[0].values.length === 0) {
    return { state: {} };
  }

  const [metaStr] = result[0].values[0];
  let meta = {};
  try {
    meta = metaStr ? JSON.parse(metaStr) : {};
  } catch {
    meta = {};
  }

  const roomState = meta.roomState || {};
  const state = roomState[roomId] || {};

  return { state };
}

/**
 * Set per-room agent state for one agent (merges with existing state).
 * Updates agent_profiles.meta.
 *
 * @param {string} agentId
 * @param {string} roomId
 * @param {object} state — partial state to merge
 * @returns {{ state: object }} — the full merged state for the room
 */
function setAgentRoomState(agentId, roomId, state) {
  const raw = db.getDb();

  // Get existing meta
  const result = raw.exec(
    'SELECT meta FROM agent_profiles WHERE agent_id = ?',
    [agentId]
  );

  let meta = {};
  if (result && result.length > 0 && result[0].values.length > 0) {
    const [metaStr] = result[0].values[0];
    try {
      meta = metaStr ? JSON.parse(metaStr) : {};
    } catch {
      meta = {};
    }
  }

  // Initialize roomState if not present
  if (!meta.roomState) {
    meta.roomState = {};
  }

  // Merge the new state into the existing room state
  const existingRoomState = meta.roomState[roomId] || {};
  meta.roomState[roomId] = { ...existingRoomState, ...state };

  // Write back to DB
  raw.run(
    'UPDATE agent_profiles SET meta = ? WHERE agent_id = ?',
    [JSON.stringify(meta), agentId]
  );

  // Persist to disk
  db.persist();

  return { state: meta.roomState[roomId] };
}

// ─── Exports ──────────────────────────────────────────────────────────────

module.exports = {
  getRoomContext,
  appendToContext,
  clearContext,
  getAgentRoomState,
  setAgentRoomState,
};
