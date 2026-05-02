'use strict';
/**
 * skill-catalog.cjs
 * AOC Internal Skill Marketplace.
 *
 * Acts as a 3rd source alongside ClawHub and SkillsMP. Skills here are first-
 * party AOC ADLC skills. On first run, seeded from
 *   server/data/skill-catalog-seed.json
 *
 * Origin semantics (mirrors role-templates):
 *   'seed' — shipped by AOC. Editable but not deletable.
 *   'user' — created by a user. Full CRUD by owner / admin.
 *
 * "Install" writes the SKILL.md (+ scripts) to ~/.openclaw/skills/{slug}/ so
 * the OpenClaw runtime can resolve them.
 */

const fs   = require('fs');
const path = require('path');
const db   = require('./db.cjs');
const { OPENCLAW_HOME } = require('./config.cjs');

const SEED_PATH = path.join(__dirname, '..', 'data', 'skill-catalog-seed.json');
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeJson(str, fallback) {
  try { return str ? JSON.parse(str) : fallback; } catch { return fallback; }
}

function rowToSkill(row) {
  if (!row) return null;
  return {
    slug:            row.slug,
    name:            row.name,
    description:     row.description || '',
    category:        row.category || null,
    adlcRoles:       safeJson(row.adlc_roles, []),
    risksAddressed:  safeJson(row.risks_addressed, []),
    envScope:        row.env_scope || 'agnostic',
    requires:        safeJson(row.requires, []),
    tags:            safeJson(row.tags, []),
    content:         row.content || '',
    scripts:         safeJson(row.scripts_json, []),
    bundleFiles:     safeJson(row.bundle_files_json, []),
    version:         row.version || '1.0.0',
    origin:          row.origin || 'user',
    maturity:        row.maturity || 'stub',
    createdBy:       row.created_by || null,
    createdAt:       row.created_at,
    updatedAt:       row.updated_at,
  };
}

function skillToParams(s, { origin, createdBy = null } = {}) {
  return [
    s.slug,
    s.name,
    s.description ?? '',
    s.category ?? null,
    JSON.stringify(s.adlcRoles ?? []),
    JSON.stringify(s.risksAddressed ?? []),
    s.envScope ?? 'agnostic',
    JSON.stringify(s.requires ?? []),
    JSON.stringify(s.tags ?? []),
    s.content ?? '',
    JSON.stringify(s.scripts ?? []),
    s.version ?? '1.0.0',
    origin,
    s.maturity ?? 'stub',
    createdBy,
    JSON.stringify(s.bundleFiles ?? []),
  ];
}

// ─── Queries ─────────────────────────────────────────────────────────────────

function listSkills(filters = {}) {
  const d = db.getDb();
  if (!d) throw new Error('Database not initialized');

  const wheres = [];
  const params = [];
  if (filters.envScope) {
    wheres.push('env_scope = ?');
    params.push(filters.envScope);
  }
  if (filters.role) {
    // adlc_roles is JSON array — naive contains check via LIKE
    wheres.push("adlc_roles LIKE ?");
    params.push(`%"${filters.role}"%`);
  }
  if (filters.risk) {
    wheres.push("risks_addressed LIKE ?");
    params.push(`%"${filters.risk}"%`);
  }
  if (filters.search) {
    wheres.push('(slug LIKE ? OR name LIKE ? OR description LIKE ? OR tags LIKE ?)');
    const q = `%${filters.search}%`;
    params.push(q, q, q, q);
  }
  const whereSql = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';

  const sql = `
    SELECT slug, name, description, category, adlc_roles, risks_addressed,
           env_scope, requires, tags, content, scripts_json, version, origin,
           maturity, created_by, created_at, updated_at, bundle_files_json
    FROM skill_catalog
    ${whereSql}
    ORDER BY
      CASE WHEN origin = 'seed' THEN 0 ELSE 1 END,
      slug ASC
  `;
  const stmt = d.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows.map(rowToSkill);
}

function getSkill(slug) {
  const d = db.getDb();
  if (!d) throw new Error('Database not initialized');
  const stmt = d.prepare(`
    SELECT slug, name, description, category, adlc_roles, risks_addressed,
           env_scope, requires, tags, content, scripts_json, version, origin,
           maturity, created_by, created_at, updated_at, bundle_files_json
    FROM skill_catalog WHERE slug = ?
  `);
  stmt.bind([slug]);
  const found = stmt.step();
  const row = found ? stmt.getAsObject() : null;
  stmt.free();
  return rowToSkill(row);
}

