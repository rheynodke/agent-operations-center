'use strict';
/**
 * aoc-safety — built-in safety skill bundles.
 *
 * Ships two text-only SKILL.md bundles that get loaded into every agent's
 * context as hard-limit rules:
 *   - aoc-safety-core   → all agents (master + sub-agent)
 *   - aoc-safety-worker → sub-agents only (master excluded via
 *     MASTER_EXCLUDED_SKILLS in provision.cjs)
 *
 * Pattern mirrors aoc-schedules: install bundle to admin's
 * ~/.openclaw/skills/, then walk admin's + every per-user openclaw.json to
 * add the slug to defaults.skills + each agent's explicit allowlist.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { OPENCLAW_HOME, readJsonSafe } = require('../config.cjs');

const SLUG_CORE = 'aoc-safety-core';
const SLUG_WORKER = 'aoc-safety-worker';
const BUNDLE_VERSION = '1.0.0';

const CORE_SKILL_MD = fs.readFileSync(
  path.join(__dirname, 'bundle', 'core', 'SKILL.md'),
  'utf-8'
);
const WORKER_SKILL_MD = fs.readFileSync(
  path.join(__dirname, 'bundle', 'worker', 'SKILL.md'),
  'utf-8'
);

function skillRoot(slug) {
  return path.join(OPENCLAW_HOME, 'skills', slug);
}
function manifestPath(slug) {
  return path.join(skillRoot(slug), 'manifest.json');
}
function readManifest(slug) {
  try { return JSON.parse(fs.readFileSync(manifestPath(slug), 'utf-8')); } catch { return null; }
}
function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

const BUNDLES = {
  [SLUG_CORE]:   { files: [{ relPath: 'SKILL.md', content: CORE_SKILL_MD,   protect: true }] },
  [SLUG_WORKER]: { files: [{ relPath: 'SKILL.md', content: WORKER_SKILL_MD, protect: true }] },
};

function installOne(slug) {
  const bundle = BUNDLES[slug];
  const root = skillRoot(slug);
  fs.mkdirSync(root, { recursive: true });
  const m = readManifest(slug) || { files: {} };
  const newManifest = { bundleVersion: BUNDLE_VERSION, installedAt: new Date().toISOString(), files: {} };
  let written = 0;
  for (const f of bundle.files) {
    const target = path.join(root, f.relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const expectedSha = sha256(f.content);
    const onDiskSha = fs.existsSync(target) ? sha256(fs.readFileSync(target, 'utf-8')) : null;
    if (onDiskSha !== expectedSha) {
      fs.writeFileSync(target, f.content, { mode: 0o644 });
      written++;
    }
    newManifest.files[f.relPath] = { sha256: expectedSha, source: 'aoc' };
  }
  fs.writeFileSync(manifestPath(slug), JSON.stringify(newManifest, null, 2));
  return { slug, written, total: bundle.files.length };
}

function installSafe() {
  try {
    const a = installOne(SLUG_CORE);
    const b = installOne(SLUG_WORKER);
    if (a.written || b.written) {
      console.log(`[aoc-safety] installed core=${a.written}/${a.total}, worker=${b.written}/${b.total} (v${BUNDLE_VERSION})`);
    }
    return { ok: true, core: a, worker: b };
  } catch (err) {
    console.warn('[aoc-safety] install failed:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Patch a single openclaw.json file: add `slug` to agents.defaults.skills
 * (always) and to each agent.list[i].skills array that exists. Returns
 * true if a change was made. Idempotent. No master filtering.
 */
