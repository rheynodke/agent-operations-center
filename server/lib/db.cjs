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
  try { db.run("ALTER TABLE agent_profiles ADD COLUMN is_master INTEGER NOT NULL DEFAULT 0"); } catch (_) {}
  try { db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_profiles_one_master_per_owner ON agent_profiles(provisioned_by) WHERE is_master = 1"); } catch (_) {}

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
    attachments: (() => { try { return row.attachments ? JSON.parse(row.attachments) : []; } catch { return []; } })(),
    // ADLC fields (Phase B)
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

function getProjectByPath(workspacePath) {
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
  ensureProjectDefaultRoom(id, createdBy);
  persist();
  return getProject(id);
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function normalizeMissionMembers(memberAgentIds) {
  const ids = Array.isArray(memberAgentIds) ? memberAgentIds : [];
  const out = [];
  for (const raw of ['main', ...ids]) {
    const id = String(raw || '').trim();
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

function normalizeMissionRoom(row) {
  if (!row || !row.id) return null;
  return {
    id: row.id,
    kind: row.kind || 'global',
    projectId: row.project_id || null,
    name: row.name,
    description: row.description || null,
    memberAgentIds: normalizeMissionMembers(parseJsonArray(row.member_agent_ids)),
    createdBy: row.created_by != null ? Number(row.created_by) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeMissionMessage(row) {
  if (!row || !row.id) return null;
  return {
    id: row.id,
    roomId: row.room_id,
    authorType: row.author_type || 'user',
    authorId: row.author_id || null,
    authorName: row.author_name || null,
    body: row.body || '',
    mentions: parseJsonArray(row.mentions_json),
    relatedTaskId: row.related_task_id || null,
    meta: parseJsonObject(row.meta_json),
    createdAt: row.created_at,
  };
}

function getOwnedAgentIds(userId) {
  if (!db || userId == null) return [];
  const res = db.exec('SELECT agent_id FROM agent_profiles WHERE provisioned_by = ?', [Number(userId)]);
  if (!res.length) return [];
  return res[0].values.map(r => r[0]).filter(Boolean);
}

function getMissionRoom(id) {
  if (!db) throw new Error('DB not initialized');
  const stmt = db.prepare('SELECT * FROM mission_rooms WHERE id = :id');
  const row = stmt.getAsObject({ ':id': id });
  stmt.free();
  return row.id ? normalizeMissionRoom(row) : null;
}

function getProjectDefaultRoom(projectId) {
  if (!db) throw new Error('DB not initialized');
  const stmt = db.prepare("SELECT * FROM mission_rooms WHERE kind = 'project' AND project_id = :pid ORDER BY created_at ASC LIMIT 1");
  const row = stmt.getAsObject({ ':pid': projectId });
  stmt.free();
  return row.id ? normalizeMissionRoom(row) : null;
}

function ensureProjectDefaultRoom(projectId, createdBy = null, memberAgentIds = null) {
  if (!db) throw new Error('DB not initialized');
  if (!projectId) throw new Error('ensureProjectDefaultRoom: projectId is required');
  // 'general' is the master project — its room is the seeded global room, not a project room.
  if (projectId === 'general') return null;
  const existing = getProjectDefaultRoom(projectId);
  if (existing) return existing;
  const project = getProject(projectId);
  if (!project) return null;
  const ids = normalizeMissionMembers(memberAgentIds || getOwnedAgentIds(createdBy));
  const id = `room-project-${projectId}`;
  const now = new Date().toISOString();
  db.run(
    'INSERT OR IGNORE INTO mission_rooms (id, kind, project_id, name, description, member_agent_ids, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, 'project', projectId, `${project.name} Room`, `Default mission room for ${project.name}.`, JSON.stringify(ids), createdBy != null ? Number(createdBy) : null, now, now]
  );
  persist();
  return getProjectDefaultRoom(projectId);
}

function backfillProjectDefaultRooms() {
  if (!db) throw new Error('DB not initialized');
  const projects = getAllProjects();
  let created = 0;
  for (const project of projects) {
    if (project.id === 'general') continue;
    if (!getProjectDefaultRoom(project.id)) {
      ensureProjectDefaultRoom(project.id, project.createdBy ?? null);
      created++;
    }
  }
  return { created };
}

function listMissionRooms() {
  if (!db) throw new Error('DB not initialized');
  const stmt = db.prepare('SELECT * FROM mission_rooms ORDER BY kind ASC, created_at ASC');
  const rows = [];
  while (stmt.step()) rows.push(normalizeMissionRoom(stmt.getAsObject()));
  stmt.free();
  return rows.filter(Boolean);
}

function listMissionRoomsForUser(req) {
  const rooms = listMissionRooms();
  if (!req?.user) return [];
  if (req.user.role === 'admin' || req.user.role === 'agent') return rooms;
  return rooms.filter((room) => {
    if (room.kind === 'global') return true;
    if (room.projectId && userOwnsProject(req, room.projectId)) return true;
    return room.memberAgentIds.some((id) => id !== 'main' && userOwnsAgent(req, id));
  });
}

function createMissionRoom({ kind = 'global', projectId = null, name, description = null, memberAgentIds = [], createdBy = null } = {}) {
  if (!db) throw new Error('DB not initialized');
  if (!name?.trim()) throw new Error('createMissionRoom: name is required');
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.run(
    'INSERT INTO mission_rooms (id, kind, project_id, name, description, member_agent_ids, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, kind, projectId || null, name.trim(), description || null, JSON.stringify(normalizeMissionMembers(memberAgentIds)), createdBy != null ? Number(createdBy) : null, now, now]
  );
  persist();
  return getMissionRoom(id);
}

function updateMissionRoomMembers(id, memberAgentIds = []) {
  if (!db) throw new Error('DB not initialized');
  const now = new Date().toISOString();
  db.run('UPDATE mission_rooms SET member_agent_ids = ?, updated_at = ? WHERE id = ?', [JSON.stringify(normalizeMissionMembers(memberAgentIds)), now, id]);
  persist();
  return getMissionRoom(id);
}

function listMissionMessages(roomId, { before, limit = 50 } = {}) {
  if (!db) throw new Error('DB not initialized');
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
  const rows = [];
  const sql = before
    ? 'SELECT * FROM mission_messages WHERE room_id = :rid AND created_at < :before ORDER BY created_at DESC LIMIT :limit'
    : 'SELECT * FROM mission_messages WHERE room_id = :rid ORDER BY created_at DESC LIMIT :limit';
  const stmt = db.prepare(sql);
  stmt.bind(before ? { ':rid': roomId, ':before': before, ':limit': safeLimit } : { ':rid': roomId, ':limit': safeLimit });
  while (stmt.step()) rows.push(normalizeMissionMessage(stmt.getAsObject()));
  stmt.free();
  return rows.filter(Boolean);
}

function createMissionMessage({ roomId, authorType, authorId, authorName, body, mentions = [], relatedTaskId = null, meta = {} } = {}) {
  if (!db) throw new Error('DB not initialized');
  if (!roomId) throw new Error('createMissionMessage: roomId is required');
  if (!body?.trim()) throw new Error('createMissionMessage: body is required');
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.run(
    'INSERT INTO mission_messages (id, room_id, author_type, author_id, author_name, body, mentions_json, related_task_id, meta_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, roomId, authorType || 'user', authorId || null, authorName || null, body.trim(), JSON.stringify(mentions || []), relatedTaskId || null, JSON.stringify(meta || {}), now]
  );
  persist();
  return normalizeMissionMessage({ id, room_id: roomId, author_type: authorType || 'user', author_id: authorId || null, author_name: authorName || null, body: body.trim(), mentions_json: JSON.stringify(mentions || []), related_task_id: relatedTaskId || null, meta_json: JSON.stringify(meta || {}), created_at: now });
}

// ─── Room Sessions (gateway session ↔ room tracking) ──────────────────────────

/** Mark a gateway session as triggered by a room mention */
function markSessionAsRoomTriggered(sessionKey, roomId, agentId) {
  if (!db) throw new Error('DB not initialized');
  db.run(
    `INSERT OR REPLACE INTO room_sessions (session_key, room_id, agent_id, created_at) VALUES (?, ?, ?, datetime('now'))`,
    [sessionKey, roomId, agentId]
  );
  persist();
}

/** Get all session keys that were triggered by room mentions */
function getRoomSessionKeys() {
  if (!db) return [];
  const res = db.exec('SELECT session_key FROM room_sessions');
  if (!res.length) return [];
  return res[0].values.map(r => r[0]).filter(Boolean);
}

/** Get the most recent gateway session for a specific agent+room combo (Phase 2: reuse) */
function getRoomAgentSession(roomId, agentId) {
  if (!db) return null;
  const stmt = db.prepare(
    'SELECT session_key FROM room_sessions WHERE room_id = :rid AND agent_id = :aid ORDER BY created_at DESC LIMIT 1'
  );
  const row = stmt.getAsObject({ ':rid': roomId, ':aid': agentId });
  stmt.free();
  return row.session_key || null;
}

/** Get room+agent info for a session key (Phase 3: auto-reply) */
function getRoomForSession(sessionKey) {
  if (!db) return null;
  const stmt = db.prepare(
    'SELECT room_id, agent_id FROM room_sessions WHERE session_key = :key'
  );
  const row = stmt.getAsObject({ ':key': sessionKey });
  stmt.free();
  return (row.room_id && row.agent_id) ? { roomId: row.room_id, agentId: row.agent_id } : null;
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
  if (patch.kind        !== undefined) { fields.push('kind = ?');        vals.push(patch.kind || 'ops'); }
  vals.push(id);
  db.run(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`, vals);
  persist();
  return getProject(id);
}

// Set / replace workspace binding on an existing project. Pass null to clear.
function setProjectWorkspace(id, {
  workspacePath, workspaceMode,
  repoUrl, repoBranch, repoRemoteName,
  boundAt,
} = {}) {
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
  persist();
  return getProject(id);
}

function bumpProjectFetchedAt(id, ts = Date.now()) {
  if (!db) throw new Error('DB not initialized');
  db.run('UPDATE projects SET last_fetched_at = ?, updated_at = ? WHERE id = ?',
    [ts, new Date().toISOString(), id]);
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

function createTask({
  title, description, status = 'backlog', priority = 'medium',
  agentId, tags = [], sessionId,
  projectId = 'general', externalId, externalSource,
  requestFrom = '-', attachments = [],
  // Phase B — ADLC fields (all nullable; surfaced only for adlc-kind projects).
  stage, role, epicId,
} = {}) {
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
  persist();
  return getTask(id);
}

function deleteTask(id) {
  if (!db) throw new Error('DB not initialized');
  db.run('DELETE FROM task_activity WHERE task_id = ?', [id]);
  db.run('DELETE FROM task_dependencies WHERE blocker_task_id = ? OR blocked_task_id = ?', [id, id]);
  db.run('DELETE FROM tasks WHERE id = ?', [id]);
  persist();
}

// ─── Epics (Phase B — group of related ADLC tasks) ──────────────────────────

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

function listEpics(projectId) {
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
  if (!db) throw new Error('DB not initialized');
  const stmt = db.prepare('SELECT * FROM epics WHERE id = :id');
  const row = stmt.getAsObject({ ':id': id });
  stmt.free();
  return row.id ? normalizeEpic(row) : null;
}

function createEpic({ projectId, title, description, status = 'open', color, createdBy } = {}) {
  if (!db) throw new Error('DB not initialized');
  if (!projectId) throw new Error('createEpic: projectId is required');
  if (!title) throw new Error('createEpic: title is required');
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.run(
    'INSERT INTO epics (id, project_id, title, description, status, color, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, projectId, title, description || null, status, color || null, createdBy != null ? Number(createdBy) : null, now, now]
  );
  persist();
  return getEpic(id);
}

function updateEpic(id, patch) {
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
  persist();
  return getEpic(id);
}

function deleteEpic(id) {
  if (!db) throw new Error('DB not initialized');
  // Detach tasks (set epic_id = NULL) — don't cascade-delete the work.
  db.run('UPDATE tasks SET epic_id = NULL, updated_at = ? WHERE epic_id = ?', [new Date().toISOString(), id]);
  db.run('DELETE FROM epics WHERE id = ?', [id]);
  persist();
}

// ─── Task dependencies (Phase B — directed edges) ───────────────────────────

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

function listDependenciesForTask(taskId) {
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

// Returns true if adding edge blocker→blocked would create a cycle.
// Walk forward from blockedTaskId following its outgoing "blocks" edges
// (tasks that blockedTaskId blocks) — if we reach blockerTaskId, cycle.
function wouldCreateDependencyCycle(blockerTaskId, blockedTaskId) {
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

// List of unmet blockers for a task: blocker tasks (tasks blocking this one)
// whose status is not 'done' or 'cancelled'. Used by dispatch guard + UI.
function getUnmetBlockers(taskId) {
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

// All deps for a project — joins through tasks to filter by project_id.
// ── Project memory (Phase A2) ─────────────────────────────────────────────

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
  if (!db) return null;
  const stmt = db.prepare('SELECT * FROM project_memory WHERE id = ?');
  stmt.bind([id]);
  const row = stmt.step() ? normalizeProjectMemory(stmt.getAsObject()) : null;
  stmt.free();
  return row;
}

function createProjectMemory({ projectId, kind, title, body, status, meta, sourceTaskId, createdBy } = {}) {
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
  persist();
  return getProjectMemory(id);
}

function getTaskSessionKeys() {
  if (!db) return [];
  const stmt = db.prepare('SELECT session_id FROM tasks WHERE session_id IS NOT NULL');
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject().session_id);
  }
  stmt.free();
  return rows;
}

function updateProjectMemory(id, patch = {}) {
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
  persist();
  return getProjectMemory(id);
}

function deleteProjectMemory(id) {
  if (!db) throw new Error('DB not initialized');
  db.run('DELETE FROM project_memory WHERE id = ?', [id]);
  persist();
}

// Build a compact snapshot of memory to inject into the agent dispatch
// context.json. Includes the most relevant items only — open questions,
// open risks, the latest N decisions, and all glossary terms.
function buildProjectMemorySnapshot(projectId, { decisionLimit = 10, glossaryLimit = 50 } = {}) {
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

function listDependenciesForProject(projectId) {
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
    persist();
  } catch (e) {
    if (String(e.message || e).includes('UNIQUE')) {
      // Already exists — return existing edge instead of erroring.
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
  if (!db) throw new Error('DB not initialized');
  db.run('DELETE FROM task_dependencies WHERE id = ?', [id]);
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

// ─── Task Comments (user ↔ agent discussion) ─────────────────────────────────

function addTaskComment({ taskId, authorType, authorId, authorName, body } = {}) {
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
  persist();
  return getTaskComment(id);
}

function getTaskComment(id) {
  if (!db) throw new Error('DB not initialized');
  const stmt = db.prepare('SELECT * FROM task_comments WHERE id = :id');
  const row = stmt.getAsObject({ ':id': id });
  stmt.free();
  return row.id ? normalizeComment(row) : null;
}

function listTaskComments(taskId, { includeDeleted = false } = {}) {
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
  if (!db) throw new Error('DB not initialized');
  if (!body || !body.trim()) throw new Error('updateTaskComment: body is required');
  const now = new Date().toISOString();
  db.run('UPDATE task_comments SET body = ?, edited_at = ? WHERE id = ? AND deleted_at IS NULL', [body, now, id]);
  persist();
  return getTaskComment(id);
}

function deleteTaskComment(id) {
  if (!db) throw new Error('DB not initialized');
  const now = new Date().toISOString();
  db.run('UPDATE task_comments SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL', [now, id]);
  persist();
  return getTaskComment(id);
}

/** Recent undeleted comments for dispatch context. `limit` rows, oldest first. */
function getRecentTaskComments(taskId, limit = 10) {
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

function getPipelineOwner(pipelineId) {
  if (!db) return null;
  const res = db.exec('SELECT created_by FROM pipelines WHERE id = ?', [pipelineId]);
  if (!res.length || !res[0].values.length) return null;
  return res[0].values[0][0];
}

function userOwnsPipeline(req, pipelineId) {
  if (!req?.user) return false;
  if (req.user.role === 'admin' || req.user.role === 'agent') return true;
  const owner = getPipelineOwner(pipelineId);
  return owner != null && owner === req.user.userId;
}

function requirePipelineOwnership(req, res, next) {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: 'pipeline id missing' });
  if (!userOwnsPipeline(req, id)) {
    return res.status(403).json({ error: 'You do not have permission to modify this pipeline' });
  }
  next();
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

// ── Project ownership ──
//
// Rules (mirroring the connections/agents pattern):
//   - admin role  → bypass all checks
//   - agent token → bypass (service tokens used by built-in skills)
//   - 'general' (the default seeded project, owner=null) → treated as shared:
//     any logged-in user may mutate. Keeps backwards compat with pre-ownership
//     installations where every task lived under 'general'.
//   - any other project with owner=null → also treated as shared (legacy rows
//     created before ownership tracking shipped). Once a row has a non-null
//     created_by, only that user (or admin) may mutate.
function getProjectOwner(projectId) {
  if (!db) return null;
  const res = db.exec('SELECT created_by FROM projects WHERE id = ?', [projectId]);
  if (!res.length || !res[0].values.length) return null;
  return res[0].values[0][0]; // may be null for legacy rows
}

function userOwnsProject(req, projectId) {
  if (!req?.user) return false;
  if (req.user.role === 'admin' || req.user.role === 'agent') return true;
  const owner = getProjectOwner(projectId);
  if (owner == null) return true; // shared / legacy project
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

// Variant for routes scoped to a task — looks up the task's projectId then
// applies the project ownership rule. Falls through (200 OK) for legacy tasks
// without a projectId.
function requireProjectOwnershipForTask(req, res, next) {
  const taskId = req.params.id || req.params.taskId;
  if (!taskId) return res.status(400).json({ error: 'task id missing' });
  if (!db) return res.status(500).json({ error: 'DB not initialized' });
  const result = db.exec('SELECT project_id FROM tasks WHERE id = ?', [taskId]);
  if (!result.length || !result[0].values.length) {
    return res.status(404).json({ error: 'task not found' });
  }
  const projectId = result[0].values[0][0];
  if (!projectId) return next(); // legacy task with no project — allow
  if (!userOwnsProject(req, projectId)) {
    return res.status(403).json({ error: 'You do not have permission to modify tasks in this project' });
  }
  next();
}

/**
 * Return a SQL WHERE-fragment + bind values that scope a list query by ownership.
 * Admin sees all by default; non-admins always scoped to their own id regardless
 * of the requested scope.
 *
 * @param {object} user - { id, role } from req.user
 * @param {string} ownerCol - column name, e.g. 'created_by' or 'provisioned_by'
 * @param {'me'|'all'|number|null} scope - parsed from ?owner= query
 * @returns {{where: string, params: any[]}}
 */
function scopeByOwner(user, ownerCol, scope) {
  if (!user) return { where: '1 = 0', params: [] };
  // JWT payload uses `userId`; some legacy code passes `id`. Accept both.
  const uid = user.userId ?? user.id;
  if (user.role === 'admin') {
    if (scope === 'all' || scope == null) return { where: '', params: [] };
    if (scope === 'me') return { where: `${ownerCol} = ?`, params: [uid] };
    if (typeof scope === 'number') return { where: `${ownerCol} = ?`, params: [scope] };
    return { where: '', params: [] };
  }
  return { where: `${ownerCol} = ?`, params: [uid] };
}

// ─── Gateway state ───────────────────────────────────────────────────────────

/**
 * Persist a user's gateway lifecycle data.
 * @param {number} userId
 * @param {{port: number|null, pid: number|null, state: 'running'|'starting'|'error'|'stopped'|null}} data
 */
function setGatewayState(userId, { port, pid, state, token }) {
  if (!db) return;
  // Token is preserved unless explicitly cleared (state==='stopped' OR token===null).
  // Pass `token: undefined` to leave it untouched.
  if (token === undefined) {
    db.run(
      "UPDATE users SET gateway_port = ?, gateway_pid = ?, gateway_state = ? WHERE id = ?",
      [port, pid, state, Number(userId)]
    );
  } else {
    db.run(
      "UPDATE users SET gateway_port = ?, gateway_pid = ?, gateway_state = ?, gateway_token = ? WHERE id = ?",
      [port, pid, state, token, Number(userId)]
    );
  }
}

function getGatewayToken(userId) {
  if (!db) return null;
  const res = db.exec("SELECT gateway_token FROM users WHERE id = ?", [Number(userId)]);
  return res[0]?.values?.[0]?.[0] || null;
}

/**
 * Read a user's gateway state.
 * @param {number} userId
 * @returns {{port: number|null, pid: number|null, state: string|null}}
 */
function getGatewayState(userId) {
  if (!db) return { port: null, pid: null, state: null };
  const res = db.exec(
    "SELECT gateway_port, gateway_pid, gateway_state FROM users WHERE id = ?",
    [Number(userId)]
  );
  const row = res[0]?.values?.[0];
  if (!row) return { port: null, pid: null, state: null };
  return {
    port:  row[0] != null ? Number(row[0]) : null,
    pid:   row[1] != null ? Number(row[1]) : null,
    state: row[2] != null ? String(row[2]) : null,
  };
}

/**
 * List all users with a non-null gateway_pid.
 * Used by orchestrator startup cleanup and admin overview.
 * @returns {Array<{userId: number, port: number|null, pid: number, state: string|null}>}
 */
function listGatewayStates() {
  if (!db) return [];
  const res = db.exec(
    "SELECT id, gateway_port, gateway_pid, gateway_state FROM users WHERE gateway_pid IS NOT NULL"
  );
  return (res[0]?.values || []).map(([id, port, pid, state]) => ({
    userId: Number(id),
    port:  port != null ? Number(port) : null,
    pid:   Number(pid),
    state: state != null ? String(state) : null,
  }));
}

/**
 * Clear gateway state for all users. Used by orchestrator at AOC startup.
 */
function clearAllGatewayStates() {
  if (!db) return;
  db.run("UPDATE users SET gateway_port = NULL, gateway_pid = NULL, gateway_state = NULL");
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

// ─── Pipelines ───────────────────────────────────────────────────────────────

function normalizePipeline(row) {
  if (!row || !row.id) return null;
  let graph = { nodes: [], edges: [] };
  try { graph = row.graph_json ? JSON.parse(row.graph_json) : graph; } catch {}
  return {
    id: row.id,
    name: row.name,
    description: row.description || null,
    graph,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getAllPipelines() {
  if (!db) return [];
  const res = db.exec('SELECT * FROM pipelines ORDER BY updated_at DESC');
  if (!res.length) return [];
  const cols = res[0].columns;
  return res[0].values.map(r => {
    const obj = {}; cols.forEach((c, i) => { obj[c] = r[i]; });
    return normalizePipeline(obj);
  }).filter(Boolean);
}

function getPipeline(id) {
  if (!db) return null;
  const res = db.exec('SELECT * FROM pipelines WHERE id = ?', [id]);
  if (!res.length || !res[0].values.length) return null;
  const cols = res[0].columns;
  const obj = {}; cols.forEach((c, i) => { obj[c] = res[0].values[0][i]; });
  return normalizePipeline(obj);
}

function createPipeline({ id, name, description, graph, createdBy }) {
  if (!db) throw new Error('DB not initialized');
  const now = new Date().toISOString();
  const graphJson = JSON.stringify(graph || { nodes: [], edges: [] });
  db.run(
    `INSERT INTO pipelines (id, name, description, graph_json, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, name, description || null, graphJson, createdBy || null, now, now]
  );
  persist();
  return getPipeline(id);
}

function updatePipeline(id, patch) {
  if (!db) throw new Error('DB not initialized');
  const now = new Date().toISOString();
  const fields = ['updated_at = ?'];
  const vals = [now];
  if (patch.name        !== undefined) { fields.push('name = ?');        vals.push(patch.name); }
  if (patch.description !== undefined) { fields.push('description = ?'); vals.push(patch.description); }
  if (patch.graph       !== undefined) { fields.push('graph_json = ?');  vals.push(JSON.stringify(patch.graph)); }
  vals.push(id);
  db.run(`UPDATE pipelines SET ${fields.join(', ')} WHERE id = ?`, vals);
  persist();
  return getPipeline(id);
}

function deletePipeline(id) {
  if (!db) throw new Error('DB not initialized');
  // Cascades via FK to steps/artifacts; manually nuke runs first for safety.
  db.run('DELETE FROM pipeline_artifacts WHERE run_id IN (SELECT id FROM pipeline_runs WHERE pipeline_id = ?)', [id]);
  db.run('DELETE FROM pipeline_steps     WHERE run_id IN (SELECT id FROM pipeline_runs WHERE pipeline_id = ?)', [id]);
  db.run('DELETE FROM pipeline_runs      WHERE pipeline_id = ?', [id]);
  db.run('DELETE FROM pipelines          WHERE id = ?', [id]);
  persist();
}

function listPipelinesForUser(req) {
  const all = getAllPipelines();
  if (!req?.user) return [];
  if (req.user.role === 'admin' || req.user.role === 'agent') return all;
  return all.filter(p => p.createdBy == null || p.createdBy === req.user.userId);
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
// Raw DB accessor — for modules that need to run ad-hoc queries.
function getRawDb() { return db; }

module.exports = {
  getRawDb,
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
  requirePipelineOwnership,
  userOwnsAgent,
  userOwnsConnection,
  userOwnsPipeline,
  getAgentOwner,
  getConnectionOwner,
  getPipelineOwner,
  deleteUser,
  purgeUserData,
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
  addTaskActivity, getTaskActivity, getTaskSessionKeys,
  addTaskComment, getTaskComment, listTaskComments, updateTaskComment, deleteTaskComment, getRecentTaskComments,
  // Epics + dependencies (Phase B)
  listEpics, getEpic, createEpic, updateEpic, deleteEpic,
  listDependenciesForTask, listDependenciesForProject, addTaskDependency, removeTaskDependency,
  getUnmetBlockers, wouldCreateDependencyCycle,
  // Project memory (Phase A2)
  listProjectMemory, getProjectMemory, createProjectMemory, updateProjectMemory, deleteProjectMemory,
  buildProjectMemorySnapshot,
  PROJECT_MEMORY_KINDS, PROJECT_MEMORY_STATUSES,
  // Projects
  getAllProjects, getProject, getProjectByPath, createProject, updateProject, deleteProject,
  setProjectWorkspace, bumpProjectFetchedAt,
  getProjectOwner, userOwnsProject, requireProjectOwnership, requireProjectOwnershipForTask,
  scopeByOwner,
  // Mission rooms
  normalizeMissionRoom, normalizeMissionMessage,
  listMissionRooms, listMissionRoomsForUser, getMissionRoom, createMissionRoom, updateMissionRoomMembers,
  getProjectDefaultRoom, ensureProjectDefaultRoom, backfillProjectDefaultRooms,
  listMissionMessages, createMissionMessage,
  // Room sessions (room ↔ gateway session tracking)
  markSessionAsRoomTriggered, getRoomSessionKeys, getRoomAgentSession, getRoomForSession,
  // Integrations
  getAllIntegrations, getProjectIntegrations, getIntegrationRaw,
  createIntegration, updateIntegration, deleteIntegration, updateIntegrationSyncState,
  // Connections
  getAllConnections, getConnection, getConnectionRaw, getEnabledConnectionsRaw,
  createConnection, updateConnection, deleteConnection,
  // Agent ↔ Connection assignments
  getAgentConnectionIds, getConnectionAgentIds, setAgentConnections,
  getAgentConnectionsRaw, getAllAgentConnectionAssignments,
  // Pipelines
  getAllPipelines, getPipeline, createPipeline, updatePipeline, deletePipeline,
  listPipelinesForUser,
  // Gateway state
  setGatewayState, getGatewayState, getGatewayToken, listGatewayStates, clearAllGatewayStates,
};
