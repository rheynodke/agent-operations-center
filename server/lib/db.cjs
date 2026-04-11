/**
 * SQLite database layer using sql.js (WASM-based, zero native deps).
 * Stores user credentials with scrypt password hashing.
 * Persists to disk at DATA_DIR/aoc.db
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

// ─── Config ───────────────────────────────────────────────────────────────────
const DATA_DIR = process.env.AOC_DATA_DIR || path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'aoc.db');
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// ─── State ────────────────────────────────────────────────────────────────────
let db = null;
let SQL = null;

// ─── Init ─────────────────────────────────────────────────────────────────────
async function initDatabase() {
  if (db) return db;

  SQL = await initSqlJs();

  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // Load existing DB or create new
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
    console.log('[db] Loaded existing database from', DB_PATH);
  } else {
    db = new SQL.Database();
    console.log('[db] Created new database');
  }

  // Run migrations
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Agent profiles — dashboard-specific metadata per agent
  // avatar_data is base64-encoded image (PNG/JPEG/WebP) stored directly in DB
  db.run(`
    CREATE TABLE IF NOT EXISTS agent_profiles (
      agent_id TEXT PRIMARY KEY,
      display_name TEXT,
      emoji TEXT,
      avatar_data TEXT,
      avatar_mime TEXT,
      avatar_preset_id TEXT,
      color TEXT,
      description TEXT,
      tags TEXT,
      notes TEXT,
      provisioned_at TEXT DEFAULT (datetime('now')),
      provisioned_by INTEGER,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Migration: add avatar_preset_id column if missing (safe for existing DBs)
  try {
    db.run(`ALTER TABLE agent_profiles ADD COLUMN avatar_preset_id TEXT`);
  } catch (_) { /* column already exists */ }

  // Dashboard settings — key/value store for API keys, preferences, etc.
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // File version history — stores full content snapshots for agent files, skills, scripts
  // scope_key format: 'agent:{agentId}:{fileName}' | 'skill:global:{slug}' | 'skill:{agentId}:{name}' | 'script:agent:{agentId}:{file}' | 'script:global:{file}'
  db.run(`
    CREATE TABLE IF NOT EXISTS file_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope_key TEXT NOT NULL,
      content TEXT NOT NULL,
      content_size INTEGER NOT NULL,
      checksum TEXT NOT NULL,
      op TEXT NOT NULL DEFAULT 'edit',
      saved_by TEXT,
      saved_at TEXT NOT NULL DEFAULT (datetime('now')),
      label TEXT
    )
  `);

  // Index for fast history lookups per file
  db.run(`CREATE INDEX IF NOT EXISTS idx_file_versions_scope ON file_versions(scope_key, saved_at DESC)`);

  // Tasks — general-purpose ticketing system
  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id            TEXT PRIMARY KEY,
      title         TEXT NOT NULL,
      description   TEXT,
      status        TEXT NOT NULL DEFAULT 'backlog',
      priority      TEXT NOT NULL DEFAULT 'medium',
      agent_id      TEXT,
      session_id    TEXT,
      tags          TEXT DEFAULT '[]',
      cost          REAL,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      completed_at  TEXT,
      input_tokens  INTEGER,
      output_tokens INTEGER
    )
  `);
  // Runtime migration: add columns if they don't exist yet (idempotent)
  try { db.run('ALTER TABLE tasks ADD COLUMN input_tokens INTEGER'); } catch {}
  try { db.run('ALTER TABLE tasks ADD COLUMN output_tokens INTEGER'); } catch {}
  try { db.run("ALTER TABLE tasks ADD COLUMN all_session_ids TEXT DEFAULT '[]'"); } catch {}
  try { db.run('ALTER TABLE tasks ADD COLUMN project_id TEXT DEFAULT \'general\''); } catch {}
  try { db.run('ALTER TABLE tasks ADD COLUMN external_id TEXT'); } catch {}
  try { db.run('ALTER TABLE tasks ADD COLUMN external_source TEXT'); } catch {}

  db.run(`
    CREATE TABLE IF NOT EXISTS task_activity (
      id          TEXT PRIMARY KEY,
      task_id     TEXT NOT NULL,
      type        TEXT NOT NULL,
      from_value  TEXT,
      to_value    TEXT,
      actor       TEXT NOT NULL,
      note        TEXT,
      created_at  TEXT NOT NULL
    )
  `);

  // Projects
  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      color       TEXT NOT NULL DEFAULT '#6366f1',
      description TEXT,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    )
  `);
  db.run(`
    INSERT OR IGNORE INTO projects (id, name, color, created_at, updated_at)
    VALUES ('general', 'General', '#6366f1', datetime('now'), datetime('now'))
  `);

  // Project integrations
  db.run(`
    CREATE TABLE IF NOT EXISTS project_integrations (
      id               TEXT PRIMARY KEY,
      project_id       TEXT NOT NULL,
      type             TEXT NOT NULL,
      config           TEXT NOT NULL DEFAULT '{}',
      sync_interval_ms INTEGER,
      enabled          INTEGER NOT NULL DEFAULT 1,
      last_synced_at   TEXT,
      last_sync_error  TEXT,
      created_at       TEXT NOT NULL,
      updated_at       TEXT NOT NULL
    )
  `);

  // Tasks migration: add project + external sync columns
  try { db.run("ALTER TABLE tasks ADD COLUMN project_id TEXT DEFAULT 'general'"); } catch (_) {}
  try { db.run('ALTER TABLE tasks ADD COLUMN external_id TEXT'); } catch (_) {}
  try { db.run('ALTER TABLE tasks ADD COLUMN external_source TEXT'); } catch (_) {}
  db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_external ON tasks(external_id, external_source)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id)`);

  persist();
  return db;
}

// ─── Task helpers ──────────────────────────────────────────────────────────────
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

function normalizeProject(row) {
  if (!row || !row.id) return null;
  return {
    id: row.id,
    name: row.name,
    color: row.color || '#6366f1',
    description: row.description || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getAllProjects() {
  if (!db) throw new Error('DB not initialized');
  const stmt = db.prepare('SELECT * FROM projects ORDER BY created_at ASC');
  const rows = [];
  while (stmt.step()) rows.push(normalizeProject(stmt.getAsObject()));
  stmt.free();
  return rows;
}

function getProject(id) {
  if (!db) throw new Error('DB not initialized');
  const stmt = db.prepare('SELECT * FROM projects WHERE id = :id');
  const row = stmt.getAsObject({ ':id': id });
  stmt.free();
  return row.id ? normalizeProject(row) : null;
}

function createProject({ name, color = '#6366f1', description } = {}) {
  if (!db) throw new Error('DB not initialized');
  if (!name) throw new Error('createProject: name is required');
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.run(
    'INSERT INTO projects (id, name, color, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, name, color, description || null, now, now]
  );
  persist();
  return getProject(id);
}

function updateProject(id, patch) {
  if (!db) throw new Error('DB not initialized');
  const before = getProject(id);
  if (!before) return null;
  const now = new Date().toISOString();
  const fields = ['updated_at = ?'];
  const vals = [now];
  if (patch.name        !== undefined) { fields.push('name = ?');        vals.push(patch.name); }
  if (patch.color       !== undefined) { fields.push('color = ?');       vals.push(patch.color); }
  if (patch.description !== undefined) { fields.push('description = ?'); vals.push(patch.description || null); }
  vals.push(id);
  db.run(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`, vals);
  persist();
  return getProject(id);
}

