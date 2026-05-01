'use strict';
/**
 * role-templates.cjs
 * Phase 1: read-only + seeding.
 *
 * ADLC role templates are stored in SQLite `role_templates` table.
 * On first run, 8 built-in templates are seeded from
 *   server/data/role-templates-seed.json
 * (pre-generated from src/data/role-templates/*.ts via esbuild).
 *
 * Future phases will add CRUD, forking, and agent assignment diff flow.
 */

const fs   = require('fs');
const path = require('path');
const db   = require('./db.cjs');
const { OPENCLAW_HOME, OPENCLAW_WORKSPACE } = require('./config.cjs');

const SEED_PATH = path.join(__dirname, '..', 'data', 'role-templates-seed.json');

// ─── Row <-> JS shape helpers ────────────────────────────────────────────────

function safeJson(str, fallback) {
  try { return str ? JSON.parse(str) : fallback; } catch { return fallback; }
}

/**
 * Convert a raw SQLite row (snake_case + JSON-encoded fields) into the
 * camelCase AgentRoleTemplate shape the frontend expects.
 */
function rowToTemplate(row) {
  if (!row) return null;
  return {
    id:                 row.id,
    adlcAgentNumber:    row.adlc_number,
    role:               row.role,
    emoji:              row.emoji || null,
    color:              row.color || null,
    description:        row.description || '',
    modelRecommendation: row.model || null,
    tags:               safeJson(row.tags, []),
    agentFiles:         safeJson(row.agent_files, {}),
    skillSlugs:         safeJson(row.skill_refs, []),
    skillContents:      safeJson(row.skill_contents, {}),
    scriptTemplates:    safeJson(row.script_refs, []),
    fsWorkspaceOnly:    !!row.fs_workspace_only,
    origin:             row.origin || 'user',
    builtIn:            !!row.built_in,
    createdAt:          row.created_at,
    updatedAt:          row.updated_at,
  };
}

/**
 * Normalize a raw seed template (camelCase from TS source) to a SQLite-ready
 * parameter array matching the INSERT column order below.
 */
