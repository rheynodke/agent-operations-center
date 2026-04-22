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
let JWT_SECRET = process.env.JWT_SECRET || null;
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

  // Migration: add role column for ADLC agent role templates
  try {
    db.run(`ALTER TABLE agent_profiles ADD COLUMN role TEXT`);
  } catch (_) { /* column already exists */ }

  // Migration: per-user permission flag for the Skills terminal (Claude TUI).
  // Admins always have access; this grants a non-admin user the same.
  try {
    db.run(`ALTER TABLE users ADD COLUMN can_use_claude_terminal INTEGER NOT NULL DEFAULT 0`);
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
  try { db.run("ALTER TABLE tasks ADD COLUMN request_from TEXT DEFAULT '-'"); } catch {}
  try { db.run("ALTER TABLE tasks ADD COLUMN analysis TEXT"); } catch {}

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

  // ── Connections (third-party data sources) ──────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS connections (
      id             TEXT PRIMARY KEY,
      name           TEXT NOT NULL,
      type           TEXT NOT NULL,
      credentials    TEXT NOT NULL DEFAULT '',
      metadata       TEXT NOT NULL DEFAULT '{}',
      enabled        INTEGER NOT NULL DEFAULT 1,
      last_tested_at TEXT,
      last_test_ok   INTEGER,
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL
    )
  `);

  // ── Agent ↔ Connection assignments ──────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS agent_connections (
      agent_id       TEXT NOT NULL,
      connection_id  TEXT NOT NULL,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (agent_id, connection_id)
    )
  `);

  // ── Invitations (admin-generated registration links) ────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS invitations (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      token        TEXT UNIQUE NOT NULL,
      created_by   INTEGER NOT NULL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at   TEXT NOT NULL,
      revoked_at   TEXT,
      default_role TEXT NOT NULL DEFAULT 'user',
      note         TEXT,
      use_count    INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token)`);

  // Migration: add created_by to connections (owner tracking for role-based access)
  try { db.run('ALTER TABLE connections ADD COLUMN created_by INTEGER'); } catch (_) {}

  // ── ADLC Role Templates ─────────────────────────────────────────────────────
  // Managed role presets for ADLC agents. Seeded from server/data/role-templates-seed.json
  // on first run. Users can fork/create/edit custom templates.
  // agent_files / skill_refs / script_refs / tags stored as JSON text.
  db.run(`
    CREATE TABLE IF NOT EXISTS role_templates (
      id                  TEXT PRIMARY KEY,
      adlc_number         INTEGER,
      role                TEXT NOT NULL,
      emoji               TEXT,
      color               TEXT,
      description         TEXT,
      model               TEXT,
      tags                TEXT NOT NULL DEFAULT '[]',
      agent_files         TEXT NOT NULL DEFAULT '{}',
      skill_refs          TEXT NOT NULL DEFAULT '[]',
      skill_contents      TEXT NOT NULL DEFAULT '{}',
      script_refs         TEXT NOT NULL DEFAULT '[]',
      fs_workspace_only   INTEGER NOT NULL DEFAULT 0,
      origin              TEXT NOT NULL DEFAULT 'user',
      built_in            INTEGER NOT NULL DEFAULT 0,
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_role_templates_origin ON role_templates(origin)`);

  // Tasks migration: add project + external sync columns
  try { db.run("ALTER TABLE tasks ADD COLUMN project_id TEXT DEFAULT 'general'"); } catch (_) {}
  try { db.run('ALTER TABLE tasks ADD COLUMN external_id TEXT'); } catch (_) {}
  try { db.run('ALTER TABLE tasks ADD COLUMN external_source TEXT'); } catch (_) {}
  db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_external ON tasks(external_id, external_source)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id)`);

  // ── Persist JWT_SECRET so tokens survive server restarts ──────────────────
  if (!JWT_SECRET) {
    const secretRow = db.exec("SELECT value FROM settings WHERE key = 'jwt_secret'");
    if (secretRow.length && secretRow[0].values.length) {
      JWT_SECRET = secretRow[0].values[0][0];
      console.log('[db] Loaded JWT_SECRET from database');
    } else {
      JWT_SECRET = crypto.randomBytes(32).toString('hex');
      const stmt = db.prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES ('jwt_secret', ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      );
      stmt.run([JWT_SECRET]);
      stmt.free();
      console.log('[db] Generated and persisted new JWT_SECRET');
    }
  }

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
    requestFrom: row.request_from || '-',
    analysis: (() => { try { return row.analysis ? JSON.parse(row.analysis) : null; } catch { return null; } })(),
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

