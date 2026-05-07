'use strict';

/**
 * Projects + integrations + project memory.
 *
 * Three related tables grouped here:
 *
 * - **`projects`** — workspace bindings + lifecycle. `'general'` is the seeded
 *   shared project (owner=null treated as shared, see ownership rules below).
 * - **`project_integrations`** — third-party syncs (Google Sheets etc).
 *   `_mapIntegrationRaw` returns the un-redacted row for the sync orchestrator;
 *   the public `getProjectIntegrations` strips `credentials` from `config`.
 * - **`project_memory`** — decisions / questions / risks / glossary captured
 *   per project. Built into the agent dispatch context snapshot.
 *
 * Ownership model (`userOwnsProject`):
 *   - admin role  → bypass
 *   - agent token → bypass
 *   - 'general' or any null-owner row → treated as shared
 *   - else → only the creator
 */

const crypto = require('node:crypto');
const handle = require('./_handle.cjs');
function _db() { return handle.getDb(); }

// Projects depend on rooms.cjs::ensureProjectDefaultRoom — lazy require to
// dodge circular init.
function _ensureProjectDefaultRoom(projectId, createdBy) {
  return require('./rooms.cjs').ensureProjectDefaultRoom(projectId, createdBy);
}

// ─── Projects CRUD ──────────────────────────────────────────────────────────

function normalizeProject(row) {
  if (!row || !row.id) return null;
  return {
    id: row.id,
    name: row.name,
    color: row.color || '#6366f1',
    description: row.description || undefined,
    kind: row.kind || 'ops',
    workspacePath: row.workspace_path || undefined,
    workspaceMode: row.workspace_mode || undefined,
    repoUrl: row.repo_url || undefined,
    repoBranch: row.repo_branch || undefined,
    repoRemoteName: row.repo_remote_name || undefined,
    boundAt: row.bound_at != null ? Number(row.bound_at) : undefined,
    lastFetchedAt: row.last_fetched_at != null ? Number(row.last_fetched_at) : undefined,
    createdBy: row.created_by != null ? Number(row.created_by) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getAllProjects() {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  const stmt = db.prepare('SELECT * FROM projects ORDER BY created_at ASC');
  const rows = [];
  while (stmt.step()) rows.push(normalizeProject(stmt.getAsObject()));
  stmt.free();
  return rows;
}

function getProject(id) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  const stmt = db.prepare('SELECT * FROM projects WHERE id = :id');
  const row = stmt.getAsObject({ ':id': id });
  stmt.free();
  return row.id ? normalizeProject(row) : null;
}

function getProjectByPath(workspacePath) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  if (!workspacePath) return null;
  const stmt = db.prepare('SELECT * FROM projects WHERE workspace_path = :p');
  const row = stmt.getAsObject({ ':p': workspacePath });
  stmt.free();
  return row.id ? normalizeProject(row) : null;
}

function createProject({
  name, color = '#6366f1', description,
  kind, workspacePath, workspaceMode,
  repoUrl, repoBranch, repoRemoteName,
  createdBy,
} = {}) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  if (!name) throw new Error('createProject: name is required');
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const boundAt = (workspacePath ? Date.now() : null);
  db.run(
    `INSERT INTO projects (
       id, name, color, description, kind,
       workspace_path, workspace_mode,
       repo_url, repo_branch, repo_remote_name, bound_at,
       created_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, name, color, description || null, kind || 'ops',
      workspacePath || null, workspaceMode || null,
      repoUrl || null, repoBranch || null, repoRemoteName || null, boundAt,
      createdBy != null ? Number(createdBy) : null,
      now, now,
    ]
  );
  _ensureProjectDefaultRoom(id, createdBy);
  handle.persist();
  return getProject(id);
}

function updateProject(id, patch) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  const before = getProject(id);
  if (!before) return null;
  const now = new Date().toISOString();
  const fields = ['updated_at = ?'];
  const vals = [now];
  if (patch.name        !== undefined) { fields.push('name = ?');        vals.push(patch.name); }
  if (patch.color       !== undefined) { fields.push('color = ?');       vals.push(patch.color); }
  if (patch.description !== undefined) { fields.push('description = ?'); vals.push(patch.description || null); }
  if (patch.kind        !== undefined) { fields.push('kind = ?');        vals.push(patch.kind || 'ops'); }
  vals.push(id);
  db.run(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`, vals);
  handle.persist();
  return getProject(id);
}