function templateToParams(t, { origin = 'user', builtIn = false } = {}) {
  return [
    t.id,
    t.adlcAgentNumber ?? null,
    t.role,
    t.emoji ?? null,
    t.color ?? null,
    t.description ?? '',
    t.modelRecommendation ?? null,
    JSON.stringify(t.tags ?? []),
    JSON.stringify(t.agentFiles ?? {}),
    JSON.stringify(t.skillSlugs ?? []),
    JSON.stringify(t.skillContents ?? {}),
    JSON.stringify(t.scriptTemplates ?? []),
    t.fsWorkspaceOnly ? 1 : 0,
    origin,
    builtIn ? 1 : 0,
  ];
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Return all templates, ordered by adlc_number (builtin first), then created_at.
 */
function listTemplates() {
  const d = db.getDb();
  if (!d) throw new Error('Database not initialized');
  const res = d.exec(`
    SELECT id, adlc_number, role, emoji, color, description, model, tags,
           agent_files, skill_refs, skill_contents, script_refs,
           fs_workspace_only, origin, built_in, created_at, updated_at
    FROM role_templates
    ORDER BY
      CASE WHEN adlc_number IS NULL THEN 1 ELSE 0 END,
      adlc_number ASC,
      created_at ASC
  `);
  if (!res.length) return [];
  const cols = res[0].columns;
  return res[0].values.map(row => {
    const obj = {};
    cols.forEach((c, i) => { obj[c] = row[i]; });
    return rowToTemplate(obj);
  });
}

function getTemplate(id) {
  const d = db.getDb();
  if (!d) throw new Error('Database not initialized');
  const stmt = d.prepare(`
    SELECT id, adlc_number, role, emoji, color, description, model, tags,
           agent_files, skill_refs, skill_contents, script_refs,
           fs_workspace_only, origin, built_in, created_at, updated_at
    FROM role_templates WHERE id = ?
  `);
  stmt.bind([id]);
  const found = stmt.step();
  const row = found ? stmt.getAsObject() : null;
  stmt.free();
  if (!row) return null;
  const template = rowToTemplate(row);
  template.skillResolution = resolveSkillRefs(template);
  return template;
}

// ─── Skill ref resolution ────────────────────────────────────────────────────

/**
 * Directories to search for an installed SKILL.md, in priority order.
 * Matches the resolution order used by the agent runtime.
 */
function skillSearchDirs() {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return [
    path.join(OPENCLAW_HOME, 'skills'),
    path.join(home, '.agents', 'skills'),
    path.join(OPENCLAW_WORKSPACE || '', 'skills'),
    path.join(OPENCLAW_WORKSPACE || '', '.agents', 'skills'),
  ].filter(Boolean);
}

function findInstalledSkill(slug) {
  for (const dir of skillSearchDirs()) {
    const skillMd = path.join(dir, slug, 'SKILL.md');
    if (fs.existsSync(skillMd)) {
      try {
        const content = fs.readFileSync(skillMd, 'utf-8');
        return { path: path.join(dir, slug), content };
      } catch { /* unreadable */ }
    }
  }
  return null;
}

/**
 * For each skill slug in a template, determine where its content should come
 * from. Priority:
 *   1. `bundled` — the template embeds SKILL.md content directly
 *   2. `installed` — template is a bare ref, but the skill exists on disk
 *   3. `missing` — neither; UI should show a warning
 *
 * Returns { [slug]: { status, content, path? } }
 */
function resolveSkillRefs(template) {
  const out = {};
  for (const slug of template.skillSlugs || []) {
    const bundled = (template.skillContents || {})[slug];
    if (bundled && bundled.trim().length > 0) {
      out[slug] = { status: 'bundled', content: bundled, path: null };
      continue;
    }
    const installed = findInstalledSkill(slug);
    if (installed) {
      out[slug] = { status: 'installed', content: installed.content, path: installed.path };
      continue;
    }
    out[slug] = { status: 'missing', content: null, path: null };
  }
  return out;
}

function countTemplates() {
  const d = db.getDb();
  if (!d) return 0;
  const res = d.exec('SELECT COUNT(*) AS n FROM role_templates');
  if (!res.length) return 0;
  return res[0].values[0][0] || 0;
}

// ─── Seeding ──────────────────────────────────────────────────────────────────

function loadSeed() {
  if (!fs.existsSync(SEED_PATH)) {
    console.warn('[role-templates] Seed file missing:', SEED_PATH);
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(SEED_PATH, 'utf-8'));
  } catch (err) {
    console.error('[role-templates] Failed to read seed:', err.message);
    return [];
  }
}

/**
 * Seed built-in templates if the table is empty. Idempotent — safe to call
 * on every startup.
 *
 * NOTE: this does NOT overwrite existing rows. Later phases will add an
 * explicit "reset to factory" action for built-in IDs.
 */
