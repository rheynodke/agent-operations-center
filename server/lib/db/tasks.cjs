'use strict';

/**
 * Tasks + epics + dependencies + activity log + comments.
 *
 * Five related tables consolidated here because their lifecycles are
 * intertwined (an epic groups tasks; tasks have activity + comments;
 * dependencies are directed edges between tasks):
 *
 * - **`tasks`** — work items. Carries optional ADLC fields (stage/role/epicId).
 * - **`epics`** — Phase B grouping for ADLC projects. `deleteEpic` detaches
 *   tasks rather than cascading.
 * - **`task_dependencies`** — directed edges (`blocks` kind by default).
 *   `wouldCreateDependencyCycle` is the BFS guard that prevents circular
 *   blocks; `getUnmetBlockers` is consumed by the dispatch guard.
 * - **`task_activity`** — append-only audit of status/priority/assignment
 *   changes. UI surfaces this as the timeline tab.
 * - **`task_comments`** — soft-deletable discussion thread per task.
 */

const crypto = require('node:crypto');
const handle = require('./_handle.cjs');
function _db() { return handle.getDb(); }

// ─── Normalizers ────────────────────────────────────────────────────────────

function normalizeTask(row) {
  if (!row || !row.id) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description || undefined,
    status: row.status,
    priority: row.priority || 'medium',
    agentId: row.agent_id || undefined,
    sessionId: row.session_id || undefined,
    tags: (() => { try { return row.tags ? JSON.parse(row.tags) : []; } catch { return []; } })(),
    cost: row.cost != null ? row.cost : undefined,
    inputTokens: row.input_tokens != null ? row.input_tokens : undefined,
    outputTokens: row.output_tokens != null ? row.output_tokens : undefined,
    projectId: row.project_id || 'general',
    externalId: row.external_id || undefined,
    externalSource: row.external_source || undefined,
    requestFrom: row.request_from || '-',
    analysis: (() => { try { return row.analysis ? JSON.parse(row.analysis) : null; } catch { return null; } })(),
    attachments: (() => { try { return row.attachments ? JSON.parse(row.attachments) : []; } catch { return []; } })(),
    stage: row.stage || undefined,
    role: row.role || undefined,
    epicId: row.epic_id || undefined,
    memoryReviewedAt: row.memory_reviewed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || undefined,
  };
}

function normalizeActivity(row) {
  if (!row || !row.id) return null;
  return {
    id: row.id,
    taskId: row.task_id,
    type: row.type,
    fromValue: row.from_value || undefined,
    toValue: row.to_value || undefined,
    actor: row.actor,
    note: row.note || undefined,
    createdAt: row.created_at,
  };
}

function normalizeComment(row) {
  if (!row || !row.id) return null;
  return {
    id: row.id,
    taskId: row.task_id,
    authorType: row.author_type,
    authorId: row.author_id,
    authorName: row.author_name || undefined,
    body: row.body,
    createdAt: row.created_at,
    editedAt: row.edited_at || undefined,
    deletedAt: row.deleted_at || undefined,
  };
}