function createTask({ title, description, status = 'backlog', priority = 'medium', agentId, tags = [], sessionId, projectId = 'general', externalId, externalSource, requestFrom = '-' } = {}) {
  if (!db) throw new Error('DB not initialized');
  if (!title) throw new Error('createTask: title is required');
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.run(
    'INSERT INTO tasks (id, title, description, status, priority, agent_id, session_id, tags, project_id, external_id, external_source, request_from, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, title, description || null, status, priority, agentId || null, sessionId || null, JSON.stringify(tags || []), projectId, externalId || null, externalSource || null, requestFrom || '-', now, now]
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
  if (patch.requestFrom  !== undefined) { fields.push('request_from = ?');  vals.push(patch.requestFrom || '-'); }
  if (patch.analysis     !== undefined) { fields.push('analysis = ?');      vals.push(typeof patch.analysis === 'string' ? patch.analysis : JSON.stringify(patch.analysis)); }
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
  const result = db.exec('SELECT id, username, display_name, role, can_use_claude_terminal, created_at, last_login FROM users WHERE id = ?', [id]);
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
  const result = db.exec('SELECT id, username, display_name, role, can_use_claude_terminal, created_at, last_login FROM users ORDER BY created_at');
  if (result.length === 0) return [];

  return result[0].values.map(row =>
    Object.fromEntries(result[0].columns.map((c, i) => [c, row[i]]))
  );
}

function deleteUser(id) {
  if (!db) return;
  db.run('DELETE FROM users WHERE id = ?', [id]);
  persist();
}

function updateUser(id, { displayName, role, password, canUseClaudeTerminal } = {}) {
  if (!db) return null;
  const fields = ["updated_at = datetime('now')"];
  const vals = [];
  if (displayName !== undefined) { fields.push('display_name = ?'); vals.push(displayName); }
  if (role !== undefined) { fields.push('role = ?'); vals.push(role); }
  if (password) { fields.push('password_hash = ?'); vals.push(hashPassword(password)); }
  if (canUseClaudeTerminal !== undefined) { fields.push('can_use_claude_terminal = ?'); vals.push(canUseClaudeTerminal ? 1 : 0); }
  if (vals.length === 0) return getUserById(id);
  vals.push(id);
  db.run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, vals);
  persist();
  return getUserById(id);
}

// ─── Invitations ─────────────────────────────────────────────────────────────
function normalizeInvitation(row) {
  if (!row || !row.id) return null;
  const now = new Date();
  const expiresAt = row.expires_at ? new Date(row.expires_at) : null;
  const expired = expiresAt ? expiresAt.getTime() < now.getTime() : false;
  return {
    id: row.id,
    token: row.token,
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at || null,
    defaultRole: row.default_role || 'user',
    note: row.note || null,
    useCount: row.use_count || 0,
    expired,
    active: !row.revoked_at && !expired,
  };
}

function createInvitation({ createdBy, expiresAt, defaultRole = 'user', note }) {
  if (!db) throw new Error('DB not initialized');
  if (!createdBy) throw new Error('createInvitation: createdBy required');
  if (!expiresAt) throw new Error('createInvitation: expiresAt required');
  const token = crypto.randomBytes(24).toString('hex');
  db.run(
    'INSERT INTO invitations (token, created_by, expires_at, default_role, note) VALUES (?, ?, ?, ?, ?)',
    [token, createdBy, expiresAt, defaultRole, note || null]
  );
  persist();
  return getInvitationByToken(token);
}

