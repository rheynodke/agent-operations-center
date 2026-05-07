'use strict';
/**
 * aoc-odoo — built-in skill bundle.
 *
 * Wraps OdooCLI (https://github.com/.../odoocli) as an AOC skill. Files live
 * at ~/.openclaw/skills/aoc-odoo/. The wrapper script `odoo.sh` fetches a
 * connection's credentials from the dashboard at run-time, materializes a
 * temporary `.odoocli.toml` (mode 0600) under $TMPDIR, runs odoocli with
 * `--config` pointing at it, and removes the temp file on exit.
 *
 * Bundle source-of-truth: ./bundle/ (vendored at install time). Walking the
 * tree means we don't have to inline 1400+ lines of Markdown into a JS
 * string.
 *
 * Auto-installed at startup. Auto-enabled for every agent (added to
 * config.agents.defaults.skills, plus each agent's explicit allowlist).
 */
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');
const { OPENCLAW_HOME, readJsonSafe } = require('../config.cjs');

const SKILL_SLUG     = 'aoc-odoo';
const BUNDLE_VERSION = '1.1.0'; // 1.1.0: agent-scoped (odoo-list.sh → /api/agent/connections; odoo.sh passes ?agentId)
const BUNDLE_DIR     = path.join(__dirname, 'bundle');

function skillRoot() {
  return path.join(OPENCLAW_HOME, 'skills', SKILL_SLUG);
}
function manifestPath() { return path.join(skillRoot(), 'manifest.json'); }
function readManifest() {
  try { return JSON.parse(fs.readFileSync(manifestPath(), 'utf-8')); } catch { return null; }
}
function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

// Walk ./bundle and produce { relPath, content, exec, protect } entries.
// Everything under scripts/ gets exec=true. SKILL.md stays at the bundle root.
function loadBundleFiles() {
  const out = [];
  function walk(dir, rel) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const r   = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { walk(abs, r); continue; }
      if (!entry.isFile())     continue;
      const content = fs.readFileSync(abs, 'utf-8');
      out.push({
        relPath: r,
        content,
        exec: r.startsWith('scripts/'),
        protect: true,
      });
    }
  }
  walk(BUNDLE_DIR, '');
  return out;
}

function status() {
  const m = readManifest();
  const root = skillRoot();
  const files = loadBundleFiles();
  return {
    installed: !!m,
    bundleVersion: BUNDLE_VERSION,
    installedVersion: m?.bundleVersion || null,
    skillRoot: root,
    installedAt: m?.installedAt || null,
    files: files.map(f => {
      const p = path.join(root, f.relPath);
      return { relPath: f.relPath, exists: fs.existsSync(p), protect: !!f.protect };
    }),
  };
}

function install({ force = false } = {}) {
  const root = skillRoot();
  fs.mkdirSync(root, { recursive: true });
  const m = readManifest() || { files: {} };
  const files = loadBundleFiles();
  const newManifest = { bundleVersion: BUNDLE_VERSION, installedAt: new Date().toISOString(), files: {} };

  let written = 0; let kept = 0; let skippedUserEdit = 0;
  for (const f of files) {
    const target = path.join(root, f.relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const expectedSha = sha256(f.content);
    const lastSha = m.files?.[f.relPath]?.sha256 || null;

    if (fs.existsSync(target)) {
      const onDiskSha = sha256(fs.readFileSync(target, 'utf-8'));
      const userEdited = lastSha != null && onDiskSha !== lastSha;
      if (!force && !f.protect && userEdited) {
        skippedUserEdit++;
        newManifest.files[f.relPath] = { sha256: onDiskSha, source: 'user' };
        continue;
      }
      if (onDiskSha === expectedSha) {
        kept++;
        newManifest.files[f.relPath] = { sha256: expectedSha, source: 'aoc' };
        if (f.exec) { try { fs.chmodSync(target, 0o755); } catch {} }
        continue;
      }
    }
    fs.writeFileSync(target, f.content, { mode: f.exec ? 0o755 : 0o644 });
    if (f.exec) { try { fs.chmodSync(target, 0o755); } catch {} }
    written++;
    newManifest.files[f.relPath] = { sha256: expectedSha, source: 'aoc' };
  }
  // Belt-and-suspenders: ensure exec bit even if file existed but wasn't chmodded.
  for (const f of files) {
    if (!f.exec) continue;
    const target = path.join(root, f.relPath);
    try {
      const stat = fs.statSync(target);
      if ((stat.mode & 0o111) === 0) fs.chmodSync(target, 0o755);
    } catch {}
  }
  fs.writeFileSync(manifestPath(), JSON.stringify(newManifest, null, 2));
  return { ok: true, written, kept, skippedUserEdit, total: files.length, bundleVersion: BUNDLE_VERSION };
}

function installSafe() {
  try {
    const r = install();
    if (r.written > 0) console.log(`[aoc-odoo] installed ${r.written}/${r.total} files`);
    return r;
  } catch (err) {
    console.warn('[aoc-odoo] install failed:', err.message);
    return { ok: false, error: err.message };
  }
}

async function ensureSkillEnabledForAllAgents() {
  const { withFileLock } = require('../locks.cjs');
  const cfgPath = path.join(OPENCLAW_HOME, 'openclaw.json');
  return withFileLock(cfgPath, async () => {
    const cfg = readJsonSafe(cfgPath);
    if (!cfg) return { changed: false, reason: 'no openclaw.json' };

    let changed = false;

    cfg.agents = cfg.agents || {};
    cfg.agents.defaults = cfg.agents.defaults || {};
    if (!Array.isArray(cfg.agents.defaults.skills)) {
      cfg.agents.defaults.skills = [];
      changed = true;
    }
    if (!cfg.agents.defaults.skills.includes(SKILL_SLUG)) {
      cfg.agents.defaults.skills.push(SKILL_SLUG);
      changed = true;
    }

    for (const agent of cfg.agents.list || []) {
      if (!Array.isArray(agent.skills)) continue;
      if (!agent.skills.includes(SKILL_SLUG)) {
        agent.skills.push(SKILL_SLUG);
        changed = true;
      }
    }

    cfg.skills = cfg.skills || {};
    cfg.skills.entries = cfg.skills.entries || {};
    const entry = cfg.skills.entries[SKILL_SLUG];
    if (entry && entry.enabled === false) {
      delete cfg.skills.entries[SKILL_SLUG].enabled;
      changed = true;
    }

    if (changed) {
      fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf-8');
      console.log('[aoc-odoo] enabled skill in openclaw.json');
    }
    return { changed };
  });
}

module.exports = {
  SKILL_SLUG,
  BUNDLE_VERSION,
  skillRoot,
  status,
  install,
  installSafe,
  ensureSkillEnabledForAllAgents,
};