function countSkills() {
  const d = db.getDb();
  if (!d) return 0;
  const res = d.exec('SELECT COUNT(*) AS n FROM skill_catalog');
  return (res.length && res[0].values[0][0]) || 0;
}

/**
 * Check installation status of a skill (does it exist at ~/.openclaw/skills/{slug}/SKILL.md?).
 */
function isInstalled(slug) {
  const target = path.join(OPENCLAW_HOME, 'skills', slug, 'SKILL.md');
  return fs.existsSync(target);
}

/**
 * Bulk installation status — returns { [slug]: boolean }.
 */
function installedMap(slugs) {
  const out = {};
  for (const s of slugs) out[s] = isInstalled(s);
  return out;
}

// ─── Seeding ─────────────────────────────────────────────────────────────────

function loadSeed() {
  if (!fs.existsSync(SEED_PATH)) {
    console.warn('[skill-catalog] Seed file missing:', SEED_PATH);
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(SEED_PATH, 'utf-8'));
  } catch (err) {
    console.error('[skill-catalog] Failed to read seed:', err.message);
    return [];
  }
}

/** Idempotent — only inserts when table empty. */
function seedIfEmpty() {
  const d = db.getDb();
  if (!d) throw new Error('Database not initialized');
  if (countSkills() > 0) return { seeded: 0, skipped: true };

  const seeds = loadSeed();
  if (!seeds.length) return { seeded: 0, skipped: false };

  const stmt = d.prepare(`
    INSERT OR IGNORE INTO skill_catalog (
      slug, name, description, category, adlc_roles, risks_addressed,
      env_scope, requires, tags, content, scripts_json, version,
      origin, maturity, created_by, bundle_files_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let count = 0;
  for (const s of seeds) {
    try {
      stmt.run(skillToParams(s, { origin: 'seed' }));
      count++;
    } catch (err) {
      console.error('[skill-catalog] Seed insert failed for', s.slug, '—', err.message);
    }
  }
  stmt.free();
  db.persist();
  console.log(`[skill-catalog] Seeded ${count} skill${count === 1 ? '' : 's'}`);
  return { seeded: count, skipped: false };
}

/** Force-refresh seed entries — overwrites seed-origin rows, leaves user rows. */
function refreshSeed() {
  const d = db.getDb();
  if (!d) throw new Error('Database not initialized');
  const seeds = loadSeed();
  if (!seeds.length) return { refreshed: 0, skipped: 'no seed entries' };

  const stmt = d.prepare(`
    INSERT OR REPLACE INTO skill_catalog (
      slug, name, description, category, adlc_roles, risks_addressed,
      env_scope, requires, tags, content, scripts_json, version,
      origin, maturity, created_by, bundle_files_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              COALESCE((SELECT created_at FROM skill_catalog WHERE slug = ?), datetime('now')),
              datetime('now'))
  `);
  let count = 0;
  for (const s of seeds) {
    try {
      const params = skillToParams(s, { origin: 'seed' });
      params.push(s.slug); // for COALESCE
      stmt.run(params);
      count++;
    } catch (err) {
      console.error('[skill-catalog] Refresh failed for', s.slug, '—', err.message);
    }
  }
  stmt.free();
  db.persist();
  console.log(`[skill-catalog] Refreshed ${count} seed skill${count === 1 ? '' : 's'}`);
  return { refreshed: count };
}

// ─── Validation ──────────────────────────────────────────────────────────────

const VALID_RISKS = new Set(['value', 'usability', 'feasibility', 'business_viability']);
const VALID_ENV_SCOPES = new Set(['odoo', 'frontend', 'agnostic', 'odoo+agnostic']);

function validateSkill(s, { isCreate = false } = {}) {
  const errs = [];
  if (isCreate) {
    if (typeof s.slug !== 'string' || !SLUG_PATTERN.test(s.slug)) {
      errs.push('slug must be lowercase letters, digits, or hyphens (2-64 chars, starts alphanumeric)');
    }
  }
  if (s.name !== undefined && (typeof s.name !== 'string' || !s.name.trim())) {
    errs.push('name is required');
  }
  if (s.content !== undefined && typeof s.content !== 'string') {
    errs.push('content must be a string');
  }
  if (s.envScope !== undefined && !VALID_ENV_SCOPES.has(s.envScope)) {
    errs.push(`envScope must be one of: ${[...VALID_ENV_SCOPES].join(', ')}`);
  }
  if (s.risksAddressed !== undefined) {
    if (!Array.isArray(s.risksAddressed)) errs.push('risksAddressed must be an array');
    else for (const r of s.risksAddressed) if (!VALID_RISKS.has(r)) errs.push(`unknown risk: ${r}`);
  }
  if (s.adlcRoles !== undefined && !Array.isArray(s.adlcRoles)) errs.push('adlcRoles must be an array');
  if (s.requires !== undefined && !Array.isArray(s.requires)) errs.push('requires must be an array');
  if (s.tags !== undefined && !Array.isArray(s.tags)) errs.push('tags must be an array');
  if (s.scripts !== undefined) {
    if (!Array.isArray(s.scripts)) errs.push('scripts must be an array');
    else for (const sc of s.scripts) {
      if (!sc || typeof sc !== 'object' || !sc.filename || typeof sc.content !== 'string') {
        errs.push('each script needs filename + content (string)');
        break;
      }
    }
  }
  return errs;
}

// ─── Mutations ───────────────────────────────────────────────────────────────

function createSkill(data, { createdBy = null } = {}) {
  const d = db.getDb();
  if (!d) throw new Error('Database not initialized');
  const errs = validateSkill(data, { isCreate: true });
  if (errs.length) { const e = new Error(errs[0]); e.code = 'VALIDATION'; e.details = errs; throw e; }
  if (!data.name) { const e = new Error('name is required'); e.code = 'VALIDATION'; throw e; }
  if (typeof data.content !== 'string' || !data.content.trim()) {
    const e = new Error('content is required'); e.code = 'VALIDATION'; throw e;
  }
  if (getSkill(data.slug)) {
    const e = new Error(`Skill "${data.slug}" already exists`); e.code = 'CONFLICT'; throw e;
  }

  const stmt = d.prepare(`
    INSERT INTO skill_catalog (
      slug, name, description, category, adlc_roles, risks_addressed,
      env_scope, requires, tags, content, scripts_json, version,
      origin, maturity, created_by, bundle_files_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(skillToParams(data, { origin: 'user', createdBy }));
  stmt.free();
  db.persist();
  return getSkill(data.slug);
}

/** Patch existing skill. Seed origin: editable; cannot change `origin`/`slug`. */
function updateSkill(slug, patch) {
  const d = db.getDb();
  if (!d) throw new Error('Database not initialized');
  const existing = getSkill(slug);
  if (!existing) { const e = new Error(`Skill "${slug}" not found`); e.code = 'NOT_FOUND'; throw e; }

  const errs = validateSkill(patch, { isCreate: false });
  if (errs.length) { const e = new Error(errs[0]); e.code = 'VALIDATION'; e.details = errs; throw e; }

  const merged = { ...existing };
  for (const key of [
    'name', 'description', 'category', 'adlcRoles', 'risksAddressed',
    'envScope', 'requires', 'tags', 'content', 'scripts', 'bundleFiles',
    'version', 'maturity',
  ]) {
    if (patch[key] !== undefined) merged[key] = patch[key];
  }

  const stmt = d.prepare(`
    UPDATE skill_catalog SET
      name = ?, description = ?, category = ?, adlc_roles = ?, risks_addressed = ?,
      env_scope = ?, requires = ?, tags = ?, content = ?, scripts_json = ?,
      bundle_files_json = ?, version = ?, maturity = ?, updated_at = datetime('now')
    WHERE slug = ?
  `);
  stmt.run([
    merged.name,
    merged.description ?? '',
    merged.category ?? null,
    JSON.stringify(merged.adlcRoles ?? []),
    JSON.stringify(merged.risksAddressed ?? []),
    merged.envScope ?? 'agnostic',
    JSON.stringify(merged.requires ?? []),
    JSON.stringify(merged.tags ?? []),
    merged.content ?? '',
    JSON.stringify(merged.scripts ?? []),
    JSON.stringify(merged.bundleFiles ?? []),
    merged.version ?? '1.0.0',
    merged.maturity ?? 'stub',
    slug,
  ]);
  stmt.free();
  db.persist();
  return getSkill(slug);
}

/** Delete user-origin only. Seed skills cannot be deleted (use refreshSeed instead). */
function deleteSkill(slug) {
  const d = db.getDb();
  if (!d) throw new Error('Database not initialized');
  const existing = getSkill(slug);
  if (!existing) { const e = new Error(`Skill "${slug}" not found`); e.code = 'NOT_FOUND'; throw e; }
  if (existing.origin === 'seed') {
    const e = new Error('Seed skills cannot be deleted (edit instead, or use refresh-seed to reset)');
    e.code = 'READ_ONLY'; throw e;
  }
  const stmt = d.prepare('DELETE FROM skill_catalog WHERE slug = ?');
  stmt.run([slug]);
  stmt.free();
  db.persist();
  return { ok: true, slug };
}

// ─── Install / Materialize to ~/.openclaw/skills/{slug}/ ─────────────────────

/**
 * Materialize a catalog skill onto disk so OpenClaw runtime can resolve it.
 * Idempotent: if already installed and same version, no-op (unless force=true).
 */
function installSkill(slug, { force = false } = {}) {
  const skill = getSkill(slug);
  if (!skill) { const e = new Error(`Skill "${slug}" not in catalog`); e.code = 'NOT_FOUND'; throw e; }

  const skillDir  = path.join(OPENCLAW_HOME, 'skills', slug);
  const skillFile = path.join(skillDir, 'SKILL.md');
  const versionFile = path.join(skillDir, '.catalog-version');

  let alreadyInstalled = false;
  let installedVersion = null;
  if (fs.existsSync(skillFile)) {
    alreadyInstalled = true;
    try { installedVersion = fs.readFileSync(versionFile, 'utf-8').trim(); } catch {}
  }

  if (alreadyInstalled && !force && installedVersion === skill.version) {
    return { ok: true, slug, action: 'noop', version: skill.version };
  }

  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(skillFile, skill.content, 'utf-8');
  fs.writeFileSync(versionFile, skill.version, 'utf-8');

  // Install bundled scripts to {skillDir}/scripts/ — flat filenames only
  if (Array.isArray(skill.scripts) && skill.scripts.length > 0) {
    const scriptsDir = path.join(skillDir, 'scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });
    for (const sc of skill.scripts) {
      const scriptPath = path.join(scriptsDir, sc.filename);
      fs.writeFileSync(scriptPath, sc.content, 'utf-8');
      const ext = path.extname(sc.filename).toLowerCase();
      if (sc.executable || ['.sh', '.bash', '.zsh', '.fish'].includes(ext)) {
        try { fs.chmodSync(scriptPath, 0o755); } catch {}
      }
    }
  }

  // Install arbitrary bundle files (references/*.md, SECURITY.md, package.json, …).
  // Path may include subdirs. Hardened: reject .. segments and absolute paths.
  if (Array.isArray(skill.bundleFiles) && skill.bundleFiles.length > 0) {
    for (const bf of skill.bundleFiles) {
      if (!bf || typeof bf.path !== 'string' || typeof bf.content !== 'string') continue;
      const rel = bf.path.replace(/^\/+/, '');
      if (rel.split('/').includes('..')) continue;            // path-traversal guard
      const target = path.resolve(skillDir, rel);
      if (!target.startsWith(skillDir + path.sep)) continue;  // escape guard
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bf.content, 'utf-8');
    }
  }

  return {
    ok: true,
    slug,
    action: alreadyInstalled ? 'updated' : 'installed',
    version: skill.version,
    path: skillDir,
  };
}

/**
 * Install many slugs. Returns per-slug result. Skips slugs not in catalog (returns 'not-in-catalog').
 */
function installMany(slugs, { force = false } = {}) {
  const results = [];
  for (const slug of slugs) {
    try {
      const res = installSkill(slug, { force });
      results.push(res);
    } catch (err) {
      if (err.code === 'NOT_FOUND') {
        results.push({ ok: false, slug, action: 'not-in-catalog', error: err.message });
      } else {
        results.push({ ok: false, slug, action: 'error', error: err.message });
      }
    }
  }
  return results;
}

module.exports = {
  // queries
  listSkills,
  getSkill,
  countSkills,
  isInstalled,
  installedMap,
  // seed
  seedIfEmpty,
  refreshSeed,
  // mutations
  createSkill,
  updateSkill,
  deleteSkill,
  // install
  installSkill,
  installMany,
};