function getAllInvitations() {
  if (!db) return [];
  const res = db.exec('SELECT * FROM invitations ORDER BY created_at DESC');
  if (!res.length) return [];
  const cols = res[0].columns;
  return res[0].values.map(row => {
    const obj = {}; cols.forEach((c, i) => { obj[c] = row[i]; });
    return normalizeInvitation(obj);
  });
}

function getInvitationByToken(token) {
  if (!db) return null;
  const res = db.exec('SELECT * FROM invitations WHERE token = ?', [token]);
  if (!res.length || !res[0].values.length) return null;
  const cols = res[0].columns;
  const obj = {}; cols.forEach((c, i) => { obj[c] = res[0].values[0][i]; });
  return normalizeInvitation(obj);
}

function getInvitationById(id) {
  if (!db) return null;
  const res = db.exec('SELECT * FROM invitations WHERE id = ?', [id]);
  if (!res.length || !res[0].values.length) return null;
  const cols = res[0].columns;
  const obj = {}; cols.forEach((c, i) => { obj[c] = res[0].values[0][i]; });
  return normalizeInvitation(obj);
}

function revokeInvitation(id) {
  if (!db) return;
  db.run("UPDATE invitations SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL", [id]);
  persist();
}

function deleteInvitation(id) {
  if (!db) return;
  db.run('DELETE FROM invitations WHERE id = ?', [id]);
  persist();
}

function incrementInvitationUse(id) {
  if (!db) return;
  db.run('UPDATE invitations SET use_count = use_count + 1 WHERE id = ?', [id]);
  persist();
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

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin role required' });
  }
  next();
}

// ─── Ownership helpers ───────────────────────────────────────────────────────
// Agent ownership is tracked on agent_profiles.provisioned_by.
// Admin always bypasses ownership checks.

function getAgentOwner(agentId) {
  if (!db) return null;
  const res = db.exec('SELECT provisioned_by FROM agent_profiles WHERE agent_id = ?', [agentId]);
  if (!res.length || !res[0].values.length) return null;
  return res[0].values[0][0]; // may be null for legacy agents
}

function getConnectionOwner(connId) {
  if (!db) return null;
  const res = db.exec('SELECT created_by FROM connections WHERE id = ?', [connId]);
  if (!res.length || !res[0].values.length) return null;
  return res[0].values[0][0];
}

/** True if `req.user` is admin, OR is the owner of the given agent. */
function userOwnsAgent(req, agentId) {
  if (!req?.user) return false;
  if (req.user.role === 'admin' || req.user.role === 'agent') return true;
  const owner = getAgentOwner(agentId);
  return owner != null && owner === req.user.userId;
}

function userOwnsConnection(req, connId) {
  if (!req?.user) return false;
  if (req.user.role === 'admin' || req.user.role === 'agent') return true;
  const owner = getConnectionOwner(connId);
  return owner != null && owner === req.user.userId;
}

/** Express middleware: require that req.user owns the agent named by :id (or :agentId) */
function requireAgentOwnership(req, res, next) {
  const agentId = req.params.id || req.params.agentId;
  if (!agentId) return res.status(400).json({ error: 'agentId missing from route' });
  if (!userOwnsAgent(req, agentId)) {
    return res.status(403).json({ error: 'You do not have permission to modify this agent' });
  }
  next();
}

function requireConnectionOwnership(req, res, next) {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: 'connection id missing' });
  if (!userOwnsConnection(req, id)) {
    return res.status(403).json({ error: 'You do not have permission to modify this connection' });
  }
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
  obj.role = obj.role ?? null;
  return obj;
}