function setProjectWorkspace(id, {
  workspacePath, workspaceMode,
  repoUrl, repoBranch, repoRemoteName,
  boundAt,
} = {}) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  const before = getProject(id);
  if (!before) return null;
  const now = new Date().toISOString();
  const fields = ['updated_at = ?'];
  const vals = [now];
  if (workspacePath   !== undefined) { fields.push('workspace_path = ?');   vals.push(workspacePath); }
  if (workspaceMode   !== undefined) { fields.push('workspace_mode = ?');   vals.push(workspaceMode); }
  if (repoUrl         !== undefined) { fields.push('repo_url = ?');         vals.push(repoUrl); }
  if (repoBranch      !== undefined) { fields.push('repo_branch = ?');      vals.push(repoBranch); }
  if (repoRemoteName  !== undefined) { fields.push('repo_remote_name = ?'); vals.push(repoRemoteName); }
  if (boundAt         !== undefined) { fields.push('bound_at = ?');         vals.push(boundAt); }
  vals.push(id);
  db.run(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`, vals);
  handle.persist();
  return getProject(id);
}

function bumpProjectFetchedAt(id, ts = Date.now()) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  db.run('UPDATE projects SET last_fetched_at = ?, updated_at = ? WHERE id = ?',
    [ts, new Date().toISOString(), id]);
  handle.persist();
  return getProject(id);
}

function deleteProject(id) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  if (id === 'general') throw new Error('deleteProject: cannot delete the default project');
  db.run("UPDATE tasks SET project_id = 'general' WHERE project_id = ?", [id]);
  db.run('DELETE FROM project_integrations WHERE project_id = ?', [id]);
  db.run('DELETE FROM projects WHERE id = ?', [id]);
  handle.persist();
}

// ─── Integrations ───────────────────────────────────────────────────────────

function normalizeIntegration(row) {
  if (!row || !row.id) return null;
  let config = {};
  try { config = JSON.parse(row.config || '{}'); } catch (_) {}
  const { credentials, ...safeConfig } = config;
  void credentials;
  return {
    id: row.id,
    projectId: row.project_id,
    type: row.type,
    hasCredentials: !!credentials,
    config: safeConfig,
    syncIntervalMs: row.sync_interval_ms || undefined,
    enabled: row.enabled === 1,
    lastSyncedAt: row.last_synced_at || undefined,
    lastSyncError: row.last_sync_error || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function _mapIntegrationRaw(row) {
  let config = {};
  try { config = JSON.parse(row.config || '{}'); } catch (_) {}
  return {
    id: row.id,
    projectId: row.project_id,
    type: row.type,
    config,
    syncIntervalMs: row.sync_interval_ms || undefined,
    enabled: row.enabled === 1,
    lastSyncedAt: row.last_synced_at || undefined,
    lastSyncError: row.last_sync_error || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getIntegrationRaw(id) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  const stmt = db.prepare('SELECT * FROM project_integrations WHERE id = :id');
  const row = stmt.getAsObject({ ':id': id });
  stmt.free();
  if (!row.id) return null;
  return _mapIntegrationRaw(row);
}

function getAllIntegrations() {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  const stmt = db.prepare('SELECT * FROM project_integrations ORDER BY created_at ASC');
  const rows = [];
  while (stmt.step()) rows.push(_mapIntegrationRaw(stmt.getAsObject()));
  stmt.free();
  return rows;
}

function getProjectIntegrations(projectId) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  const stmt = db.prepare('SELECT * FROM project_integrations WHERE project_id = :pid ORDER BY created_at ASC');
  stmt.bind({ ':pid': projectId });
  const rows = [];
  while (stmt.step()) rows.push(normalizeIntegration(stmt.getAsObject()));
  stmt.free();
  return rows;
}

function createIntegration({ projectId, type, config, syncIntervalMs, enabled = true } = {}) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  if (!projectId) throw new Error('createIntegration: projectId is required');
  if (!type) throw new Error('createIntegration: type is required');
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.run(
    'INSERT INTO project_integrations (id, project_id, type, config, sync_interval_ms, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, projectId, type, JSON.stringify(config || {}), syncIntervalMs || null, enabled ? 1 : 0, now, now]
  );
  handle.persist();
  return getIntegrationRaw(id);
}

function updateIntegration(id, patch) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  const existing = getIntegrationRaw(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  const fields = ['updated_at = ?'];
  const vals = [now];
  if (patch.config         !== undefined) { fields.push('config = ?');          vals.push(JSON.stringify(patch.config)); }
  if (patch.syncIntervalMs !== undefined) { fields.push('sync_interval_ms = ?'); vals.push(patch.syncIntervalMs || null); }
  if (patch.enabled        !== undefined) { fields.push('enabled = ?');         vals.push(patch.enabled ? 1 : 0); }
  vals.push(id);
  db.run(`UPDATE project_integrations SET ${fields.join(', ')} WHERE id = ?`, vals);
  handle.persist();
  return getIntegrationRaw(id);
}

function deleteIntegration(id) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  db.run('DELETE FROM project_integrations WHERE id = ?', [id]);
  handle.persist();
}

function updateIntegrationSyncState(id, { lastSyncedAt, lastSyncError }) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  const now = new Date().toISOString();
  db.run(
    'UPDATE project_integrations SET last_synced_at = ?, last_sync_error = ?, updated_at = ? WHERE id = ?',
    [lastSyncedAt || null, lastSyncError || null, now, id]
  );
  handle.persist();
}

// ─── Project memory (Phase A2) ──────────────────────────────────────────────

const PROJECT_MEMORY_KINDS = ['decision', 'question', 'risk', 'glossary'];
const PROJECT_MEMORY_STATUSES = ['open', 'resolved', 'archived'];

function normalizeProjectMemory(row) {
  if (!row) return null;
  let meta = {};
  try { meta = row.meta ? JSON.parse(row.meta) : {}; } catch { meta = {}; }
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    title: row.title,
    body: row.body || '',
    status: row.status || 'open',
    meta,
    sourceTaskId: row.source_task_id || null,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listProjectMemory(projectId, { kind, status } = {}) {
  const db = _db();
  if (!db) return [];
  let sql = 'SELECT * FROM project_memory WHERE project_id = ?';
  const params = [projectId];
  if (kind) { sql += ' AND kind = ?'; params.push(kind); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY created_at DESC';
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(normalizeProjectMemory(stmt.getAsObject()));
  stmt.free();
  return rows;
}

function getProjectMemory(id) {
  const db = _db();
  if (!db) return null;
  const stmt = db.prepare('SELECT * FROM project_memory WHERE id = ?');
  stmt.bind([id]);
  const row = stmt.step() ? normalizeProjectMemory(stmt.getAsObject()) : null;
  stmt.free();
  return row;
}

function createProjectMemory({ projectId, kind, title, body, status, meta, sourceTaskId, createdBy } = {}) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  if (!projectId) throw new Error('projectId required');
  if (!PROJECT_MEMORY_KINDS.includes(kind)) throw new Error(`kind must be one of ${PROJECT_MEMORY_KINDS.join(', ')}`);
  if (!title || !title.trim()) throw new Error('title required');
  const finalStatus = status && PROJECT_MEMORY_STATUSES.includes(status)
    ? status
    : (kind === 'question' || kind === 'risk' ? 'open' : 'resolved');
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO project_memory (id, project_id, kind, title, body, status, meta, source_task_id, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, projectId, kind, title.trim(), body || '', finalStatus, JSON.stringify(meta || {}),
     sourceTaskId || null, createdBy ?? null, now, now]
  );
  handle.persist();
  return getProjectMemory(id);
}

function updateProjectMemory(id, patch = {}) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  const cur = getProjectMemory(id);
  if (!cur) throw new Error('Memory entry not found');
  const sets = [];
  const params = [];
  if (patch.title !== undefined) { sets.push('title = ?'); params.push(patch.title); }
  if (patch.body !== undefined)  { sets.push('body = ?');  params.push(patch.body); }
  if (patch.status !== undefined) {
    if (!PROJECT_MEMORY_STATUSES.includes(patch.status)) throw new Error('invalid status');
    sets.push('status = ?'); params.push(patch.status);
  }
  if (patch.meta !== undefined) {
    sets.push('meta = ?'); params.push(JSON.stringify(patch.meta || {}));
  }
  if (patch.sourceTaskId !== undefined) { sets.push('source_task_id = ?'); params.push(patch.sourceTaskId || null); }
  if (sets.length === 0) return cur;
  sets.push('updated_at = ?'); params.push(new Date().toISOString());
  params.push(id);
  db.run(`UPDATE project_memory SET ${sets.join(', ')} WHERE id = ?`, params);
  handle.persist();
  return getProjectMemory(id);
}

function deleteProjectMemory(id) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  db.run('DELETE FROM project_memory WHERE id = ?', [id]);
  handle.persist();
}

function buildProjectMemorySnapshot(projectId, { decisionLimit = 10, glossaryLimit = 50 } = {}) {
  const db = _db();
  if (!db) return null;
  const decisions = listProjectMemory(projectId, { kind: 'decision' }).slice(0, decisionLimit);
  const openQuestions = listProjectMemory(projectId, { kind: 'question', status: 'open' });
  const openRisks = listProjectMemory(projectId, { kind: 'risk', status: 'open' });
  const glossary = listProjectMemory(projectId, { kind: 'glossary' }).slice(0, glossaryLimit);
  if (decisions.length + openQuestions.length + openRisks.length + glossary.length === 0) return null;
  return {
    decisions: decisions.map(d => ({ id: d.id, title: d.title, body: d.body, createdAt: d.createdAt })),
    openQuestions: openQuestions.map(q => ({ id: q.id, title: q.title, body: q.body, createdAt: q.createdAt })),
    openRisks: openRisks.map(r => ({ id: r.id, title: r.title, body: r.body, category: r.meta?.category, severity: r.meta?.severity })),
    glossary: glossary.map(g => ({ term: g.title, definition: g.body })),
  };
}

// ─── Ownership ──────────────────────────────────────────────────────────────

function getProjectOwner(projectId) {
  const db = _db();
  if (!db) return null;
  const res = db.exec('SELECT created_by FROM projects WHERE id = ?', [projectId]);
  if (!res.length || !res[0].values.length) return null;
  return res[0].values[0][0];
}

function userOwnsProject(req, projectId) {
  if (!req?.user) return false;
  if (req.user.role === 'admin' || req.user.role === 'agent') return true;
  const owner = getProjectOwner(projectId);
  if (owner == null) return true; // shared / legacy
  return owner === req.user.userId;
}

function requireProjectOwnership(req, res, next) {
  const id = req.params.id || req.params.projectId;
  if (!id) return res.status(400).json({ error: 'project id missing' });
  if (!userOwnsProject(req, id)) {
    return res.status(403).json({ error: 'You do not have permission to modify this project' });
  }
  next();
}

function requireProjectOwnershipForTask(req, res, next) {
  const taskId = req.params.id || req.params.taskId;
  if (!taskId) return res.status(400).json({ error: 'task id missing' });
  const db = _db();
  if (!db) return res.status(500).json({ error: 'DB not initialized' });
  const result = db.exec('SELECT project_id FROM tasks WHERE id = ?', [taskId]);
  if (!result.length || !result[0].values.length) {
    return res.status(404).json({ error: 'task not found' });
  }
  const projectId = result[0].values[0][0];
  if (!projectId) return next();
  if (!userOwnsProject(req, projectId)) {
    return res.status(403).json({ error: 'You do not have permission to modify tasks in this project' });
  }
  next();
}

/**
 * Return a SQL WHERE-fragment + bind values that scope a list query by ownership.
 * Admin sees all by default; non-admins always scoped to their own id.
 */
function scopeByOwner(user, ownerCol, scope) {
  if (!user) return { where: '1 = 0', params: [] };
  const uid = user.userId ?? user.id;
  if (user.role === 'admin') {
    if (scope === 'all' || scope == null) return { where: '', params: [] };
    if (scope === 'me') return { where: `${ownerCol} = ?`, params: [uid] };
    if (typeof scope === 'number') return { where: `${ownerCol} = ?`, params: [scope] };
    return { where: '', params: [] };
  }
  return { where: `${ownerCol} = ?`, params: [uid] };
}

module.exports = {
  // Projects
  normalizeProject,
  getAllProjects,
  getProject,
  getProjectByPath,
  createProject,
  updateProject,
  setProjectWorkspace,
  bumpProjectFetchedAt,
  deleteProject,
  // Integrations
  normalizeIntegration,
  getIntegrationRaw,
  getAllIntegrations,
  getProjectIntegrations,
  createIntegration,
  updateIntegration,
  deleteIntegration,
  updateIntegrationSyncState,
  // Project memory
  PROJECT_MEMORY_KINDS,
  PROJECT_MEMORY_STATUSES,
  normalizeProjectMemory,
  listProjectMemory,
  getProjectMemory,
  createProjectMemory,
  updateProjectMemory,
  deleteProjectMemory,
  buildProjectMemorySnapshot,
  // Ownership
  getProjectOwner,
  userOwnsProject,
  requireProjectOwnership,
  requireProjectOwnershipForTask,
  scopeByOwner,
};
