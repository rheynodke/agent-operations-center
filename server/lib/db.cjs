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

// In-file aliases for helpers extracted to ./db/agent-profiles.cjs.
// Rooms / projects code still in this file references them directly; this
// keeps those callers working until we extract rooms.cjs / projects.cjs.
// Lazy require to avoid circular load (agent-profiles.cjs may import handle).
function getUserMasterAgentId(uid) {
  return require('./db/agent-profiles.cjs').getUserMasterAgentId(uid);
}
function userOwnsAgent(req, agentId) {
  return require('./db/agent-profiles.cjs').userOwnsAgent(req, agentId);
}
function getAgentProfile(agentId, ownerId) {
  return require('./db/agent-profiles.cjs').getAgentProfile(agentId, ownerId);
}
function setUserMasterAgent(uid, agentId) {
  return require('./db/agent-profiles.cjs').setUserMasterAgent(uid, agentId);
}
function markAgentProfileMaster(agentId, ownerId) {
  return require('./db/agent-profiles.cjs').markAgentProfileMaster(agentId, ownerId);
}
function getAgentOwner(agentId, hint) {
  return require('./db/agent-profiles.cjs').getAgentOwner(agentId, hint);
}
function getAllAgentProfiles(opts) {
  return require('./db/agent-profiles.cjs').getAllAgentProfiles(opts);
}
function backfillProjectDefaultRooms() {
  return require('./db/rooms.cjs').backfillProjectDefaultRooms();
}
function ensureProjectDefaultRoom(projectId, createdBy, memberAgentIds) {
  return require('./db/rooms.cjs').ensureProjectDefaultRoom(projectId, createdBy, memberAgentIds);
}
function getProject(id) { return require('./db/projects.cjs').getProject(id); }
function getAllProjects() { return require('./db/projects.cjs').getAllProjects(); }
function userOwnsProject(req, projectId) { return require('./db/projects.cjs').userOwnsProject(req, projectId); }
// getTaskSessionKeys is now in ./db/tasks.cjs and re-exported via the barrel below.

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

  // Migration: add meta column for per-room agent state (Task 13)
  try {
    db.run(`ALTER TABLE agent_profiles ADD COLUMN meta TEXT NOT NULL DEFAULT '{}'`);
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
  try { db.run("ALTER TABLE tasks ADD COLUMN attachments TEXT DEFAULT '[]'"); } catch {}
  // ── ADLC fields (Phase B) ──
  // stage  : where in the ADLC pipeline this task sits
  //          'discovery' | 'design' | 'architecture' | 'implementation'
  //          | 'qa' | 'docs' | 'release' | 'ops' | NULL
  // role   : which ADLC role should handle it (drives auto-assign hints)
  //          'pm' | 'pa' | 'ux' | 'em' | 'swe' | 'qa' | 'doc' | 'biz' | 'data' | NULL
  // epic_id: groups tasks under a parent epic (nullable FK to epics.id)
  try { db.run("ALTER TABLE tasks ADD COLUMN stage TEXT"); } catch {}
  try { db.run("ALTER TABLE tasks ADD COLUMN role TEXT"); } catch {}
  try { db.run("ALTER TABLE tasks ADD COLUMN epic_id TEXT"); } catch {}
  // Phase A2 — closing reflection: marks the task as already prompted for
  // memory reflection so we don't re-trigger on subsequent status changes.
  try { db.run("ALTER TABLE tasks ADD COLUMN memory_reviewed_at TEXT"); } catch {}
  try { db.run("CREATE INDEX IF NOT EXISTS idx_tasks_stage ON tasks(stage)"); } catch {}
  try { db.run("CREATE INDEX IF NOT EXISTS idx_tasks_role ON tasks(role)"); } catch {}
  try { db.run("CREATE INDEX IF NOT EXISTS idx_tasks_epic ON tasks(epic_id)"); } catch {}

  // ── Epics: group of tasks pursuing a single outcome within a project ──
  db.run(`
    CREATE TABLE IF NOT EXISTS epics (
      id          TEXT PRIMARY KEY,
      project_id  TEXT NOT NULL,
      title       TEXT NOT NULL,
      description TEXT,
      status      TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'in_progress' | 'done' | 'cancelled'
      color       TEXT,
      created_by  INTEGER,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    )
  `);
  try { db.run("CREATE INDEX IF NOT EXISTS idx_epics_project ON epics(project_id, status)"); } catch {}

  // ── Task dependencies: directed edges between tasks ──
  // kind: 'blocks'   — blocker_task_id must finish before blocked_task_id can start
  //       'relates'  — informational link (e.g. "see also") with no enforcement
  db.run(`
    CREATE TABLE IF NOT EXISTS task_dependencies (
      id                TEXT PRIMARY KEY,
      blocker_task_id   TEXT NOT NULL,
      blocked_task_id   TEXT NOT NULL,
      kind              TEXT NOT NULL DEFAULT 'blocks',
      created_at        TEXT NOT NULL,
      UNIQUE (blocker_task_id, blocked_task_id, kind)
    )
  `);
  try { db.run("CREATE INDEX IF NOT EXISTS idx_taskdeps_blocker ON task_dependencies(blocker_task_id)"); } catch {}
  try { db.run("CREATE INDEX IF NOT EXISTS idx_taskdeps_blocked ON task_dependencies(blocked_task_id)"); } catch {}

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

  // Task comments — free-form discussion thread between users and agents.
  // author_type: 'user' | 'agent'. author_id holds user.id (stringified) or agent id.
  // author_name is a snapshot so a deleted user still renders meaningfully.
  // deleted_at toggles soft-delete so history / dispatch context remains consistent.
  db.run(`
    CREATE TABLE IF NOT EXISTS task_comments (
      id           TEXT PRIMARY KEY,
      task_id      TEXT NOT NULL,
      author_type  TEXT NOT NULL,
      author_id    TEXT NOT NULL,
      author_name  TEXT,
      body         TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      edited_at    TEXT,
      deleted_at   TEXT
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id, created_at)`);

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
  // Runtime migration: workspace + repo binding columns (Phase A1)
  try { db.run("ALTER TABLE projects ADD COLUMN workspace_path TEXT"); } catch (_) {}
  try { db.run("ALTER TABLE projects ADD COLUMN workspace_mode TEXT"); } catch (_) {}
  try { db.run("ALTER TABLE projects ADD COLUMN kind TEXT DEFAULT 'ops'"); } catch (_) {}
  try { db.run("ALTER TABLE projects ADD COLUMN repo_url TEXT"); } catch (_) {}
  try { db.run("ALTER TABLE projects ADD COLUMN repo_branch TEXT"); } catch (_) {}
  try { db.run("ALTER TABLE projects ADD COLUMN repo_remote_name TEXT"); } catch (_) {}
  try { db.run("ALTER TABLE projects ADD COLUMN bound_at INTEGER"); } catch (_) {}
  try { db.run("ALTER TABLE projects ADD COLUMN last_fetched_at INTEGER"); } catch (_) {}
  try { db.run("ALTER TABLE projects ADD COLUMN created_by INTEGER"); } catch (_) {}
  try { db.run("CREATE INDEX IF NOT EXISTS idx_projects_workspace_path ON projects(workspace_path)"); } catch (_) {}

  // ── Mission Rooms ─────────────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS mission_rooms (
      id               TEXT PRIMARY KEY,
      kind             TEXT NOT NULL DEFAULT 'global',
      project_id        TEXT,
      name             TEXT NOT NULL,
      description      TEXT,
      member_agent_ids TEXT NOT NULL DEFAULT '["main"]',
      created_by       INTEGER,
      created_at       TEXT NOT NULL,
      updated_at       TEXT NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_mission_rooms_kind ON mission_rooms(kind)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_mission_rooms_project ON mission_rooms(project_id)`);
  db.run(`
    CREATE TABLE IF NOT EXISTS mission_messages (
      id              TEXT PRIMARY KEY,
      room_id         TEXT NOT NULL,
      author_type     TEXT NOT NULL,
      author_id       TEXT,
      author_name     TEXT,
      body            TEXT NOT NULL,
      mentions_json   TEXT NOT NULL DEFAULT '[]',
      related_task_id TEXT,
      meta_json       TEXT NOT NULL DEFAULT '{}',
      created_at      TEXT NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_mission_messages_room_created ON mission_messages(room_id, created_at DESC)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_mission_messages_related_task ON mission_messages(related_task_id)`);

  // ── Room Sessions (tracks gateway sessions triggered by room mentions) ──
  // Maps gateway session keys to room+agent so we can:
  //   1. Filter room-triggered sessions from DMs list
  //   2. Reuse sessions per agent+room for context continuity
  //   3. Auto-reply agent responses back to the room
  db.run(`
    CREATE TABLE IF NOT EXISTS room_sessions (
      session_key TEXT PRIMARY KEY,
      room_id     TEXT NOT NULL,
      agent_id    TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_room_sessions_room_agent ON room_sessions(room_id, agent_id)`);

  // Seed the single master global room — bound to the 'general' master project.
  // Any other rooms users want at the global scope are created via "+ New Room".
  db.run(`
    INSERT OR IGNORE INTO mission_rooms (id, kind, project_id, name, description, member_agent_ids, created_by, created_at, updated_at)
    VALUES
      ('room-general', 'global', 'general', 'General', 'Global coordination and mission control.', '["main"]', NULL, datetime('now'), datetime('now'))
  `);
  // One-time migration: drop deprecated seeded rooms and the obsolete
  // 'default' placeholder project. Safe to run repeatedly (idempotent DELETEs).
  db.run(`DELETE FROM mission_messages WHERE room_id IN ('room-hq', 'room-engineering', 'room-marketing', 'room-project-general', 'room-project-default')`);
  db.run(`DELETE FROM mission_rooms     WHERE id      IN ('room-hq', 'room-engineering', 'room-marketing', 'room-project-general', 'room-project-default')`);
  // Also catch any orphaned rooms that pointed at the removed 'default' project.
  db.run(`DELETE FROM mission_messages WHERE room_id IN (SELECT id FROM mission_rooms WHERE project_id = 'default')`);
  db.run(`DELETE FROM mission_rooms     WHERE project_id = 'default'`);
  db.run(`DELETE FROM projects          WHERE id = 'default'`);

  // ── Project memory (Phase A2) ─────────────────────────────────────────────
  // Structured persistent context per project: decisions, open questions,
  // risks (4-risk framework: value/usability/feasibility/viability), and
  // glossary terms. Surfaced into agent dispatch context.json so every turn
  // sees the latest. Distinct from per-task session memory (which lives in
  // the gateway session). Created from UI or via project_memory.sh helper.
  db.run(`
    CREATE TABLE IF NOT EXISTS project_memory (
      id              TEXT PRIMARY KEY,
      project_id      TEXT NOT NULL,
      kind            TEXT NOT NULL,            -- 'decision'|'question'|'risk'|'glossary'
      title           TEXT NOT NULL,
      body            TEXT,                      -- markdown
      status          TEXT NOT NULL DEFAULT 'open',  -- 'open'|'resolved'|'archived'
      meta            TEXT NOT NULL DEFAULT '{}',    -- kind-specific JSON
      source_task_id  TEXT,                      -- optional link to originating task
      created_by      INTEGER,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    )
  `);
  try { db.run("CREATE INDEX IF NOT EXISTS idx_project_memory_project ON project_memory(project_id, kind, status)"); } catch (_) {}

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
  // Sub-role support — alpha suffix (e.g. 'B' → display as #1B) and parent ref
  try { db.run('ALTER TABLE role_templates ADD COLUMN adlc_suffix TEXT'); } catch (_) {}
  try { db.run('ALTER TABLE role_templates ADD COLUMN sub_role_of TEXT'); } catch (_) {}

  // ── Skill Catalog (Internal Marketplace) ────────────────────────────────────
  // First-party skill registry for ADLC. Acts as a 3rd source alongside ClawHub
  // and SkillsMP. Seeded from server/data/skill-catalog-seed.json on first run.
  // Built-in skills (origin='seed') are editable but not deletable.
  // adlc_roles / risks_addressed / requires / tags stored as JSON arrays.
  db.run(`
    CREATE TABLE IF NOT EXISTS skill_catalog (
      slug             TEXT PRIMARY KEY,
      name             TEXT NOT NULL,
      description      TEXT NOT NULL DEFAULT '',
      category         TEXT,
      adlc_roles       TEXT NOT NULL DEFAULT '[]',
      risks_addressed  TEXT NOT NULL DEFAULT '[]',
      env_scope        TEXT NOT NULL DEFAULT 'agnostic',
      requires         TEXT NOT NULL DEFAULT '[]',
      tags             TEXT NOT NULL DEFAULT '[]',
      content          TEXT NOT NULL,
      scripts_json     TEXT NOT NULL DEFAULT '[]',
      version          TEXT NOT NULL DEFAULT '1.0.0',
      origin           TEXT NOT NULL DEFAULT 'user',
      maturity         TEXT NOT NULL DEFAULT 'stub',
      created_by       INTEGER,
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_skill_catalog_origin ON skill_catalog(origin)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_skill_catalog_env ON skill_catalog(env_scope)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_skill_catalog_category ON skill_catalog(category)`);
  // Arbitrary bundled files (references/, SECURITY.md, etc.) — path may include
  // subdirs like "references/format.md". Distinct from `scripts_json` which is
  // flat filenames under {skill}/scripts/ with shell-exe semantics.
  try { db.run("ALTER TABLE skill_catalog ADD COLUMN bundle_files_json TEXT NOT NULL DEFAULT '[]'"); } catch (_) {}

  // Tasks migration: add project + external sync columns
  try { db.run("ALTER TABLE tasks ADD COLUMN project_id TEXT DEFAULT 'general'"); } catch (_) {}
  try { db.run('ALTER TABLE tasks ADD COLUMN external_id TEXT'); } catch (_) {}
  try { db.run('ALTER TABLE tasks ADD COLUMN external_source TEXT'); } catch (_) {}
  db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_external ON tasks(external_id, external_source)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id)`);

  // ── Pipelines & Workflows ────────────────────────────────────────────────────
  // See docs/pipelines-design.md for full schema rationale.
  db.run(`
    CREATE TABLE IF NOT EXISTS pipelines (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT,
      graph_json  TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
      created_by  INTEGER,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_pipelines_created_by ON pipelines(created_by)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS pipeline_runs (
      id                   TEXT PRIMARY KEY,
      pipeline_id          TEXT NOT NULL,
      graph_snapshot_json  TEXT NOT NULL,
      status               TEXT NOT NULL,
      trigger_type         TEXT NOT NULL,
      trigger_payload_json TEXT,
      triggered_by         INTEGER,
      concurrency_key      TEXT,
      started_at           TEXT NOT NULL,
      ended_at             TEXT,
      error                TEXT,
      FOREIGN KEY (pipeline_id) REFERENCES pipelines(id),
      FOREIGN KEY (triggered_by) REFERENCES users(id)
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_pipeline_runs_pipeline ON pipeline_runs(pipeline_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status ON pipeline_runs(status)`);
  // Concurrency dedup — only enforce when key set AND run still active
  db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_runs_concurrency
      ON pipeline_runs(pipeline_id, concurrency_key)
      WHERE concurrency_key IS NOT NULL AND status IN ('queued','running','waiting_approval')
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pipeline_steps (
      id                   TEXT PRIMARY KEY,
      run_id               TEXT NOT NULL,
      node_id              TEXT NOT NULL,
      node_type            TEXT NOT NULL,
      agent_id             TEXT,
      session_key          TEXT,
      status               TEXT NOT NULL DEFAULT 'pending',
      attempt_count        INTEGER NOT NULL DEFAULT 0,
      input_snapshot_json  TEXT,
      queued_at            TEXT,
      dispatched_at        TEXT,
      started_at           TEXT,
      ended_at             TEXT,
      error                TEXT,
      FOREIGN KEY (run_id) REFERENCES pipeline_runs(id) ON DELETE CASCADE
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_pipeline_steps_run ON pipeline_steps(run_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_pipeline_steps_session ON pipeline_steps(session_key)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_pipeline_steps_status ON pipeline_steps(status)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS pipeline_artifacts (
      id           TEXT PRIMARY KEY,
      run_id       TEXT NOT NULL,
      step_id      TEXT NOT NULL,
      key          TEXT NOT NULL,
      content_ref  TEXT NOT NULL,
      mime_type    TEXT NOT NULL,
      size_bytes   INTEGER NOT NULL DEFAULT 0,
      checksum     TEXT,
      created_at   TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES pipeline_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (step_id) REFERENCES pipeline_steps(id) ON DELETE CASCADE
    )
  `);
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_artifacts_step_key ON pipeline_artifacts(step_id, key)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS pipeline_templates (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT,
      graph_json  TEXT NOT NULL,
      origin      TEXT NOT NULL DEFAULT 'seed',
      created_at  TEXT NOT NULL
    )
  `);

  // Per-agent concurrency hint (NULL = unlimited)
  try { db.run('ALTER TABLE agent_profiles ADD COLUMN max_parallel_steps INTEGER DEFAULT NULL'); } catch (_) {}

  // === Multi-tenant + Master Agent migrations (2026-05-04) ===
  try { db.run("ALTER TABLE users ADD COLUMN master_agent_id TEXT"); } catch (_) {}
  try { db.run("ALTER TABLE users ADD COLUMN gateway_port INTEGER"); } catch (_) {}
  try { db.run("ALTER TABLE users ADD COLUMN gateway_pid INTEGER"); } catch (_) {}
  try { db.run("ALTER TABLE users ADD COLUMN gateway_state TEXT"); } catch (_) {}
  // gateway_token persists the in-memory passphrase so AOC can re-attach to a
  // running gateway after AOC restart without having to stop & re-spawn it.
  // Lifetime: cleared on stopGateway. ROW-level only — not exposed via API.
  try { db.run("ALTER TABLE users ADD COLUMN gateway_token TEXT"); } catch (_) {}
  try { db.run("ALTER TABLE users ADD COLUMN daily_token_quota INTEGER"); } catch (_) {}
  try { db.run("ALTER TABLE users ADD COLUMN daily_token_used INTEGER NOT NULL DEFAULT 0"); } catch (_) {}
  try { db.run("ALTER TABLE users ADD COLUMN daily_token_reset_at INTEGER"); } catch (_) {}
  try { db.run("ALTER TABLE users ADD COLUMN last_activity_at INTEGER"); } catch (_) {}
  // Google OAuth (sign-in / sign-up via Google Identity)
  try { db.run("ALTER TABLE users ADD COLUMN google_sub TEXT"); } catch (_) {}
  try { db.run("ALTER TABLE users ADD COLUMN email TEXT"); } catch (_) {}
  try { db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL"); } catch (_) {}
  try { db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(LOWER(email)) WHERE email IS NOT NULL"); } catch (_) {}
  // password_hash is required by old schema. For Google-only users we store
  // a sentinel "google-oauth" placeholder that hashPassword will reject — they
  // can only authenticate via the Google flow.
  try { db.run("UPDATE users SET password_hash = 'google-oauth' WHERE password_hash IS NULL"); } catch (_) {}
  try { db.run("ALTER TABLE agent_profiles ADD COLUMN is_master INTEGER NOT NULL DEFAULT 0"); } catch (_) {}
  try { db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_profiles_one_master_per_owner ON agent_profiles(provisioned_by) WHERE is_master = 1"); } catch (_) {}

  // ───────────────────────────────────────────────────────────────────────────
  // Multi-tenant agent_id migration (cross-tenant collision fix)
  // Old schema: agent_profiles.agent_id was a global PRIMARY KEY → two users
  // provisioning agents with the same slug would silently overwrite each
  // other's profile. New schema: composite PK (agent_id, provisioned_by) so
  // user A's "migi" and user B's "migi" coexist as distinct rows. Also adds
  // owner_id to agent_connections so connection assignments don't bleed
  // across tenants.
  //
  // SQLite cannot ALTER PRIMARY KEY in place — we rebuild the tables. The
  // helper guards against re-running once migration is done.
  // ───────────────────────────────────────────────────────────────────────────
  (function migrateAgentProfilesCompositePk() {
    try {
      const info = db.exec("PRAGMA table_info('agent_profiles')");
      if (!info.length) return;
      const cols = info[0].values.map(r => ({ name: r[1], pk: r[5] }));
      const pkCols = cols.filter(c => c.pk > 0).map(c => c.name);
      // Already migrated if PK is composite (length > 1)
      if (pkCols.length > 1) return;
      // Rebuild table with composite PK
      console.log('[db migration] agent_profiles → composite PK (agent_id, provisioned_by)');
      db.run(`
        CREATE TABLE agent_profiles_new (
          agent_id TEXT NOT NULL,
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
          provisioned_by INTEGER NOT NULL DEFAULT 1,
          updated_at TEXT DEFAULT (datetime('now')),
          is_master INTEGER NOT NULL DEFAULT 0,
          role TEXT,
          meta TEXT NOT NULL DEFAULT '{}',
          max_parallel_steps INTEGER DEFAULT NULL,
          PRIMARY KEY (agent_id, provisioned_by)
        )
      `);
      // Discover which optional columns the old table actually has
      const colNames = cols.map(c => c.name);
      const has = (n) => colNames.includes(n);
      const select = [
        'agent_id',
        has('display_name')     ? 'display_name'     : "NULL AS display_name",
        has('emoji')            ? 'emoji'            : "NULL AS emoji",
        has('avatar_data')      ? 'avatar_data'      : "NULL AS avatar_data",
        has('avatar_mime')      ? 'avatar_mime'      : "NULL AS avatar_mime",
        has('avatar_preset_id') ? 'avatar_preset_id' : "NULL AS avatar_preset_id",
        has('color')            ? 'color'            : "NULL AS color",
        has('description')      ? 'description'      : "NULL AS description",
        has('tags')             ? 'tags'             : "NULL AS tags",
        has('notes')            ? 'notes'            : "NULL AS notes",
        has('provisioned_at')   ? 'provisioned_at'   : "datetime('now') AS provisioned_at",
        has('provisioned_by')   ? 'COALESCE(provisioned_by, 1) AS provisioned_by' : '1 AS provisioned_by',
        has('updated_at')       ? 'updated_at'       : "datetime('now') AS updated_at",
        has('is_master')        ? 'is_master'        : '0 AS is_master',
        has('role')             ? 'role'             : "NULL AS role",
        has('meta')             ? 'meta'             : "'{}' AS meta",
        has('max_parallel_steps') ? 'max_parallel_steps' : "NULL AS max_parallel_steps",
      ].join(', ');
      db.run(`INSERT INTO agent_profiles_new SELECT ${select} FROM agent_profiles`);
      db.run('DROP TABLE agent_profiles');
      db.run('ALTER TABLE agent_profiles_new RENAME TO agent_profiles');
      // Re-create the master uniqueness index on the new table
      db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_profiles_one_master_per_owner ON agent_profiles(provisioned_by) WHERE is_master = 1");
      console.log('[db migration] agent_profiles migration complete');
    } catch (err) {
      console.error('[db migration] agent_profiles failed:', err.message);
    }
  })();

  (function migrateAgentConnectionsOwner() {
    try {
      const info = db.exec("PRAGMA table_info('agent_connections')");
      if (!info.length) return;
      const colNames = info[0].values.map(r => r[1]);
      if (colNames.includes('owner_id')) return; // already migrated
      console.log('[db migration] agent_connections → adding owner_id');
      db.run("ALTER TABLE agent_connections ADD COLUMN owner_id INTEGER");
      // Backfill from agent_profiles. After the composite PK migration above
      // a slug may have multiple owners; pick any (admin-leaning) — operators
      // should re-assign ambiguous rows manually if any exist.
      db.run(`
        UPDATE agent_connections
        SET owner_id = (
          SELECT provisioned_by FROM agent_profiles
          WHERE agent_profiles.agent_id = agent_connections.agent_id
          ORDER BY (provisioned_by = 1) DESC, provisioned_by ASC LIMIT 1
        )
        WHERE owner_id IS NULL
      `);
      // Anything still null (no profile row) → admin
      db.run("UPDATE agent_connections SET owner_id = 1 WHERE owner_id IS NULL");
      db.run("CREATE INDEX IF NOT EXISTS idx_agent_connections_agent_owner ON agent_connections(agent_id, owner_id)");
      console.log('[db migration] agent_connections migration complete');
    } catch (err) {
      console.error('[db migration] agent_connections failed:', err.message);
    }
  })();

  // === HQ Room columns (sub-project 3, Phase 1) ===
  try { db.run("ALTER TABLE mission_rooms ADD COLUMN is_hq INTEGER NOT NULL DEFAULT 0"); } catch (_) {}
  try { db.run("ALTER TABLE mission_rooms ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0"); } catch (_) {}
  try { db.run("ALTER TABLE mission_rooms ADD COLUMN owner_user_id INTEGER"); } catch (_) {}
  try { db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_mission_rooms_one_hq_per_owner ON mission_rooms(owner_user_id) WHERE is_hq = 1"); } catch (_) {}

  // === Phase 2 Collaboration Schema (Task 11) ===
  // Room artifacts: versioned outputs, research, decisions, assets per room
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS room_artifacts (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'outputs',
        title TEXT NOT NULL,
        description TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        latest_version_id TEXT,
        FOREIGN KEY (room_id) REFERENCES mission_rooms(id) ON DELETE CASCADE
      )
    `);
  } catch (_) { /* table already exists */ }

  try {
    db.run(`CREATE INDEX IF NOT EXISTS idx_room_artifacts_room ON room_artifacts(room_id)`);
  } catch (_) {}

  try {
    db.run(`CREATE INDEX IF NOT EXISTS idx_room_artifacts_category ON room_artifacts(room_id, category)`);
  } catch (_) {}

  // Room artifact versions: version history with SHA-256 deduplication
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS room_artifact_versions (
        id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL,
        version_number INTEGER NOT NULL,
        file_path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL DEFAULT 'text/plain',
        size_bytes INTEGER NOT NULL DEFAULT 0,
        sha256 TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (artifact_id) REFERENCES room_artifacts(id) ON DELETE CASCADE
      )
    `);
  } catch (_) { /* table already exists */ }

  try {
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_artifact_versions_unique ON room_artifact_versions(artifact_id, version_number)`);
  } catch (_) {}

  // Room sessions (Phase 2): comprehensive session tracking for room collaboration (artifact history, etc.)
  // NOTE: There is an earlier room_sessions table (line ~307) with a different schema used for lightweight
  // session→room mapping. This Phase 2 version is meant to replace/upgrade that table eventually.
  // For now, we rename to room_collaboration_sessions to avoid schema collision.
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS room_collaboration_sessions (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        session_key TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        started_by TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        FOREIGN KEY (room_id) REFERENCES mission_rooms(id) ON DELETE CASCADE
      )
    `);
  } catch (_) { /* table already exists */ }

  try {
    db.run(`CREATE INDEX IF NOT EXISTS idx_room_collaboration_sessions_room ON room_collaboration_sessions(room_id)`);
  } catch (_) {}

  try {
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_room_collaboration_sessions_session ON room_collaboration_sessions(session_key)`);
  } catch (_) {}

  // Mission rooms: supports_collab flag for Phase 2 collaboration features
  try {
    db.run("ALTER TABLE mission_rooms ADD COLUMN supports_collab INTEGER NOT NULL DEFAULT 0");
  } catch (_) { /* column already exists */ }

  // === port_reservations (2026-05-06) — atomic gateway port claim ===
  // Each gateway needs a stride of 3 ports (WS / canvas / browser-control).
  // Inserts of 3 rows happen inside a single sync block so concurrent
  // spawnGateway calls cannot pick the same triple.
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS port_reservations (
        port            INTEGER PRIMARY KEY,
        user_id         INTEGER NOT NULL,
        reservation_id  TEXT NOT NULL,
        reserved_at     INTEGER NOT NULL,
        pid             INTEGER,
        state           TEXT NOT NULL
      )
    `);
  } catch (_) {}
  try { db.run(`CREATE INDEX IF NOT EXISTS idx_port_reservations_user ON port_reservations(user_id)`); } catch (_) {}
  try { db.run(`CREATE INDEX IF NOT EXISTS idx_port_reservations_resv ON port_reservations(reservation_id)`); } catch (_) {}
  try { db.run(`CREATE INDEX IF NOT EXISTS idx_port_reservations_state ON port_reservations(state)`); } catch (_) {}

  try { backfillProjectDefaultRooms(); } catch (err) { console.warn('[db] mission room backfill failed:', err.message); }

  // === Multitenant ownership backfill (2026-05-04) ===
  try {
    const result = require('./migrations/2026-05-04-multitenant.cjs').run(db);
    console.log('[db] multitenant backfill:', JSON.stringify(result));
  } catch (e) {
    console.error('[db] multitenant backfill failed:', e.message);
  }

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

  // Register the sql.js handle with the shared module so domain-split files
  // (server/lib/db/*.cjs) can read/write without a circular require back here.
  // Must run BEFORE the migration runner — migrations may invoke domain helpers.
  try {
    require('./db/_handle.cjs').setHandle(db, { persist, persistNow });
  } catch (e) {
    console.warn('[db] handle registration failed:', e.message);
  }

  // Run versioned migrations (forward-only, idempotent). Inline ALTER TABLEs
  // above remain as the implicit "baseline v0"; new migrations live in
  // server/lib/db-migrations/ and are recorded in schema_migrations.
  try {
    const { runMigrations } = require('./db-migrations/index.cjs');
    const result = runMigrations(db);
    if (result.applied.length) {
      console.log(`[db] migrations applied: ${result.applied.join(', ')}`);
    }
  } catch (e) {
    console.error('[db] migration runner failed:', e.message);
    throw e;
  }

  persistNow(); // synchronous initial flush so first reader sees full schema
  return db;
}

// Tasks + epics + dependencies + activity + comments extracted to ./db/tasks.cjs
// ─── Persistence ──────────────────────────────────────────────────────────────
//
// sql.js is in-memory; persist() serializes the full DB image to disk. Each
// call rewrites the entire file, so naive every-mutation persist() at AOC's
// concurrent provisioning load (10+ users registering at once) creates back-
// to-back full snapshots that compete for disk IO.
//
// Strategy: queue a trailing-edge debounced flush on a 250ms timer. Mutations
// keep landing in memory; we serialize at most ~4×/second under burst. On
// process exit (SIGTERM, beforeExit) we synchronously flush so the latest
// state lands on disk. Callers can still force a synchronous flush via
// `persistNow()` for write-then-read paths that must hit disk (rare).

const PERSIST_DEBOUNCE_MS = 250;
let _persistTimer = null;
let _persistPending = false;

function persistNow() {
  if (!db) return;
  if (_persistTimer) { clearTimeout(_persistTimer); _persistTimer = null; }
  _persistPending = false;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function persist() {
  if (!db) return;
  _persistPending = true;
  if (_persistTimer) return; // a flush is already scheduled
  _persistTimer = setTimeout(() => {
    _persistTimer = null;
    if (_persistPending) {
      try { persistNow(); }
      catch (e) { console.error('[db] debounced persist failed:', e.message); }
    }
  }, PERSIST_DEBOUNCE_MS);
  if (typeof _persistTimer.unref === 'function') _persistTimer.unref();
}

// Drain any pending writes synchronously on process shutdown so the disk
// image matches in-memory state. Idempotent — safe to call multiple times.
function flushPendingPersist() {
  if (_persistPending || _persistTimer) {
    try { persistNow(); } catch (e) { console.error('[db] flush on shutdown failed:', e.message); }
  }
}

// Wire shutdown hooks once at module load. process.on is idempotent if the
// listener identity matches, but we guard with a flag to be safe under HMR.
if (!global.__aocDbShutdownHooked) {
  global.__aocDbShutdownHooked = true;
  process.on('beforeExit', flushPendingPersist);
  process.on('SIGINT',  () => { flushPendingPersist(); process.exit(0); });
  process.on('SIGTERM', () => { flushPendingPersist(); process.exit(0); });
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
  const result = db.exec('SELECT id, username, display_name, role, can_use_claude_terminal, created_at, last_login, master_agent_id, daily_token_quota, daily_token_used, daily_token_reset_at, dlp_encryption_key FROM users WHERE id = ?', [id]);
  if (result.length === 0 || result[0].values.length === 0) return null;

  const row = result[0].values[0];
  const cols = result[0].columns;
  const raw = Object.fromEntries(cols.map((c, i) => [c, row[i]]));
  // Expose camelCase alias for DLP key so encryption module can read it
  raw.dlpEncryptionKey = raw.dlp_encryption_key;
  return raw;
}

function setUserDlpEncryptionKey(userId, sealedKey) {
  if (!db) throw new Error('Database not initialized');
  const stmt = db.prepare('UPDATE users SET dlp_encryption_key = ? WHERE id = ?');
  stmt.run([sealedKey, Number(userId)]);
  stmt.free();
  persist();
}

// Token budget enforcement extracted to ./db/budget.cjs — re-exported via the
// barrel below so existing callers (db.checkTokenBudget / db.recordTokenUsage)
// keep working without a code change.

// ─── Google OAuth helpers ────────────────────────────────────────────────────
function getUserByGoogleSub(sub) {
  if (!db || !sub) return null;
  const r = db.exec('SELECT * FROM users WHERE google_sub = ?', [String(sub)]);
  if (!r.length || !r[0].values.length) return null;
  const row = r[0].values[0]; const cols = r[0].columns;
  return Object.fromEntries(cols.map((c, i) => [c, row[i]]));
}

function getUserByEmail(email) {
  if (!db || !email) return null;
  const r = db.exec('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [String(email)]);
  if (!r.length || !r[0].values.length) return null;
  const row = r[0].values[0]; const cols = r[0].columns;
  return Object.fromEntries(cols.map((c, i) => [c, row[i]]));
}

/** Link a Google identity (sub + email) to an existing user. Idempotent. */
function linkGoogleIdentity(userId, { sub, email }) {
  if (!db) throw new Error('Database not initialized');
  db.run('UPDATE users SET google_sub = ?, email = ? WHERE id = ?', [
    String(sub), email ? String(email).toLowerCase() : null, Number(userId),
  ]);
  persist();
}

/**
 * Create a user via Google OAuth. password_hash is set to a sentinel that
 * never matches verifyPassword — these users can only sign in via Google.
 */
function createGoogleUser({ username, displayName, email, googleSub, role = 'user' }) {
  if (!db) throw new Error('Database not initialized');
  if (!username || !googleSub) throw new Error('username and googleSub required');
  const stmt = db.prepare(
    'INSERT INTO users (username, display_name, password_hash, role, google_sub, email) VALUES (?, ?, ?, ?, ?, ?)'
  );
  stmt.run([
    username,
    displayName || username,
    'google-oauth',           // sentinel — verifyPassword always fails
    role,
    String(googleSub),
    email ? String(email).toLowerCase() : null,
  ]);
  stmt.free();
  persist();

  const r = db.exec('SELECT * FROM users WHERE google_sub = ?', [String(googleSub)]);
  if (!r.length || !r[0].values.length) return null;
  const row = r[0].values[0]; const cols = r[0].columns;
  return Object.fromEntries(cols.map((c, i) => [c, row[i]]));
}

// Master agent linking + agent profile CRUD extracted to ./db/agent-profiles.cjs

function updateLastLogin(userId) {
  if (!db) return;
  db.run("UPDATE users SET last_login = datetime('now') WHERE id = ?", [userId]);
  persist();
}

function getAllUsers() {
  if (!db) return [];
  const result = db.exec(
    'SELECT id, username, display_name, role, can_use_claude_terminal, created_at, last_login, ' +
    'master_agent_id, daily_token_quota, daily_token_used, daily_token_reset_at, last_activity_at ' +
    'FROM users ORDER BY created_at'
  );
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

/**
 * Cascade-delete every DB row owned by a user, then the user row itself.
 * Returns a counts summary so the caller can log/return what was wiped.
 * Caller is responsible for stopping the user's gateway and removing their
 * filesystem home — see /api/users/:id DELETE handler.
 *
 * @param {number} id
 * @returns {{ counts: Record<string, number> }}
 */
function purgeUserData(id) {
  if (!db) return { counts: {} };
  const uid = Number(id);
  const counts = {};
  const wipe = (label, sql, params = [uid]) => {
    try {
      const before = scalarCount(sql.replace(/^DELETE FROM/i, 'SELECT COUNT(*) FROM').replace(/;$/, ''), params);
      db.run(sql, params);
      counts[label] = before;
    } catch (e) {
      counts[label] = `error:${e.message}`;
    }
  };

  // Order matters: child rows first (FK-light schema, but keep the discipline).
  wipe('tasks_by_owner',         'DELETE FROM tasks         WHERE created_by = ?');
  wipe('tasks_by_project',       'DELETE FROM tasks         WHERE project_id IN (SELECT id FROM projects WHERE created_by = ?)');
  wipe('project_memory',         'DELETE FROM project_memory WHERE created_by = ? OR project_id IN (SELECT id FROM projects WHERE created_by = ?)', [uid, uid]);
  wipe('epics',                  'DELETE FROM epics         WHERE created_by = ? OR project_id IN (SELECT id FROM projects WHERE created_by = ?)', [uid, uid]);
  wipe('mission_rooms',          'DELETE FROM mission_rooms WHERE created_by = ?');
  wipe('pipelines',              'DELETE FROM pipelines     WHERE created_by = ?');
  wipe('connections',            'DELETE FROM connections   WHERE created_by = ?');
  wipe('projects',               'DELETE FROM projects      WHERE created_by = ?');
  wipe('agent_profiles',         'DELETE FROM agent_profiles WHERE provisioned_by = ?');
  // Gateway state lives in users.gateway_{port,pid,state} columns — drops with the user row below.
  wipe('invitations',            'DELETE FROM invitations   WHERE created_by = ?');

  // Finally, the user row.
  try {
    db.run('DELETE FROM users WHERE id = ?', [uid]);
    counts.users = 1;
  } catch (e) {
    counts.users = `error:${e.message}`;
  }

  persist();
  return { counts };
}

// Internal: COUNT helper used by purgeUserData (kept private — sql.js has no scalar API).
function scalarCount(sql, params) {
  try {
    const res = db.exec(sql, params);
    if (!res.length) return 0;
    return Number(res[0].values?.[0]?.[0]) || 0;
  } catch { return 0; }
}

function updateUser(id, { displayName, role, password, canUseClaudeTerminal, dailyTokenQuota } = {}) {
  if (!db) return null;
  const fields = ["updated_at = datetime('now')"];
  const vals = [];
  if (displayName !== undefined) { fields.push('display_name = ?'); vals.push(displayName); }
  if (role !== undefined) { fields.push('role = ?'); vals.push(role); }
  if (password) { fields.push('password_hash = ?'); vals.push(hashPassword(password)); }
  if (canUseClaudeTerminal !== undefined) { fields.push('can_use_claude_terminal = ?'); vals.push(canUseClaudeTerminal ? 1 : 0); }
  if (dailyTokenQuota !== undefined) {
    // Treat 0/null/empty as "unlimited" — store as NULL so JOINs treat it consistently.
    const q = (dailyTokenQuota === null || dailyTokenQuota === '' || Number(dailyTokenQuota) <= 0)
      ? null
      : Math.floor(Number(dailyTokenQuota));
    fields.push('daily_token_quota = ?');
    vals.push(q);
  }
  if (vals.length === 0) return getUserById(id);
  vals.push(id);
  db.run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, vals);
  persist();
  return getUserById(id);
}

// Invitations extracted to ./db/invitations.cjs (re-exported via barrel below).

// ─── JWT ──────────────────────────────────────────────────────────────────────
function generateToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      username: user.username,
      displayName: user.display_name || user.displayName || user.username,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

/**
 * Mint a per-agent service token. Used by skill scripts running as a specific
 * agent (delegate, mcp-call, update-task) so each agent authenticates as
 * itself rather than sharing one cluster-wide DASHBOARD_TOKEN.
 *
 * Claims:
 *   - kind:    'agent-service' (lets authMiddleware route the JWT correctly)
 *   - agentId: the agent the token represents
 *   - ownerId: the user who owns that agent (used as req.user.userId)
 *   - role:    'agent' (preserves existing service-token semantics)
 *
 * No expiry — these live on disk in `.aoc_agent_env` (mode 0600). Rotate
 * by re-provisioning or via a future "rotate token" admin endpoint.
 */
function generateAgentServiceToken({ agentId, ownerId }) {
  if (!agentId) throw new Error('generateAgentServiceToken: agentId required');
  if (ownerId == null) throw new Error('generateAgentServiceToken: ownerId required');
  return jwt.sign(
    {
      kind: 'agent-service',
      agentId: String(agentId),
      ownerId: Number(ownerId),
      role: 'agent',
    },
    JWT_SECRET
    // intentionally no expiresIn — agent tokens are filesystem-bound and
    // revoked by re-provisioning the agent.
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

  // Accept legacy cluster-wide DASHBOARD_TOKEN (deprecated — full bypass).
  // Per-agent service tokens (minted at provision, JWT kind='agent-service')
  // are preferred and validated below alongside dashboard JWTs.
  const dashboardToken = process.env.DASHBOARD_TOKEN;
  if (dashboardToken && token === dashboardToken) {
    req.user = { userId: 0, username: 'agent', role: 'agent' };
    return next();
  }

  // Otherwise verify as JWT (dashboard user session OR per-agent service token)
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Per-agent service token: scope this request to (agentId, ownerId). Routes
  // see role='agent' but unlike DASHBOARD_TOKEN, ownership is bounded —
  // userOwnsAgent below enforces match against payload.agentId.
  if (payload.kind === 'agent-service') {
    req.user = {
      userId: Number(payload.ownerId) || 0,
      role: 'agent',
      agentId: payload.agentId,
      username: `agent:${payload.agentId}`,
    };
    return next();
  }

  // Backfill displayName for tokens issued before it was embedded.
  if (!payload.displayName && payload.userId) {
    try {
      const u = getUserById(payload.userId);
      if (u) payload.displayName = u.display_name || u.username;
    } catch { /* best-effort */ }
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

// Agent ownership + composite-PK profile CRUD extracted to ./db/agent-profiles.cjs.
// Connection ownership extracted to ./db/connections.cjs.
// Pipeline ownership extracted to ./db/pipelines.cjs.

// Project ownership + scopeByOwner extracted to ./db/projects.cjs
// Gateway state + port_reservations extracted to ./db/gateway-state.cjs

// Agent profile CRUD extracted to ./db/agent-profiles.cjs
// Connections (table) + agent_connections (junction) extracted to ./db/connections.cjs

// ─── Exports ──────────────────────────────────────────────────────────────────
// Raw DB accessor — for modules that need to run ad-hoc queries.
function getRawDb() { return db; }

module.exports = {
  getRawDb,
  initDatabase,
  getDb: () => db,
  persist,
  persistNow,
  flushPendingPersist,
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
  createGoogleUser,
  getUserByUsername,
  getUserById,
  setUserDlpEncryptionKey,
  getUserByGoogleSub,
  getUserByEmail,
  linkGoogleIdentity,
  updateLastLogin,
  getAllUsers,
  hashPassword,
  verifyPassword,
  generateToken,
  generateAgentServiceToken,
  // Token budget — extracted to ./db/budget.cjs (Sprint 4 split foundation)
  ...require('./db/budget.cjs'),
  verifyToken,
  authMiddleware,
  requireAdmin,
  deleteUser,
  purgeUserData,
  updateUser,
  // Invitations — extracted to ./db/invitations.cjs
  ...require('./db/invitations.cjs'),
  JWT_SECRET,
  // Agent profiles + ownership + master linking — extracted to ./db/agent-profiles.cjs
  ...require('./db/agent-profiles.cjs'),
  // Tasks + epics + dependencies + activity + comments — extracted to ./db/tasks.cjs
  ...require('./db/tasks.cjs'),
  // Mission rooms + messages + room↔session tracking — extracted to ./db/rooms.cjs
  ...require('./db/rooms.cjs'),
  // Projects + integrations + memory + ownership + scopeByOwner — extracted to ./db/projects.cjs
  ...require('./db/projects.cjs'),
  // Connections + agent_connections junction + ownership — extracted to ./db/connections.cjs
  ...require('./db/connections.cjs'),
  // Pipelines — extracted to ./db/pipelines.cjs (incl. ownership helpers)
  ...require('./db/pipelines.cjs'),
  // Gateway state + port_reservations — extracted to ./db/gateway-state.cjs
  ...require('./db/gateway-state.cjs'),
  // Admin announcements + per-user read receipts — extracted to ./db/announcements.cjs
  ...require('./db/announcements.cjs'),
  // Satisfaction — feedback ratings, session summaries, daily rollups
  ...require('./db/satisfaction.cjs'),
  // Embed channel — agent_embeds CRUD
  ...require('./db/embeds.cjs'),
  // Embed channel — embed_sessions CRUD
  ...require('./db/embed-sessions.cjs'),
  // Embed channel — embed_audit_log CRUD
  ...require('./db/embed-audit.cjs'),
};