function upsertAgentProfile({ agentId, displayName, emoji, avatarData, avatarMime, avatarPresetId, color, description, tags, notes, provisionedBy, role }) {
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
        role = COALESCE(?, role),
        updated_at = datetime('now')
      WHERE agent_id = ?`,
      [displayName ?? null, emoji ?? null, avatarData ?? null, avatarMime ?? null,
       avatarPresetId ?? existing.avatar_preset_id ?? null,
       color ?? existing.color ?? null,
       description ?? null, tagsJson, notes ?? null,
       role ?? null, agentId]
    );
  } else {
    db.run(
      `INSERT INTO agent_profiles
        (agent_id, display_name, emoji, avatar_data, avatar_mime, avatar_preset_id, color, description, tags, notes, provisioned_by, role)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [agentId, displayName ?? null, emoji ?? null, avatarData ?? null, avatarMime ?? null,
       avatarPresetId ?? null, color ?? null, description ?? null, tagsJson, notes ?? null,
       provisionedBy ?? null, role ?? null]
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

// ─── Connections ─────────────────────────────────────────────────────────────

const { encrypt: encryptConn, decrypt: decryptConn } = require('./integrations/base.cjs');

function normalizeConnection(row) {
  if (!row || !row.id) return null;
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    hasCredentials: !!row.credentials,
    metadata: (() => { try { return row.metadata ? JSON.parse(row.metadata) : {}; } catch { return {}; } })(),
    enabled: !!row.enabled,
    createdBy: row.created_by ?? null,
    lastTestedAt: row.last_tested_at || null,
    lastTestOk: row.last_test_ok != null ? !!row.last_test_ok : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getAllConnections() {
  if (!db) return [];
  const res = db.exec('SELECT * FROM connections ORDER BY created_at DESC');
  if (!res.length) return [];
  const cols = res[0].columns;
  return res[0].values.map(row => {
    const obj = {}; cols.forEach((c, i) => { obj[c] = row[i]; });
    return normalizeConnection(obj);
  }).filter(Boolean);
}

function getConnection(id) {
  if (!db) return null;
  const res = db.exec('SELECT * FROM connections WHERE id = ?', [id]);
  if (!res.length || !res[0].values.length) return null;
  const cols = res[0].columns;
  const obj = {}; cols.forEach((c, i) => { obj[c] = res[0].values[0][i]; });
  return normalizeConnection(obj);
}

/** Get raw connection with decrypted credentials (for internal use only — never expose to frontend) */
function getConnectionRaw(id) {
  if (!db) return null;
  const res = db.exec('SELECT * FROM connections WHERE id = ?', [id]);
  if (!res.length || !res[0].values.length) return null;
  const cols = res[0].columns;
  const obj = {}; cols.forEach((c, i) => { obj[c] = res[0].values[0][i]; });
  const meta = (() => { try { return obj.metadata ? JSON.parse(obj.metadata) : {}; } catch { return {}; } })();
  let creds = '';
  try { creds = obj.credentials ? decryptConn(obj.credentials) : ''; } catch { creds = ''; }
  return { ...obj, credentials: creds, metadata: meta };
}

/** Get all enabled connections with decrypted credentials (for dispatch injection) */
function getEnabledConnectionsRaw() {
  if (!db) return [];
  const res = db.exec('SELECT * FROM connections WHERE enabled = 1');
  if (!res.length) return [];
  const cols = res[0].columns;
  return res[0].values.map(row => {
    const obj = {}; cols.forEach((c, i) => { obj[c] = row[i]; });
    const meta = (() => { try { return obj.metadata ? JSON.parse(obj.metadata) : {}; } catch { return {}; } })();
    let creds = '';
    try { creds = obj.credentials ? decryptConn(obj.credentials) : ''; } catch { creds = ''; }
    return { ...obj, credentials: creds, metadata: meta };
  });
}

function createConnection({ id, name, type, credentials, metadata, enabled, createdBy }) {
  if (!db) throw new Error('DB not initialized');
  const now = new Date().toISOString();
  const encCreds = credentials ? encryptConn(credentials) : '';
  const metaStr = JSON.stringify(metadata || {});
  db.run(
    `INSERT INTO connections (id, name, type, credentials, metadata, enabled, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, name, type, encCreds, metaStr, enabled !== false ? 1 : 0, createdBy || null, now, now]
  );
  persist();
  return getConnection(id);
}

function updateConnection(id, patch) {
  if (!db) throw new Error('DB not initialized');
  const now = new Date().toISOString();
  const fields = ['updated_at = ?'];
  const vals = [now];
  if (patch.name        !== undefined) { fields.push('name = ?');        vals.push(patch.name); }
  if (patch.type        !== undefined) { fields.push('type = ?');        vals.push(patch.type); }
  if (patch.credentials !== undefined) { fields.push('credentials = ?'); vals.push(patch.credentials ? encryptConn(patch.credentials) : ''); }
  if (patch.metadata    !== undefined) { fields.push('metadata = ?');    vals.push(JSON.stringify(patch.metadata)); }
  if (patch.enabled     !== undefined) { fields.push('enabled = ?');     vals.push(patch.enabled ? 1 : 0); }
  if (patch.lastTestedAt !== undefined) { fields.push('last_tested_at = ?'); vals.push(patch.lastTestedAt); }
  if (patch.lastTestOk   !== undefined) { fields.push('last_test_ok = ?');   vals.push(patch.lastTestOk ? 1 : 0); }
  vals.push(id);
  db.run(`UPDATE connections SET ${fields.join(', ')} WHERE id = ?`, vals);
  persist();
  return getConnection(id);
}

function deleteConnection(id) {
  if (!db) throw new Error('DB not initialized');
  db.run('DELETE FROM connections WHERE id = ?', [id]);
  db.run('DELETE FROM agent_connections WHERE connection_id = ?', [id]);
  persist();
}

// ─── Agent ↔ Connection assignments ─────────────────────────────────────────

function getAgentConnectionIds(agentId) {
  if (!db) return [];
  const res = db.exec('SELECT connection_id FROM agent_connections WHERE agent_id = ?', [agentId]);
  if (!res.length) return [];
  return res[0].values.map(r => r[0]);
}

function getConnectionAgentIds(connectionId) {
  if (!db) return [];
  const res = db.exec('SELECT agent_id FROM agent_connections WHERE connection_id = ?', [connectionId]);
  if (!res.length) return [];
  return res[0].values.map(r => r[0]);
}

function setAgentConnections(agentId, connectionIds) {
  if (!db) throw new Error('DB not initialized');
  db.run('DELETE FROM agent_connections WHERE agent_id = ?', [agentId]);
  const now = new Date().toISOString();
  for (const cid of connectionIds) {
    db.run('INSERT INTO agent_connections (agent_id, connection_id, created_at) VALUES (?, ?, ?)', [agentId, cid, now]);
  }
  persist();
}

function getAgentConnectionsRaw(agentId) {
  if (!db) return [];
  const ids = getAgentConnectionIds(agentId);
  if (ids.length === 0) return [];
  return ids.map(id => getConnectionRaw(id)).filter(c => c && c.enabled);
}

function getAllAgentConnectionAssignments() {
  if (!db) return {};
  const res = db.exec('SELECT agent_id, connection_id FROM agent_connections');
  if (!res.length) return {};
  const map = {};
  for (const [agentId, connId] of res[0].values) {
    if (!map[connId]) map[connId] = [];
    map[connId].push(agentId);
  }
  return map;
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
  requireAdmin,
  requireAgentOwnership,
  requireConnectionOwnership,
  userOwnsAgent,
  userOwnsConnection,
  getAgentOwner,
  getConnectionOwner,
  deleteUser,
  updateUser,
  // Invitations
  createInvitation, getAllInvitations, getInvitationByToken, getInvitationById,
  revokeInvitation, deleteInvitation, incrementInvitationUse,
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
  // Connections
  getAllConnections, getConnection, getConnectionRaw, getEnabledConnectionsRaw,
  createConnection, updateConnection, deleteConnection,
  // Agent ↔ Connection assignments
  getAgentConnectionIds, getConnectionAgentIds, setAgentConnections,
  getAgentConnectionsRaw, getAllAgentConnectionAssignments,
};