function patchConfigAddSlug(cfgPath, slug) {
  const cfg = readJsonSafe(cfgPath);
  if (!cfg) return false;
  let changed = false;

  cfg.agents = cfg.agents || {};
  cfg.agents.defaults = cfg.agents.defaults || {};
  if (!Array.isArray(cfg.agents.defaults.skills)) {
    cfg.agents.defaults.skills = [];
    changed = true;
  }
  if (!cfg.agents.defaults.skills.includes(slug)) {
    cfg.agents.defaults.skills.push(slug);
    changed = true;
  }
  for (const agent of cfg.agents.list || []) {
    if (!Array.isArray(agent.skills)) continue;
    if (!agent.skills.includes(slug)) {
      agent.skills.push(slug);
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf-8');
  }
  return changed;
}

async function ensureCoreEnabledForAllAgents() {
  const { withFileLock } = require('../locks.cjs');
  const adminCfg = path.join(OPENCLAW_HOME, 'openclaw.json');

  let adminChanged = false;
  await withFileLock(adminCfg, async () => {
    adminChanged = patchConfigAddSlug(adminCfg, SLUG_CORE);
  });

  const usersDir = path.join(OPENCLAW_HOME, 'users');
  const patched = [];
  if (fs.existsSync(usersDir)) {
    for (const entry of fs.readdirSync(usersDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const cfgPath = path.join(usersDir, entry.name, '.openclaw', 'openclaw.json');
      if (!fs.existsSync(cfgPath)) continue;
      try {
        await withFileLock(cfgPath, async () => {
          if (patchConfigAddSlug(cfgPath, SLUG_CORE)) patched.push(entry.name);
        });
      } catch (e) {
        console.warn(`[aoc-safety] patch user ${entry.name} (core) failed: ${e.message}`);
      }
    }
  }

  if (adminChanged || patched.length > 0) {
    const parts = [];
    if (adminChanged) parts.push('admin');
    if (patched.length > 0) parts.push(`${patched.length} per-user [${patched.join(', ')}]`);
    console.log(`[aoc-safety] enabled aoc-safety-core for: ${parts.join(' + ')}`);
  }
  return { changed: adminChanged || patched.length > 0, adminChanged, perUserPatched: patched };
}

/**
 * Variant of patchConfigAddSlug that skips a specific agent id (the master)
 * when patching the per-agent allowlist. Defaults still get the slug because
 * new sub-agents provisioned later inherit defaults — masters strip it via
 * MASTER_EXCLUDED_SKILLS in provision.cjs.
 */
function patchConfigAddSlugSkipMaster(cfgPath, slug, masterAgentId) {
  const cfg = readJsonSafe(cfgPath);
  if (!cfg) return false;
  let changed = false;

  cfg.agents = cfg.agents || {};
  cfg.agents.defaults = cfg.agents.defaults || {};
  if (!Array.isArray(cfg.agents.defaults.skills)) {
    cfg.agents.defaults.skills = [];
    changed = true;
  }
  if (!cfg.agents.defaults.skills.includes(slug)) {
    cfg.agents.defaults.skills.push(slug);
    changed = true;
  }
  for (const agent of cfg.agents.list || []) {
    if (agent.id === masterAgentId) continue;
    if (!Array.isArray(agent.skills)) continue;
    if (!agent.skills.includes(slug)) {
      agent.skills.push(slug);
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf-8');
  }
  return changed;
}

/**
 * Enable aoc-safety-worker in admin + every per-user openclaw.json. Each
 * file's master agent (looked up via masterByUser[userId]) is excluded from
 * the per-agent allowlist patch. Admin user id is conventionally 1.
 *
 * Caller provides the master map (computed from SQLite users.master_agent_id
 * by server/index.cjs startup wiring).
 */
async function ensureWorkerEnabledForNonMasterAgents({ masterByUser = {} } = {}) {
  const { withFileLock } = require('../locks.cjs');
  const adminCfg = path.join(OPENCLAW_HOME, 'openclaw.json');

  let adminChanged = false;
  await withFileLock(adminCfg, async () => {
    adminChanged = patchConfigAddSlugSkipMaster(adminCfg, SLUG_WORKER, masterByUser[1] || null);
  });

  const usersDir = path.join(OPENCLAW_HOME, 'users');
  const patched = [];
  if (fs.existsSync(usersDir)) {
    for (const entry of fs.readdirSync(usersDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const userId = Number(entry.name);
      if (!Number.isInteger(userId)) continue;
      const cfgPath = path.join(usersDir, entry.name, '.openclaw', 'openclaw.json');
      if (!fs.existsSync(cfgPath)) continue;
      try {
        await withFileLock(cfgPath, async () => {
          if (patchConfigAddSlugSkipMaster(cfgPath, SLUG_WORKER, masterByUser[userId] || null)) {
            patched.push(entry.name);
          }
        });
      } catch (e) {
        console.warn(`[aoc-safety] patch user ${entry.name} (worker) failed: ${e.message}`);
      }
    }
  }

  if (adminChanged || patched.length > 0) {
    const parts = [];
    if (adminChanged) parts.push('admin');
    if (patched.length > 0) parts.push(`${patched.length} per-user [${patched.join(', ')}]`);
    console.log(`[aoc-safety] enabled aoc-safety-worker for: ${parts.join(' + ')}`);
  }
  return { changed: adminChanged || patched.length > 0, adminChanged, perUserPatched: patched };
}

module.exports = {
  SLUG_CORE,
  SLUG_WORKER,
  BUNDLE_VERSION,
  installOne,
  installSafe,
  ensureCoreEnabledForAllAgents,
  ensureWorkerEnabledForNonMasterAgents,
};
