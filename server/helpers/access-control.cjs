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
  // 'main' is admin-private (owner = userId 1). Admin bypass already happens
  // inside db.userOwnsAgent for both the admin and 'agent' roles.
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
  // Filter out the user's own master — its presence alone shouldn't grant access
  // (master is auto-added everywhere). Falls back to 'main' for legacy admin-era rows.
  const userMasterId = db.getUserMasterAgentId?.(req.user?.userId) || 'main';
  return room.memberAgentIds?.some(id => id !== userMasterId && db.userOwnsAgent(req, id));
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
    // Per-user cron file — without scoping userId, this defaults to admin's
    // ~/.openclaw/cron/jobs.json and silently bypasses the access check for
    // every non-admin user (their job is never found there).
    const targetUid = parseScopeUserId(req);
    const jobs = parsers.parseCronJobs(targetUid);
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

/**
 * Parse req.query.owner into a normalized scope.
 * - empty/missing: 'all' for admin, 'me' otherwise
 * - 'me' / 'all' / numeric id: as given
 * - garbage: fallback to 'all' for admin, 'me' otherwise
 *
 * @returns {'me'|'all'|number}
 */
function parseOwnerParam(req) {
  const raw = req?.query?.owner;
  const fallback = req?.user?.role === 'admin' ? 'all' : 'me';
  if (raw == null || raw === '') return fallback;
  const s = String(raw).trim();
  if (s === 'me') return 'me';
  if (s === 'all') return 'all';
  const n = Number(s);
  if (Number.isInteger(n) && n > 0) return n;
  return fallback;
}

/**
 * Pure filter for the GET /api/agents list.
 *
 * @param {object[]} allAgents   - raw enriched agent array
 * @param {object}   user        - req.user (role, userId)
 * @param {'me'|'all'|number} scope - from parseOwnerParam
 * @param {function}  getOwnerFn - (agentId) => number|null
 * @returns {object[]}
 */
function filterAgentsByOwner(allAgents, user, scope, getOwnerFn) {
  const isAdmin = user?.role === 'admin';
  // When admin impersonates a specific user (scope is numeric), the ownership
  // lookup must use THAT scope as the disambiguation hint — not admin's own
  // userId — otherwise composite-PK `WHERE agent_id = ? AND provisioned_by = ?`
  // returns null and every impersonated agent is filtered out.
  const lookupHint = isAdmin && typeof scope === 'number' ? scope : user?.userId;
  return allAgents.filter((agent) => {
    // 'main' is admin-private (owner = userId 1) — strict per-user, not a shared agent.
    const ownerId = agent.id === 'main' ? 1 : getOwnerFn(agent.id, lookupHint);
    if (isAdmin) {
      // Admin defaults to own scope — cross-tenant monitoring will be a separate feature.
      if (scope === 'all') return true;
      if (typeof scope === 'number') return ownerId === scope;
      // 'me' or anything else → strict own scope
      return ownerId === user.userId;
    }
    return ownerId === user.userId;
  });
}

/**
 * Resolve the userId whose data should be returned for this request.
 * Admin can impersonate via ?owner=<numeric id>; non-admin always self.
 * Returns the authenticated user's id when no valid impersonation is present.
 *
 * @param {object} req
 * @returns {number}
 */
function parseScopeUserId(req) {
  const raw = req?.query?.owner;
  if (raw != null && req?.user?.role === 'admin') {
    const n = Number(raw);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return Number(req?.user?.userId ?? req?.user?.id);
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
  parseOwnerParam,
  filterAgentsByOwner,
  parseScopeUserId,
};