function deleteProject(id) {
  if (!db) throw new Error('DB not initialized');
  if (id === 'general') throw new Error('deleteProject: cannot delete the default project');
  // Reassign orphaned tasks back to 'general'
  db.run("UPDATE tasks SET project_id = 'general' WHERE project_id = ?", [id]);
  // Cascade-delete integrations tied to this project
  db.run('DELETE FROM project_integrations WHERE project_id = ?', [id]);
  db.run('DELETE FROM projects WHERE id = ?', [id]);
  persist();
}

function normalizeIntegration(row) {
  if (!row || !row.id) return null;
  let config = {};
  try { config = JSON.parse(row.config || '{}'); } catch (_) {}
  const { credentials, ...safeConfig } = config;
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

// Internal version — includes raw config WITH credentials (for sync orchestrator only)
function getIntegrationRaw(id) {
  if (!db) throw new Error('DB not initialized');
  const stmt = db.prepare('SELECT * FROM project_integrations WHERE id = :id');
  const row = stmt.getAsObject({ ':id': id });
  stmt.free();
  if (!row.id) return null;
  return _mapIntegrationRaw(row);
}

function getAllIntegrations() {
  if (!db) throw new Error('DB not initialized');
  const stmt = db.prepare('SELECT * FROM project_integrations ORDER BY created_at ASC');
  const rows = [];
  while (stmt.step()) rows.push(_mapIntegrationRaw(stmt.getAsObject()));
  stmt.free();
  return rows;
}

function getProjectIntegrations(projectId) {
  if (!db) throw new Error('DB not initialized');
  const stmt = db.prepare('SELECT * FROM project_integrations WHERE project_id = :pid ORDER BY created_at ASC');
  stmt.bind({ ':pid': projectId });
  const rows = [];
  while (stmt.step()) rows.push(normalizeIntegration(stmt.getAsObject()));
  stmt.free();
  return rows;
}

function createIntegration({ projectId, type, config, syncIntervalMs, enabled = true } = {}) {
  if (!db) throw new Error('DB not initialized');
  if (!projectId) throw new Error('createIntegration: projectId is required');
  if (!type) throw new Error('createIntegration: type is required');
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.run(
    'INSERT INTO project_integrations (id, project_id, type, config, sync_interval_ms, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, projectId, type, JSON.stringify(config || {}), syncIntervalMs || null, enabled ? 1 : 0, now, now]
  );
  persist();
  return getIntegrationRaw(id);
}

function updateIntegration(id, patch) {
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
  persist();
  return getIntegrationRaw(id);
}

function deleteIntegration(id) {
  if (!db) throw new Error('DB not initialized');
  db.run('DELETE FROM project_integrations WHERE id = ?', [id]);
  persist();
}

function updateIntegrationSyncState(id, { lastSyncedAt, lastSyncError }) {
  if (!db) throw new Error('DB not initialized');
  const now = new Date().toISOString();
  db.run(
    'UPDATE project_integrations SET last_synced_at = ?, last_sync_error = ?, updated_at = ? WHERE id = ?',
    [lastSyncedAt || null, lastSyncError || null, now, id]
  );
  persist();
}

function getAllTasks(filters = {}) {
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
  if (!db) throw new Error('DB not initialized');
  const stmt = db.prepare('SELECT * FROM tasks WHERE id = :id');
  const row = stmt.getAsObject({ ':id': id });
  stmt.free();
  return row.id ? normalizeTask(row) : null;
}

function getTaskByExternalId(externalId, externalSource) {
  if (!db) throw new Error('DB not initialized');
  const stmt = db.prepare('SELECT * FROM tasks WHERE external_id = :eid AND external_source = :src LIMIT 1');
  const row = stmt.getAsObject({ ':eid': externalId, ':src': externalSource });
  stmt.free();
  return row.id ? normalizeTask(row) : null;
}

function createTask({ title, description, status = 'backlog', priority = 'medium', agentId, tags = [], sessionId, projectId = 'general', externalId, externalSource } = {}) {
  if (!db) throw new Error('DB not initialized');
  if (!title) throw new Error('createTask: title is required');
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.run(
    'INSERT INTO tasks (id, title, description, status, priority, agent_id, session_id, tags, project_id, external_id, external_source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, title, description || null, status, priority, agentId || null, sessionId || null, JSON.stringify(tags || []), projectId, externalId || null, externalSource || null, now, now]
  );
  persist();
  return getTask(id);
}

function updateTask(id, patch) {
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
  if (patch.status === 'done' && before.status !== 'done') {
    fields.push('completed_at = ?'); vals.push(now);
  } else if (patch.status !== undefined && patch.status !== 'done' && before.status === 'done') {
    fields.push('completed_at = ?'); vals.push(null);
  }
  vals.push(id);
  db.run(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`, vals);
  persist();
  return getTask(id);
}

function deleteTask(id) {
  if (!db) throw new Error('DB not initialized');
  db.run('DELETE FROM task_activity WHERE task_id = ?', [id]);
  db.run('DELETE FROM tasks WHERE id = ?', [id]);
  persist();
}

function addTaskActivity({ taskId, type, fromValue, toValue, actor, note } = {}) {
  if (!db) throw new Error('DB not initialized');
  if (!taskId || !type || !actor) throw new Error('addTaskActivity: taskId, type, and actor are required');
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.run(
    'INSERT INTO task_activity (id, task_id, type, from_value, to_value, actor, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, taskId, type, fromValue || null, toValue || null, actor, note || null, now]
  );
  persist();
}

function getTaskActivity(taskId) {
  if (!db) throw new Error('DB not initialized');
  const stmt = db.prepare('SELECT * FROM task_activity WHERE task_id = :taskId ORDER BY created_at ASC');
  stmt.bind({ ':taskId': taskId });
  const rows = [];
  while (stmt.step()) rows.push(normalizeActivity(stmt.getAsObject()));
  stmt.free();
  return rows;
}

// ─── Persistence ──────────────────────────────────────────────────────────────
function persist() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// ─── Password Hashing (Node built-in scrypt) ─────────────────────────────────
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(derived, 'hex'));
}

// ─── User CRUD ────────────────────────────────────────────────────────────────
function hasAnyUsers() {
  if (!db) return false;
  const result = db.exec('SELECT COUNT(*) as count FROM users');
  return result.length > 0 && result[0].values[0][0] > 0;
}

function createUser({ username, password, displayName, role = 'admin' }) {
  if (!db) throw new Error('Database not initialized');

  const passwordHash = hashPassword(password);
  const stmt = db.prepare(
    'INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)'
  );
  stmt.run([username, displayName || username, passwordHash, role]);
  stmt.free();
  persist();

  // Return the created user (without password)
  const user = db.exec('SELECT id, username, display_name, role, created_at FROM users WHERE username = ?', [username]);
  if (user.length === 0 || user[0].values.length === 0) return null;

  const row = user[0].values[0];
  const cols = user[0].columns;
  return Object.fromEntries(cols.map((c, i) => [c, row[i]]));
}

function getUserByUsername(username) {
  if (!db) return null;
  const result = db.exec('SELECT * FROM users WHERE username = ?', [username]);
  if (result.length === 0 || result[0].values.length === 0) return null;

  const row = result[0].values[0];
  const cols = result[0].columns;
  return Object.fromEntries(cols.map((c, i) => [c, row[i]]));
}

function getUserById(id) {
  if (!db) return null;
  const result = db.exec('SELECT id, username, display_name, role, created_at, last_login FROM users WHERE id = ?', [id]);
  if (result.length === 0 || result[0].values.length === 0) return null;

  const row = result[0].values[0];
  const cols = result[0].columns;
  return Object.fromEntries(cols.map((c, i) => [c, row[i]]));
}

function updateLastLogin(userId) {
  if (!db) return;
  db.run("UPDATE users SET last_login = datetime('now') WHERE id = ?", [userId]);
  persist();
}

function getAllUsers() {
  if (!db) return [];
  const result = db.exec('SELECT id, username, display_name, role, created_at, last_login FROM users ORDER BY created_at');
  if (result.length === 0) return [];

  return result[0].values.map(row =>
    Object.fromEntries(result[0].columns.map((c, i) => [c, row[i]]))
  );
}

// ─── JWT ──────────────────────────────────────────────────────────────────────
function generateToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      username: user.username,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// ─── Auth Middleware ───────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const token = authHeader.slice(7);

  // Accept DASHBOARD_TOKEN directly — used by agents calling update_task.sh
  const dashboardToken = process.env.DASHBOARD_TOKEN;
  if (dashboardToken && token === dashboardToken) {
    req.user = { userId: 0, username: 'agent', role: 'agent' };
    return next();
  }

  // Otherwise verify as JWT (dashboard user session)
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.user = payload;
  next();
}

// ─── Agent Profiles ──────────────────────────────────────────────────────────

function getAgentProfile(agentId) {
  if (!db) return null;
  const result = db.exec('SELECT * FROM agent_profiles WHERE agent_id = ?', [agentId]);
  if (!result.length || !result[0].values.length) return null;
  const row = result[0].values[0];
  const cols = result[0].columns;
  const obj = Object.fromEntries(cols.map((c, i) => [c, row[i]]));
  // Parse JSON tags
  try { obj.tags = obj.tags ? JSON.parse(obj.tags) : []; } catch { obj.tags = []; }
  // Add camelCase aliases for frontend consumption
  obj.avatarPresetId = obj.avatar_preset_id ?? null;
  return obj;
}

function upsertAgentProfile({ agentId, displayName, emoji, avatarData, avatarMime, avatarPresetId, color, description, tags, notes, provisionedBy }) {
  if (!db) throw new Error('Database not initialized');
  const existing = getAgentProfile(agentId);
  const tagsJson = Array.isArray(tags) ? JSON.stringify(tags) : (tags || '[]');
  if (existing) {
    db.run(
      `UPDATE agent_profiles SET
        display_name = COALESCE(?, display_name),
        emoji = COALESCE(?, emoji),
        avatar_data = COALESCE(?, avatar_data),
        avatar_mime = COALESCE(?, avatar_mime),
        avatar_preset_id = ?,
        color = ?,
        description = COALESCE(?, description),
        tags = ?,
        notes = COALESCE(?, notes),
        updated_at = datetime('now')
      WHERE agent_id = ?`,
      [displayName ?? null, emoji ?? null, avatarData ?? null, avatarMime ?? null,
       avatarPresetId ?? existing.avatar_preset_id ?? null,
       color ?? existing.color ?? null,
       description ?? null, tagsJson, notes ?? null, agentId]
    );
  } else {
    db.run(
      `INSERT INTO agent_profiles
        (agent_id, display_name, emoji, avatar_data, avatar_mime, avatar_preset_id, color, description, tags, notes, provisioned_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [agentId, displayName ?? null, emoji ?? null, avatarData ?? null, avatarMime ?? null,
       avatarPresetId ?? null, color ?? null, description ?? null, tagsJson, notes ?? null, provisionedBy ?? null]
    );
  }
  persist();
  return getAgentProfile(agentId);
}

function renameAgentProfile(oldAgentId, newAgentId) {
  if (!db) return;
  const existing = getAgentProfile(oldAgentId);
  if (!existing) return;
  // Check if new ID already has a profile (unlikely, but safe)
  const alreadyExists = getAgentProfile(newAgentId);
  if (alreadyExists) {
    // Just delete old one — new ID already has a profile
    db.run('DELETE FROM agent_profiles WHERE agent_id = ?', [oldAgentId]);
  } else {
    db.run('UPDATE agent_profiles SET agent_id = ? WHERE agent_id = ?', [newAgentId, oldAgentId]);
  }
  persist();
}

function getAllAgentProfiles() {
  if (!db) return [];
  const result = db.exec('SELECT * FROM agent_profiles ORDER BY provisioned_at DESC');
  if (!result.length) return [];
  return result[0].values.map(row => {
    const obj = Object.fromEntries(result[0].columns.map((c, i) => [c, row[i]]));
    try { obj.tags = obj.tags ? JSON.parse(obj.tags) : []; } catch { obj.tags = []; }
    return obj;
  });
}

function deleteAgentProfile(agentId) {
  if (!db) return;
  db.run('DELETE FROM agent_profiles WHERE agent_id = ?', [agentId]);
  persist();
}

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  initDatabase,
  getDb: () => db,
  persist,
  // ─── Settings ───────────────────────────────────────────────────────────────
  getSetting(key) {
    if (!db) return null;
    const res = db.exec('SELECT value FROM settings WHERE key = ?', [key]);
    if (!res.length || !res[0].values.length) return null;
    return res[0].values[0][0];
  },
  setSetting(key, value) {
    if (!db) throw new Error('Database not initialized');
    const stmt = db.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    );
    stmt.run([key, value]);
    stmt.free();
    persist();
  },
  deleteSetting(key) {
    if (!db) return;
    const stmt = db.prepare('DELETE FROM settings WHERE key = ?');
    stmt.run([key]);
    stmt.free();
    persist();
  },

  persist,
  hasAnyUsers,
  createUser,
  getUserByUsername,
  getUserById,
  updateLastLogin,
  getAllUsers,
  hashPassword,
  verifyPassword,
  generateToken,
  verifyToken,
  authMiddleware,
  JWT_SECRET,
  // Agent profiles
  getAgentProfile,
  upsertAgentProfile,
  renameAgentProfile,
  getAllAgentProfiles,
  deleteAgentProfile,
  // Tasks
  getAllTasks, getTask, getTaskByExternalId, createTask, updateTask, deleteTask,
  addTaskActivity, getTaskActivity,
  // Projects
  getAllProjects, getProject, createProject, updateProject, deleteProject,
  // Integrations
  getAllIntegrations, getProjectIntegrations, getIntegrationRaw,
  createIntegration, updateIntegration, deleteIntegration, updateIntegrationSyncState,
};
