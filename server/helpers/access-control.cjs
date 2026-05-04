/**
 * helpers/access-control.cjs
 *
 * Pure access-control helper functions. Each receives `req` and the relevant
 * dependencies explicitly — no module-level state.
 */
'use strict';

/**
 * @param {object} req - Express request with req.user
 * @param {string} agentId
 * @param {object} db
 * @returns {boolean}
 */
function canAccessAgent(req, agentId, db) {
  if (!agentId) return false;
  if (agentId === 'main') return true;
  return db.userOwnsAgent(req, agentId);
}

/**
 * Validate and normalize agent IDs, throwing 403 if any are inaccessible.
 *
 * @param {object} req
 * @param {string[]} ids
 * @param {object} db
 * @returns {string[]} normalized IDs
 */
function validateAccessibleAgentIds(req, ids, db) {
  const normalized = [];
  for (const raw of (Array.isArray(ids) ? ids : [])) {
    const id = String(raw || '').trim();
    if (!id || normalized.includes(id)) continue;
    if (!canAccessAgent(req, id, db)) {
      const err = new Error(`You do not have permission to add agent ${id}`);
      err.status = 403;
      throw err;
    }
    normalized.push(id);
  }
  return normalized;
}

/**
 * @param {object} req
 * @param {object} room
 * @param {object} db
 * @returns {boolean}
 */
function canAccessRoom(req, room, db) {
  if (!room) return false;
  if (req.user?.role === 'admin' || req.user?.role === 'agent') return true;
  if (room.kind === 'global') return true;
  if (room.projectId && db.userOwnsProject(req, room.projectId)) return true;
  return room.memberAgentIds?.some(id => id !== 'main' && db.userOwnsAgent(req, id));
}

/**
 * Fetch a room by ID and check access. Returns the room or null (after sending error response).
 *
 * @param {object} req
 * @param {object} res
 * @param {string} roomId
 * @param {object} db
 * @returns {object|null}
 */
function withRoomAccess(req, res, roomId, db) {
  const room = db.getMissionRoom(roomId);
  if (!room) {
    res.status(404).json({ error: 'Room not found' });
    return null;
  }
  if (!canAccessRoom(req, room, db)) {
    res.status(403).json({ error: 'You do not have access to this room' });
    return null;
  }
  return room;
}

/**
 * @param {object} rooms
 * @returns {{ global: object[], project: object[] }}
 */
function groupRoomsForClient(rooms) {
  return {
    global: rooms.filter(r => r.kind === 'global'),
    project: rooms.filter(r => r.kind === 'project'),
  };
}

/**
 * Returns a reason string if user isn't allowed to mutate the task, or null.
 * Rule: admin bypass; else user must own the task's agent. Tasks without
 * an agentId require admin.
 *
 * @param {object} req
 * @param {string} taskId
 * @param {object} db
 * @returns {string|null}
 */
function checkTaskAccess(req, taskId, db) {
  if (req.user?.role === 'admin' || req.user?.role === 'agent') return null;
  const task = db.getTask(taskId);
  if (!task) return 'Task not found';
  if (!task.agentId) return 'Only admin can modify unassigned tasks';
  if (!db.userOwnsAgent(req, task.agentId)) return 'You can only modify tasks on agents you own';
  return null;
}

/**
 * @param {object} req
 * @param {string} jobId
 * @param {object} db
 * @param {object} parsers
 * @returns {Promise<string|null>}
 */
async function checkCronAccess(req, jobId, db, parsers) {
  if (req.user?.role === 'admin' || req.user?.role === 'agent') return null;
  try {
    const jobs = parsers.parseCronJobs();
    const job = (jobs || []).find(j => j.id === jobId);
    if (!job) return null; // let handler return 404 naturally
    if (job.agentId && !db.userOwnsAgent(req, job.agentId)) {
      return 'You can only manage cron jobs for agents you own';
    }
  } catch { /* if list fails, fall through and let handler error */ }
  return null;
}

/**
 * Returns a reason string if user isn't allowed to install with the given
 * target/agent combination, or null if allowed.
 *
 * @param {object} req
 * @param {string} target
 * @param {string} agentId
 * @param {object} db
 * @returns {string|null}
 */
function checkSkillInstallTarget(req, target, agentId, db) {
  if (req.user?.role === 'admin' || req.user?.role === 'agent') return null;
  if (target === 'global') return 'Only admin can install to global library';
  if (target === 'agent' && agentId && !db.userOwnsAgent(req, agentId)) {
    return 'You can only install skills to agents you own';
  }
  return null;
}

module.exports = {
  canAccessAgent,
  validateAccessibleAgentIds,
  canAccessRoom,
  withRoomAccess,
  groupRoomsForClient,
  checkTaskAccess,
  checkCronAccess,
  checkSkillInstallTarget,
};