function seedIfEmpty() {
  const d = db.getDb();
  if (!d) throw new Error('Database not initialized');

  if (countTemplates() > 0) return { seeded: 0, skipped: true };

  const seeds = loadSeed();
  if (!seeds.length) return { seeded: 0, skipped: false };

  const stmt = d.prepare(`
    INSERT OR IGNORE INTO role_templates (
      id, adlc_number, role, emoji, color, description, model, tags,
      agent_files, skill_refs, skill_contents, script_refs,
      fs_workspace_only, origin, built_in
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let count = 0;
  for (const t of seeds) {
    try {
      stmt.run(templateToParams(t, { origin: 'builtin', builtIn: true }));
      count++;
    } catch (err) {
      console.error('[role-templates] Seed insert failed for', t.id, '—', err.message);
    }
  }
  stmt.free();
  db.persist();
  console.log(`[role-templates] Seeded ${count} built-in template${count === 1 ? '' : 's'}`);
  return { seeded: count, skipped: false };
}

/**
 * Force-refresh the built-in templates from the seed JSON, OVERWRITING any
 * existing rows whose id matches. Origin/builtIn flags are preserved as
 * 'builtin'/true. User-authored templates are untouched.
 *
 * Used for: rolling out new built-in skills/scripts after a code update
 * without having to wipe the DB.
 */
function refreshBuiltInsFromSeed() {
  const d = db.getDb();
  if (!d) throw new Error('Database not initialized');

  const seeds = loadSeed();
  if (!seeds.length) return { refreshed: 0, skipped: 'no seed entries' };

  const stmt = d.prepare(`
    INSERT OR REPLACE INTO role_templates (
      id, adlc_number, role, emoji, color, description, model, tags,
      agent_files, skill_refs, skill_contents, script_refs,
      fs_workspace_only, origin, built_in
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let count = 0;
  const ids = [];
  for (const t of seeds) {
    try {
      stmt.run(templateToParams(t, { origin: 'builtin', builtIn: true }));
      count++;
      ids.push(t.id);
    } catch (err) {
      console.error('[role-templates] Refresh failed for', t.id, '—', err.message);
    }
  }
  stmt.free();
  db.persist();
  console.log(`[role-templates] Refreshed ${count} built-in template${count === 1 ? '' : 's'}: ${ids.join(', ')}`);
  return { refreshed: count, ids };
}

// ─── Validation ──────────────────────────────────────────────────────────────

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

/**
 * Minimal schema check. Returns an array of error messages (empty = valid).
 * Fields not listed are preserved as-is (forward-compat).
 */
function validateTemplate(t, { isCreate = false } = {}) {
  const errs = [];
  if (isCreate) {
    if (typeof t.id !== 'string' || !ID_PATTERN.test(t.id)) {
      errs.push('id must be lowercase letters, digits, or hyphens (2-64 chars, starts alphanumeric)');
    }
  }
  if (t.role !== undefined && (typeof t.role !== 'string' || !t.role.trim())) {
    errs.push('role is required');
  }
  if (t.adlcAgentNumber !== undefined && t.adlcAgentNumber !== null) {
    if (!Number.isInteger(t.adlcAgentNumber) || t.adlcAgentNumber < 1 || t.adlcAgentNumber > 99) {
      errs.push('adlcAgentNumber must be an integer 1-99');
    }
  }
  if (t.color !== undefined && t.color !== null) {
    if (typeof t.color !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(t.color)) {
      errs.push('color must be a hex string like #6366f1');
    }
  }
  if (t.tags !== undefined && !Array.isArray(t.tags)) {
    errs.push('tags must be an array of strings');
  }
  if (t.skillSlugs !== undefined && !Array.isArray(t.skillSlugs)) {
    errs.push('skillSlugs must be an array of strings');
  }
  if (t.scriptTemplates !== undefined && !Array.isArray(t.scriptTemplates)) {
    errs.push('scriptTemplates must be an array');
  }
  if (t.agentFiles !== undefined && (typeof t.agentFiles !== 'object' || t.agentFiles === null)) {
    errs.push('agentFiles must be an object');
  }
  return errs;
}

// ─── Usage check ─────────────────────────────────────────────────────────────

/**
 * Return list of agent IDs that reference this template via agent_profiles.role.
 * Used to guard delete/rename.
 */
function listTemplateUsage(id) {
  const d = db.getDb();
  if (!d) return [];
  const res = d.exec('SELECT agent_id FROM agent_profiles WHERE role = ?', [id]);
  if (!res.length) return [];
  return res[0].values.map(row => row[0]);
}

// ─── Mutations ───────────────────────────────────────────────────────────────

/**
 * Create a new user template. `id` must be unique.
 * origin defaults to 'user'; built_in is always 0 via this path.
 */
function createTemplate(data) {
  const d = db.getDb();
  if (!d) throw new Error('Database not initialized');

  const errs = validateTemplate(data, { isCreate: true });
  if (errs.length) {
    const e = new Error(errs[0]); e.code = 'VALIDATION'; e.details = errs; throw e;
  }
  if (!data.role) {
    const e = new Error('role is required'); e.code = 'VALIDATION'; throw e;
  }

  // Guard against existing id
  if (getTemplate(data.id)) {
    const e = new Error(`Template "${data.id}" already exists`); e.code = 'CONFLICT'; throw e;
  }

  const stmt = d.prepare(`
    INSERT INTO role_templates (
      id, adlc_number, role, emoji, color, description, model, tags,
      agent_files, skill_refs, skill_contents, script_refs,
      fs_workspace_only, origin, built_in
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(templateToParams(data, { origin: data.origin || 'user', builtIn: false }));
  stmt.free();
  db.persist();
  return getTemplate(data.id);
}

/**
 * Patch a user template. Built-in templates are NOT editable here — caller
 * must fork them first.
 *
 * Allowed fields: role, emoji, color, description, modelRecommendation,
 * adlcAgentNumber, tags, agentFiles, skillSlugs, skillContents, scriptTemplates,
 * fsWorkspaceOnly.
 */
function updateTemplate(id, patch) {
  const d = db.getDb();
  if (!d) throw new Error('Database not initialized');

  const existing = getTemplate(id);
  if (!existing) {
    const e = new Error(`Template "${id}" not found`); e.code = 'NOT_FOUND'; throw e;
  }
  if (existing.builtIn) {
    const e = new Error('Built-in templates are read-only — fork first to customize');
    e.code = 'READ_ONLY'; throw e;
  }

  const errs = validateTemplate(patch, { isCreate: false });
  if (errs.length) {
    const e = new Error(errs[0]); e.code = 'VALIDATION'; e.details = errs; throw e;
  }

  // Build the merged record so we can use the same INSERT shape via UPDATE.
  const merged = { ...existing };
  for (const key of [
    'role', 'emoji', 'color', 'description', 'modelRecommendation',
    'adlcAgentNumber', 'tags', 'agentFiles', 'skillSlugs', 'skillContents',
    'scriptTemplates', 'fsWorkspaceOnly',
  ]) {
    if (patch[key] !== undefined) merged[key] = patch[key];
  }

  const stmt = d.prepare(`
    UPDATE role_templates SET
      adlc_number = ?, role = ?, emoji = ?, color = ?, description = ?,
      model = ?, tags = ?, agent_files = ?, skill_refs = ?, skill_contents = ?,
      script_refs = ?, fs_workspace_only = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `);
  stmt.run([
    merged.adlcAgentNumber ?? null,
    merged.role,
    merged.emoji ?? null,
    merged.color ?? null,
    merged.description ?? '',
    merged.modelRecommendation ?? null,
    JSON.stringify(merged.tags ?? []),
    JSON.stringify(merged.agentFiles ?? {}),
    JSON.stringify(merged.skillSlugs ?? []),
    JSON.stringify(merged.skillContents ?? {}),
    JSON.stringify(merged.scriptTemplates ?? []),
    merged.fsWorkspaceOnly ? 1 : 0,
    id,
  ]);
  stmt.free();
  db.persist();
  return getTemplate(id);
}

/**
 * Delete a user template. Built-ins cannot be deleted. Throws if any agents
 * reference this template via `role` unless { force: true } is passed.
 */
function deleteTemplate(id, { force = false } = {}) {
  const d = db.getDb();
  if (!d) throw new Error('Database not initialized');

  const existing = getTemplate(id);
  if (!existing) {
    const e = new Error(`Template "${id}" not found`); e.code = 'NOT_FOUND'; throw e;
  }
  if (existing.builtIn) {
    const e = new Error('Built-in templates cannot be deleted'); e.code = 'READ_ONLY'; throw e;
  }

  const usage = listTemplateUsage(id);
  if (usage.length > 0 && !force) {
    const e = new Error(`Template is in use by ${usage.length} agent(s): ${usage.join(', ')}`);
    e.code = 'IN_USE'; e.usage = usage; throw e;
  }

  const stmt = d.prepare('DELETE FROM role_templates WHERE id = ?');
  stmt.run([id]);
  stmt.free();

  // When forced, also clear `role` from any referencing agents so they
  // don't point at a non-existent template.
  if (force && usage.length > 0) {
    const upd = d.prepare('UPDATE agent_profiles SET role = NULL WHERE role = ?');
    upd.run([id]);
    upd.free();
  }

  db.persist();
  return { ok: true, id, cleared: force ? usage : [] };
}

/**
 * Copy an existing template (built-in or custom) to a new custom record.
 * If no newId is given, a timestamp-suffixed id is generated.
 * Origin is set to 'forked:{sourceId}'.
 */
function forkTemplate(sourceId, newId, overrides = {}) {
  const src = getTemplate(sourceId);
  if (!src) {
    const e = new Error(`Template "${sourceId}" not found`); e.code = 'NOT_FOUND'; throw e;
  }

  let id = newId;
  if (!id) {
    const suffix = Date.now().toString(36);
    id = `${sourceId}-${suffix}`.slice(0, 64);
  }
  if (!ID_PATTERN.test(id)) {
    const e = new Error('new id must be lowercase letters/digits/hyphens');
    e.code = 'VALIDATION'; throw e;
  }
  if (getTemplate(id)) {
    const e = new Error(`Template "${id}" already exists`); e.code = 'CONFLICT'; throw e;
  }

  const copy = {
    id,
    adlcAgentNumber:     overrides.adlcAgentNumber ?? null, // forks don't inherit ADLC number
    role:                overrides.role ?? src.role,
    emoji:               overrides.emoji ?? src.emoji,
    color:               overrides.color ?? src.color,
    description:         overrides.description ?? src.description,
    modelRecommendation: overrides.modelRecommendation ?? src.modelRecommendation,
    tags:                overrides.tags ?? src.tags,
    agentFiles:          overrides.agentFiles ?? src.agentFiles,
    skillSlugs:          overrides.skillSlugs ?? src.skillSlugs,
    skillContents:       overrides.skillContents ?? src.skillContents,
    scriptTemplates:     overrides.scriptTemplates ?? src.scriptTemplates,
    fsWorkspaceOnly:     overrides.fsWorkspaceOnly ?? src.fsWorkspaceOnly,
  };

  const d = db.getDb();
  const stmt = d.prepare(`
    INSERT INTO role_templates (
      id, adlc_number, role, emoji, color, description, model, tags,
      agent_files, skill_refs, skill_contents, script_refs,
      fs_workspace_only, origin, built_in
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(templateToParams(copy, { origin: `forked:${sourceId}`, builtIn: false }));
  stmt.free();
  db.persist();
  return getTemplate(id);
}

// ─── Apply template to existing agent (Phase 5) ──────────────────────────────

const { readJsonSafe } = require('./config.cjs');
const { saveVersion } = require('./versioning.cjs');

const OPENCLAW_JSON = path.join(OPENCLAW_HOME, 'openclaw.json');

/** Filesystem filename for a given agent-file key. */
function agentFileName(key) {
  return {
    identity: 'IDENTITY.md',
    soul:     'SOUL.md',
    tools:    'TOOLS.md',
    agents:   'AGENTS.md',
  }[key] || null;
}

function expandHome(p) {
  const home = process.env.HOME || process.env.USERPROFILE || '~';
  return (p || '').replace(/^~/, home);
}

/** Load an agent entry from openclaw.json. Throws if not found. */
function loadAgentEntry(agentId) {
  const config = readJsonSafe(OPENCLAW_JSON) || {};
  const list = config.agents?.list || [];
  const idx = list.findIndex(a => a.id === agentId);
  if (idx === -1) {
    const e = new Error(`Agent "${agentId}" not found`); e.code = 'NOT_FOUND'; throw e;
  }
  const agent = list[idx];
  const workspace = expandHome(agent.workspace || OPENCLAW_WORKSPACE);
  return { config, agent, agentIndex: idx, workspace };
}

/**
 * Preview what will change when applying a template to an existing agent.
 * Returns per-file action, skills categorization, scripts categorization.
 * Does NOT write anything.
 */
function previewApply(templateId, agentId) {
  const template = getTemplate(templateId);
  if (!template) {
    const e = new Error(`Template "${templateId}" not found`); e.code = 'NOT_FOUND'; throw e;
  }
  const { agent, workspace } = loadAgentEntry(agentId);

  // Agent files
  const filesPlan = {};
  for (const key of ['identity', 'soul', 'tools', 'agents']) {
    const filename = agentFileName(key);
    const diskPath = path.join(workspace, filename);
    const exists = fs.existsSync(diskPath);
    const current = exists ? fs.readFileSync(diskPath, 'utf-8') : null;
    const tpl = template.agentFiles[key] || null;

    let action;
    if (!tpl && !exists)      action = 'noop';           // neither — nothing to do
    else if (!tpl && exists)  action = 'keep';           // template has no content → keep current
    else if (tpl && !exists)  action = 'create';         // template adds new file
    else if (current === tpl) action = 'same';           // identical, no-op
    else                      action = 'overwrite';      // different — will overwrite current

    filesPlan[key] = {
      filename,
      exists,
      currentSize:    current?.length ?? 0,
      currentLines:   current ? current.split('\n').length : 0,
      templateSize:   tpl?.length ?? 0,
      templateLines:  tpl ? tpl.split('\n').length : 0,
      action,
      current,
      template: tpl,
    };
  }

  // Skills
  const resolution = template.skillResolution || {};
  const agentSkills = Array.isArray(agent.skills) ? agent.skills : [];
  const skillsPlan = { existing: [], toAdd: [], toInstall: [], missing: [] };
  for (const slug of template.skillSlugs) {
    const res = resolution[slug] || { status: 'missing' };
    const inAllowlist = agentSkills.includes(slug);
    if (res.status === 'installed') {
      (inAllowlist ? skillsPlan.existing : skillsPlan.toAdd).push(slug);
    } else if (res.status === 'bundled') {
      skillsPlan.toInstall.push(slug);
    } else {
      skillsPlan.missing.push(slug);
    }
  }

  // Scripts
  const scriptsDir = path.join(workspace, 'scripts');
  const scriptsPlan = { same: [], toInstall: [], conflicting: [] };
  for (const s of template.scriptTemplates) {
    const sp = path.join(scriptsDir, s.filename);
    if (fs.existsSync(sp)) {
      try {
        const cur = fs.readFileSync(sp, 'utf-8');
        (cur === s.content ? scriptsPlan.same : scriptsPlan.conflicting).push(s.filename);
      } catch { scriptsPlan.conflicting.push(s.filename); }
    } else {
      scriptsPlan.toInstall.push(s.filename);
    }
  }

  return {
    agent: {
      id: agent.id,
      name: agent.identity?.name || agent.name || agent.id,
      workspace,
    },
    template: {
      id: template.id,
      role: template.role,
      emoji: template.emoji,
      color: template.color,
    },
    files: filesPlan,
    skills: skillsPlan,
    scripts: scriptsPlan,
  };
}

/**
 * Apply a template to an existing agent. Atomic-ish:
 *   - Snapshot current file content to versioning before overwrite
 *   - Write selected agent files
 *   - Re-inject SOUL research-standard block if soul was touched
 *   - Install bundled skills (idempotent)
 *   - Add resolved skill refs to agent's allowlist in openclaw.json
 *   - Install/overwrite scripts per options
 *   - Update agent_profiles.role
 *
 * opts:
 *   overwriteFiles: Array<'identity'|'soul'|'tools'|'agents'>
 *   installSkills:  boolean (default true) — install bundled + add to allowlist
 *   installScripts: boolean (default true)
 *   overwriteConflictingScripts: boolean (default false)
 *   savedBy: string | null — version history author tag
 */
function applyToAgent(templateId, agentId, opts = {}) {
  const template = getTemplate(templateId);
  if (!template) {
    const e = new Error(`Template "${templateId}" not found`); e.code = 'NOT_FOUND'; throw e;
  }
  const { config, agent, agentIndex, workspace } = loadAgentEntry(agentId);
  const d = db.getDb();
  if (!d) throw new Error('Database not initialized');

  const overwriteFiles = Array.isArray(opts.overwriteFiles) ? opts.overwriteFiles : [];
  const installSkills  = opts.installSkills  !== false;
  const installScripts = opts.installScripts !== false;
  const overwriteConflictingScripts = !!opts.overwriteConflictingScripts;
  const savedBy        = opts.savedBy || 'role-template-apply';
  const versionLabel   = `Applied role template "${templateId}"`;

  const applied = {
    files: [],
    skillsInstalledGlobal: [],
    skillsAddedToAllowlist: [],
    scriptsWritten: [],
    scriptsSkipped: [],
  };

  // Ensure workspace exists
  fs.mkdirSync(workspace, { recursive: true });

  // 1. Write agent files (snapshot first)
  for (const key of overwriteFiles) {
    const tpl = template.agentFiles[key];
    if (!tpl) continue;
    const filename = agentFileName(key);
    if (!filename) continue;
    const diskPath = path.join(workspace, filename);
    if (fs.existsSync(diskPath)) {
      try {
        const current = fs.readFileSync(diskPath, 'utf-8');
        saveVersion(d, {
          scopeKey: `agent:${agentId}:${filename}`,
          content:  current,
          savedBy,
          op:       'edit',
          label:    versionLabel,
          persist:  db.persist,
        });
      } catch (e) {
        console.warn(`[role-template:apply] Failed to snapshot ${filename}:`, e.message);
      }
    }
    fs.writeFileSync(diskPath, tpl, 'utf-8');
    applied.files.push(filename);
  }

  // 1b. Re-inject SOUL research standard block if soul was written
  if (overwriteFiles.includes('soul')) {
    try {
      const { injectSoulStandard } = require('./agents/files.cjs');
      injectSoulStandard(agentId);
    } catch (e) {
      console.warn('[role-template:apply] injectSoulStandard failed:', e.message);
    }
  }

  // 2. Install bundled skills to global dir + add to agent allowlist
  if (installSkills && template.skillSlugs.length > 0) {
    const globalSkillsDir = path.join(OPENCLAW_HOME, 'skills');
    fs.mkdirSync(globalSkillsDir, { recursive: true });

    const agentEntry = config.agents.list[agentIndex];
    agentEntry.skills = Array.isArray(agentEntry.skills) ? agentEntry.skills : [];

    for (const slug of template.skillSlugs) {
      const res = (template.skillResolution || {})[slug] || { status: 'missing' };
      const skillDir = path.join(globalSkillsDir, slug);

      // Install if bundled and not present
      if (res.status === 'bundled' && !fs.existsSync(skillDir)) {
        fs.mkdirSync(skillDir, { recursive: true });
        fs.writeFileSync(
          path.join(skillDir, 'SKILL.md'),
          template.skillContents[slug],
          'utf-8',
        );
        applied.skillsInstalledGlobal.push(slug);
      }

      // Add to allowlist unless already present OR still missing
      if (res.status !== 'missing' && !agentEntry.skills.includes(slug)) {
        agentEntry.skills.push(slug);
        applied.skillsAddedToAllowlist.push(slug);
      }
    }

    // Persist openclaw.json
    fs.writeFileSync(OPENCLAW_JSON, JSON.stringify(config, null, 2), 'utf-8');
  }

  // 3. Install scripts to agent workspace
  if (installScripts && template.scriptTemplates.length > 0) {
    const scriptsDir = path.join(workspace, 'scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });
    const metaPath = path.join(scriptsDir, '.tools.json');
    const meta = readJsonSafe(metaPath) || {};

    for (const { filename, content } of template.scriptTemplates) {
      const scriptPath = path.join(scriptsDir, filename);
      const exists = fs.existsSync(scriptPath);
      let currentContent = null;
      if (exists) {
        try { currentContent = fs.readFileSync(scriptPath, 'utf-8'); } catch {}
      }

      if (exists && currentContent === content) {
        applied.scriptsSkipped.push(filename);
        continue;
      }
      if (exists && !overwriteConflictingScripts) {
        applied.scriptsSkipped.push(filename);
        continue;
      }

      if (exists && currentContent != null) {
        saveVersion(d, {
          scopeKey: `script:agent:${agentId}:${filename}`,
          content:  currentContent,
          savedBy,
          op:       'edit',
          label:    versionLabel,
          persist:  db.persist,
        });
      }

      fs.writeFileSync(scriptPath, content, 'utf-8');
      const ext = path.extname(filename).toLowerCase();
      if (['.sh', '.bash', '.zsh', '.fish'].includes(ext)) {
        try { fs.chmodSync(scriptPath, 0o755); } catch {}
      }

      const baseName = path.basename(filename, ext);
      if (!meta[filename]) meta[filename] = { name: baseName, description: '' };
      applied.scriptsWritten.push(filename);
    }

    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
  }

  // 4. Update agent_profiles.role (upsert)
  try {
    db.upsertAgentProfile({ agentId, role: templateId });
  } catch (e) {
    console.warn('[role-template:apply] upsertAgentProfile failed:', e.message);
  }

  db.persist();
  return { ok: true, agentId, templateId, applied };
}

/**
 * Clear an agent's role assignment. Does not touch files.
 */
function unassignRole(agentId) {
  const d = db.getDb();
  if (!d) throw new Error('Database not initialized');
  const existing = d.exec('SELECT agent_id FROM agent_profiles WHERE agent_id = ?', [agentId]);
  if (!existing.length || !existing[0].values.length) {
    const e = new Error(`Agent "${agentId}" has no profile`); e.code = 'NOT_FOUND'; throw e;
  }
  d.run('UPDATE agent_profiles SET role = NULL, updated_at = datetime(\'now\') WHERE agent_id = ?', [agentId]);
  db.persist();
  return { ok: true, agentId };
}

module.exports = {
  listTemplates,
  getTemplate,
  countTemplates,
  seedIfEmpty,
  refreshBuiltInsFromSeed,
  listTemplateUsage,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  forkTemplate,
  previewApply,
  applyToAgent,
  unassignRole,
};
