'use strict';

/**
 * hq-room.cjs — Pure helper library for HQ mission room management.
 *
 * HQ room is a per-user system room (`is_hq=1, is_system=1`) that serves as the
 * team command center. The master agent is always a member and cannot be removed.
 *
 * Functions:
 *   ensureHqRoom(db, userId, masterAgentId)        — create HQ room (idempotent)
 *   addAgentToHq(db, userId, agentId)              — add agent to membership (idempotent)
 *   removeAgentFromHq(db, userId, agentId)         — remove agent (refuses to remove master)
 *   postHqSystemMessage(db, userId, body, opts)    — post a system message into HQ
 */

/**
 * Create the HQ room for a user if it doesn't exist yet.
 * Idempotent — returns the existing room on subsequent calls.
 *
 * @param {object} db           - db.cjs module instance
 * @param {number} userId       - owner user id
 * @param {string} masterAgentId - the user's master agent id
 * @returns {object} normalized room object
 */
function ensureHqRoom(db, userId, masterAgentId) {
  const existing = db.getHqRoomForUser(userId);
  if (existing) return existing;

  // Create the room via the standard helper (which auto-prepends the master).
  const room = db.createMissionRoom({
    kind: 'global',
    name: 'HQ',
    description: 'Your team command center.',
    memberAgentIds: [],
    createdBy: userId,
    masterAgentId,
  });

  // Patch HQ-specific flags that createMissionRoom doesn't set.
  // db.run is not exported directly; use db.getDb() to access the raw sql.js instance.
  const rawDb = db.getDb ? db.getDb() : null;
  if (rawDb) {
    rawDb.run(
      'UPDATE mission_rooms SET is_hq = 1, is_system = 1, owner_user_id = ? WHERE id = ?',
      [Number(userId), room.id]
    );
  }
  if (db.persist) db.persist();

  return db.getHqRoomForUser(userId);
}

/**
 * Add an agent to the HQ room's membership. Idempotent — no-op if already present.
 *
 * @param {object} db      - db.cjs module instance
 * @param {number} userId  - owner user id
 * @param {string} agentId - agent to add
 * @returns {object} updated normalized room object
 */
function addAgentToHq(db, userId, agentId) {
  const room = db.getHqRoomForUser(userId);
  if (!room) throw new Error(`No HQ room found for user ${userId}`);

  const current = room.memberAgentIds || [];
  if (current.includes(agentId)) return room;

  const masterId = db.getUserMasterAgentId(userId) || 'main';
  return db.updateMissionRoomMembers(room.id, [...current, agentId], masterId);
}

/**
 * Remove an agent from the HQ room's membership.
 * Throws if the agent is the user's master — master cannot be removed from HQ.
 *
 * @param {object} db      - db.cjs module instance
 * @param {number} userId  - owner user id
 * @param {string} agentId - agent to remove
 * @returns {object} updated normalized room object
 */
function removeAgentFromHq(db, userId, agentId) {
  const room = db.getHqRoomForUser(userId);
  if (!room) throw new Error(`No HQ room found for user ${userId}`);

  const masterId = db.getUserMasterAgentId(userId);
  if (masterId && agentId === masterId) {
    throw new Error('Cannot remove master agent from HQ room');
  }

  const current = room.memberAgentIds || [];
  const next = current.filter(id => id !== agentId);
  return db.updateMissionRoomMembers(room.id, next, masterId || 'main');
}

/**
 * Post a system message into the user's HQ room.
 * Returns null (without throwing) if no HQ room exists for the user yet.
 *
 * @param {object} db           - db.cjs module instance
 * @param {number} userId       - owner user id
 * @param {string} body         - message text
 * @param {object} [opts]       - optional: { relatedTaskId, meta }
 * @returns {object|null} normalized message object, or null if no HQ room
 */
function postHqSystemMessage(db, userId, body, opts = {}) {
  const room = db.getHqRoomForUser(userId);
  if (!room) return null;

  return db.createMissionMessage({
    roomId: room.id,
    authorType: 'system',
    authorId: 'hq',
    authorName: 'HQ',
    body,
    relatedTaskId: opts.relatedTaskId || null,
    meta: opts.meta || {},
  });
}

module.exports = { ensureHqRoom, addAgentToHq, removeAgentFromHq, postHqSystemMessage };