function normalizeEpic(row) {
  if (!row || !row.id) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description || undefined,
    status: row.status || 'open',
    color: row.color || undefined,
    createdBy: row.created_by != null ? Number(row.created_by) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeDep(row) {
  if (!row || !row.id) return null;
  return {
    id: row.id,
    blockerTaskId: row.blocker_task_id,
    blockedTaskId: row.blocked_task_id,
    kind: row.kind || 'blocks',
    createdAt: row.created_at,
  };
}

// ─── Tasks CRUD ─────────────────────────────────────────────────────────────

function getAllTasks(filters = {}) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  const conditions = [];
  const params = {};
  if (filters.agentId) { conditions.push('agent_id = :agentId'); params[':agentId'] = filters.agentId; }
  if (filters.status)  { conditions.push('status = :status');    params[':status']  = filters.status; }
  if (filters.priority){ conditions.push('priority = :priority');params[':priority']= filters.priority; }
  if (filters.tag)     { conditions.push('tags LIKE :tag');      params[':tag']     = `%"${filters.tag}"%`; }
  if (filters.q)       { conditions.push('title LIKE :q');       params[':q']       = `%${filters.q}%`; }
  if (filters.projectId) { conditions.push('project_id = :projectId'); params[':projectId'] = filters.projectId; }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const stmt = db.prepare(`SELECT * FROM tasks ${where} ORDER BY created_at DESC`);
  if (Object.keys(params).length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(normalizeTask(stmt.getAsObject()));
  stmt.free();
  return rows;
}

function getTask(id) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  const stmt = db.prepare('SELECT * FROM tasks WHERE id = :id');
  const row = stmt.getAsObject({ ':id': id });
  stmt.free();
  return row.id ? normalizeTask(row) : null;
}

function getTaskByExternalId(externalId, externalSource) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  const stmt = db.prepare('SELECT * FROM tasks WHERE external_id = :eid AND external_source = :src LIMIT 1');
  const row = stmt.getAsObject({ ':eid': externalId, ':src': externalSource });
  stmt.free();
  return row.id ? normalizeTask(row) : null;
}

function createTask({
  title, description, status = 'backlog', priority = 'medium',
  agentId, tags = [], sessionId,
  projectId = 'general', externalId, externalSource,
  requestFrom = '-', attachments = [],
  stage, role, epicId,
} = {}) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  if (!title) throw new Error('createTask: title is required');
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.run(
    'INSERT INTO tasks (id, title, description, status, priority, agent_id, session_id, tags, project_id, external_id, external_source, request_from, attachments, stage, role, epic_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      id, title, description || null, status, priority,
      agentId || null, sessionId || null, JSON.stringify(tags || []),
      projectId, externalId || null, externalSource || null,
      requestFrom || '-', JSON.stringify(attachments || []),
      stage || null, role || null, epicId || null,
      now, now,
    ]
  );
  handle.persist();
  return getTask(id);
}

