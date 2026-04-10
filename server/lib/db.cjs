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
      completed_at  TEXT
    )
  `);

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

function getAllTasks(filters = {}) {
  if (!db) throw new Error('DB not initialized');
  const conditions = [];
  const params = {};
  if (filters.agentId) { conditions.push('agent_id = :agentId'); params[':agentId'] = filters.agentId; }
  if (filters.status)  { conditions.push('status = :status');    params[':status']  = filters.status; }
  if (filters.priority){ conditions.push('priority = :priority');params[':priority']= filters.priority; }
  if (filters.tag)     { conditions.push('tags LIKE :tag');      params[':tag']     = `%"${filters.tag}"%`; }
  if (filters.q)       { conditions.push('title LIKE :q');       params[':q']       = `%${filters.q}%`; }
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

function createTask({ title, description, status = 'backlog', priority = 'medium', agentId, tags = [], sessionId } = {}) {
  if (!db) throw new Error('DB not initialized');
  if (!title) throw new Error('createTask: title is required');
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.run(
    'INSERT INTO tasks (id, title, description, status, priority, agent_id, session_id, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, title, description || null, status, priority, agentId || null, sessionId || null, JSON.stringify(tags || []), now, now]
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
  if (patch.cost        !== undefined) { fields.push('cost = ?');        vals.push(patch.cost); }
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
  getAllTasks, getTask, createTask, updateTask, deleteTask,
  addTaskActivity, getTaskActivity,
};