function updateTask(id, patch) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  const before = getTask(id);
  if (!before) return null;
  const now = new Date().toISOString();
  const fields = ['updated_at = ?'];
  const vals = [now];
  if (patch.title       !== undefined) { fields.push('title = ?');       vals.push(patch.title); }
  if (patch.description !== undefined) { fields.push('description = ?'); vals.push(patch.description || null); }
  if (patch.status      !== undefined) { fields.push('status = ?');      vals.push(patch.status); }
  if (patch.priority    !== undefined) { fields.push('priority = ?');    vals.push(patch.priority); }
  if (patch.agentId     !== undefined) { fields.push('agent_id = ?');    vals.push(patch.agentId || null); }
  if (patch.sessionId   !== undefined) { fields.push('session_id = ?');  vals.push(patch.sessionId || null); }
  if (patch.tags        !== undefined) { fields.push('tags = ?');        vals.push(JSON.stringify(patch.tags)); }
  if (patch.cost         !== undefined) { fields.push('cost = ?');          vals.push(patch.cost); }
  if (patch.inputTokens  !== undefined) { fields.push('input_tokens = ?');  vals.push(patch.inputTokens  != null ? Number(patch.inputTokens)  : null); }
  if (patch.outputTokens !== undefined) { fields.push('output_tokens = ?'); vals.push(patch.outputTokens != null ? Number(patch.outputTokens) : null); }
  if (patch.requestFrom  !== undefined) { fields.push('request_from = ?');  vals.push(patch.requestFrom || '-'); }
  if (patch.analysis     !== undefined) { fields.push('analysis = ?');      vals.push(typeof patch.analysis === 'string' ? patch.analysis : JSON.stringify(patch.analysis)); }
  if (patch.attachments  !== undefined) { fields.push('attachments = ?');   vals.push(JSON.stringify(Array.isArray(patch.attachments) ? patch.attachments : [])); }
  if (patch.stage        !== undefined) { fields.push('stage = ?');         vals.push(patch.stage || null); }
  if (patch.role         !== undefined) { fields.push('role = ?');          vals.push(patch.role || null); }
  if (patch.epicId       !== undefined) { fields.push('epic_id = ?');       vals.push(patch.epicId || null); }
  if (patch.memoryReviewedAt !== undefined) { fields.push('memory_reviewed_at = ?'); vals.push(patch.memoryReviewedAt || null); }
  if (patch.status === 'done' && before.status !== 'done') {
    fields.push('completed_at = ?'); vals.push(now);
  } else if (patch.status !== undefined && patch.status !== 'done' && before.status === 'done') {
    fields.push('completed_at = ?'); vals.push(null);
  }
  vals.push(id);
  db.run(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`, vals);
  handle.persist();
  return getTask(id);
}

function deleteTask(id) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  db.run('DELETE FROM task_activity WHERE task_id = ?', [id]);
  db.run('DELETE FROM task_dependencies WHERE blocker_task_id = ? OR blocked_task_id = ?', [id, id]);
  db.run('DELETE FROM tasks WHERE id = ?', [id]);
  handle.persist();
}

function getTaskSessionKeys() {
  const db = _db();
  if (!db) return [];
  const stmt = db.prepare('SELECT session_id FROM tasks WHERE session_id IS NOT NULL');
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject().session_id);
  stmt.free();
  return rows;
}

// ─── Epics ──────────────────────────────────────────────────────────────────

function listEpics(projectId) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  if (!projectId) return [];
  const stmt = db.prepare('SELECT * FROM epics WHERE project_id = :p ORDER BY created_at DESC');
  stmt.bind({ ':p': projectId });
  const rows = [];
  while (stmt.step()) rows.push(normalizeEpic(stmt.getAsObject()));
  stmt.free();
  return rows;
}

function getEpic(id) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  const stmt = db.prepare('SELECT * FROM epics WHERE id = :id');
  const row = stmt.getAsObject({ ':id': id });
  stmt.free();
  return row.id ? normalizeEpic(row) : null;
}

function createEpic({ projectId, title, description, status = 'open', color, createdBy } = {}) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  if (!projectId) throw new Error('createEpic: projectId is required');
  if (!title) throw new Error('createEpic: title is required');
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.run(
    'INSERT INTO epics (id, project_id, title, description, status, color, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, projectId, title, description || null, status, color || null, createdBy != null ? Number(createdBy) : null, now, now]
  );
  handle.persist();
  return getEpic(id);
}

function updateEpic(id, patch) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  const before = getEpic(id);
  if (!before) return null;
  const now = new Date().toISOString();
  const fields = ['updated_at = ?'];
  const vals = [now];
  if (patch.title       !== undefined) { fields.push('title = ?');       vals.push(patch.title); }
  if (patch.description !== undefined) { fields.push('description = ?'); vals.push(patch.description || null); }
  if (patch.status      !== undefined) { fields.push('status = ?');      vals.push(patch.status); }
  if (patch.color       !== undefined) { fields.push('color = ?');       vals.push(patch.color || null); }
  vals.push(id);
  db.run(`UPDATE epics SET ${fields.join(', ')} WHERE id = ?`, vals);
  handle.persist();
  return getEpic(id);
}

function deleteEpic(id) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  db.run('UPDATE tasks SET epic_id = NULL, updated_at = ? WHERE epic_id = ?', [new Date().toISOString(), id]);
  db.run('DELETE FROM epics WHERE id = ?', [id]);
  handle.persist();
}

// ─── Dependencies ───────────────────────────────────────────────────────────

function listDependenciesForTask(taskId) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  const stmt = db.prepare(
    'SELECT * FROM task_dependencies WHERE blocker_task_id = :id OR blocked_task_id = :id ORDER BY created_at ASC'
  );
  stmt.bind({ ':id': taskId });
  const rows = [];
  while (stmt.step()) rows.push(normalizeDep(stmt.getAsObject()));
  stmt.free();
  return rows;
}

function wouldCreateDependencyCycle(blockerTaskId, blockedTaskId) {
  const db = _db();
  if (!db) return false;
  const visited = new Set();
  const queue = [blockedTaskId];
  while (queue.length) {
    const cur = queue.shift();
    if (cur === blockerTaskId) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);
    const stmt = db.prepare('SELECT blocked_task_id FROM task_dependencies WHERE blocker_task_id = ? AND kind = ?');
    stmt.bind([cur, 'blocks']);
    while (stmt.step()) queue.push(stmt.getAsObject().blocked_task_id);
    stmt.free();
  }
  return false;
}

function getUnmetBlockers(taskId) {
  const db = _db();
  if (!db) return [];
  const stmt = db.prepare(`
    SELECT t.* FROM task_dependencies d
    JOIN tasks t ON t.id = d.blocker_task_id
    WHERE d.blocked_task_id = ? AND d.kind = 'blocks'
      AND t.status NOT IN ('done', 'cancelled')
    ORDER BY t.created_at ASC
  `);
  stmt.bind([taskId]);
  const rows = [];
  while (stmt.step()) rows.push(normalizeTask(stmt.getAsObject()));
  stmt.free();
  return rows;
}

function listDependenciesForProject(projectId) {
  const db = _db();
  if (!db) return [];
  const stmt = db.prepare(`
    SELECT d.* FROM task_dependencies d
    JOIN tasks t ON t.id = d.blocker_task_id OR t.id = d.blocked_task_id
    WHERE t.project_id = ?
    GROUP BY d.id
    ORDER BY d.created_at ASC
  `);
  stmt.bind([projectId]);
  const rows = [];
  while (stmt.step()) rows.push(normalizeDep(stmt.getAsObject()));
  stmt.free();
  return rows;
}

function addTaskDependency({ blockerTaskId, blockedTaskId, kind = 'blocks' } = {}) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  if (!blockerTaskId || !blockedTaskId) throw new Error('addTaskDependency: both task ids required');
  if (blockerTaskId === blockedTaskId) throw new Error('addTaskDependency: cannot depend on self');
  if (kind === 'blocks' && wouldCreateDependencyCycle(blockerTaskId, blockedTaskId)) {
    const err = new Error('Adding this dependency would create a cycle');
    err.code = 'DEP_CYCLE';
    throw err;
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    db.run(
      'INSERT INTO task_dependencies (id, blocker_task_id, blocked_task_id, kind, created_at) VALUES (?, ?, ?, ?, ?)',
      [id, blockerTaskId, blockedTaskId, kind, now]
    );
    handle.persist();
  } catch (e) {
    if (String(e.message || e).includes('UNIQUE')) {
      const stmt = db.prepare('SELECT * FROM task_dependencies WHERE blocker_task_id = ? AND blocked_task_id = ? AND kind = ?');
      stmt.bind([blockerTaskId, blockedTaskId, kind]);
      const row = stmt.step() ? stmt.getAsObject() : null;
      stmt.free();
      return row ? normalizeDep(row) : null;
    }
    throw e;
  }
  const stmt = db.prepare('SELECT * FROM task_dependencies WHERE id = :id');
  const row = stmt.getAsObject({ ':id': id });
  stmt.free();
  return row.id ? normalizeDep(row) : null;
}

function removeTaskDependency(id) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  db.run('DELETE FROM task_dependencies WHERE id = ?', [id]);
  handle.persist();
}

// ─── Activity log ───────────────────────────────────────────────────────────

function addTaskActivity({ taskId, type, fromValue, toValue, actor, note } = {}) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  if (!taskId || !type || !actor) throw new Error('addTaskActivity: taskId, type, and actor are required');
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.run(
    'INSERT INTO task_activity (id, task_id, type, from_value, to_value, actor, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, taskId, type, fromValue || null, toValue || null, actor, note || null, now]
  );
  handle.persist();
}

function getTaskActivity(taskId) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  const stmt = db.prepare('SELECT * FROM task_activity WHERE task_id = :taskId ORDER BY created_at ASC');
  stmt.bind({ ':taskId': taskId });
  const rows = [];
  while (stmt.step()) rows.push(normalizeActivity(stmt.getAsObject()));
  stmt.free();
  return rows;
}

// ─── Comments ───────────────────────────────────────────────────────────────

function addTaskComment({ taskId, authorType, authorId, authorName, body } = {}) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  if (!taskId) throw new Error('addTaskComment: taskId is required');
  if (!body || !body.trim()) throw new Error('addTaskComment: body is required');
  if (authorType !== 'user' && authorType !== 'agent') throw new Error('addTaskComment: authorType must be user or agent');
  if (!authorId) throw new Error('addTaskComment: authorId is required');
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.run(
    'INSERT INTO task_comments (id, task_id, author_type, author_id, author_name, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, taskId, authorType, String(authorId), authorName || null, body, now]
  );
  handle.persist();
  return getTaskComment(id);
}

function getTaskComment(id) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  const stmt = db.prepare('SELECT * FROM task_comments WHERE id = :id');
  const row = stmt.getAsObject({ ':id': id });
  stmt.free();
  return row.id ? normalizeComment(row) : null;
}

function listTaskComments(taskId, { includeDeleted = false } = {}) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  const stmt = db.prepare('SELECT * FROM task_comments WHERE task_id = :taskId ORDER BY created_at ASC');
  stmt.bind({ ':taskId': taskId });
  const rows = [];
  while (stmt.step()) {
    const c = normalizeComment(stmt.getAsObject());
    if (c && (includeDeleted || !c.deletedAt)) rows.push(c);
  }
  stmt.free();
  return rows;
}

function updateTaskComment(id, { body } = {}) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  if (!body || !body.trim()) throw new Error('updateTaskComment: body is required');
  const now = new Date().toISOString();
  db.run('UPDATE task_comments SET body = ?, edited_at = ? WHERE id = ? AND deleted_at IS NULL', [body, now, id]);
  handle.persist();
  return getTaskComment(id);
}

function deleteTaskComment(id) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  const now = new Date().toISOString();
  db.run('UPDATE task_comments SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL', [now, id]);
  handle.persist();
  return getTaskComment(id);
}

function getRecentTaskComments(taskId, limit = 10) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  const stmt = db.prepare(
    'SELECT * FROM (SELECT * FROM task_comments WHERE task_id = :taskId AND deleted_at IS NULL ORDER BY created_at DESC LIMIT :lim) ORDER BY created_at ASC'
  );
  stmt.bind({ ':taskId': taskId, ':lim': limit });
  const rows = [];
  while (stmt.step()) rows.push(normalizeComment(stmt.getAsObject()));
  stmt.free();
  return rows;
}

module.exports = {
  // Tasks
  normalizeTask, normalizeActivity, normalizeComment, normalizeEpic, normalizeDep,
  getAllTasks, getTask, getTaskByExternalId, createTask, updateTask, deleteTask,
  getTaskSessionKeys,
  // Epics
  listEpics, getEpic, createEpic, updateEpic, deleteEpic,
  // Dependencies
  listDependenciesForTask, listDependenciesForProject,
  wouldCreateDependencyCycle, getUnmetBlockers,
  addTaskDependency, removeTaskDependency,
  // Activity
  addTaskActivity, getTaskActivity,
  // Comments
  addTaskComment, getTaskComment, listTaskComments, updateTaskComment, deleteTaskComment,
  getRecentTaskComments,
};
