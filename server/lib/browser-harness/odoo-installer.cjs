'use strict';
/**
 * browser-harness-odoo — Layer 2 skill installer.
 *
 * Authored entirely by AOC (no upstream). Inherits Layer 1 (browser-harness-core)
 * via SKILL.md cross-reference and shared CDP env. Bundles:
 *   - SKILL.md
 *   - lib/odoo_login.py, odoo_nav.py, odoo_form.py, odoo_uat.py, odoo_cdp.py
 *   - templates/uat-script.md, user-manual.md
 *   - domain-skills/sales/create_quotation.py — reference scenario
 *   - manifest.json
 *
 * Idempotent. Does NOT overwrite user-edited files (manifest tracks which we
 * authored). New AOC versions can opt into "force" via dashboard button.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { OPENCLAW_HOME } = require('../config.cjs');

// Bump when bundled content changes. Manifest stores last-installed version
// per file, so we can detect "user edited" vs "needs upgrade".
const BUNDLE_VERSION = '0.7.0';

function skillRoot() {
  return path.join(OPENCLAW_HOME, 'skills', 'browser-harness-odoo');
}
function manifestPath() {
  return path.join(skillRoot(), 'manifest.json');
}

function readManifest() {
  try { return JSON.parse(fs.readFileSync(manifestPath(), 'utf-8')); }
  catch { return null; }
}

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/**
 * Bundle content. Each entry: { relPath, content }.
 * Files marked `protect: false` are user-extendable (we never overwrite once
 * the user touches them); `protect: true` means AOC owns them and we always
 * keep them in sync with the bundle.
 */
const BUNDLE = require('./odoo-bundle.cjs');

function status() {
  const m = readManifest();
  const root = skillRoot();
  const fileStatus = BUNDLE.files.map(f => {
    const p = path.join(root, f.relPath);
    const exists = fs.existsSync(p);
    let onDiskSha = null;
    if (exists) {
      try { onDiskSha = sha256(fs.readFileSync(p, 'utf-8')); } catch {}
    }
    const lastInstalledSha = m?.files?.[f.relPath]?.sha256 || null;
    const expectedSha = sha256(f.content);
    return {
      relPath: f.relPath,
      exists,
      protect: !!f.protect,
      upToDate: onDiskSha === expectedSha,
      userEdited: onDiskSha != null && lastInstalledSha != null && onDiskSha !== lastInstalledSha,
    };
  });
  return {
    installed: !!m,
    bundleVersion: BUNDLE_VERSION,
    installedVersion: m?.bundleVersion || null,
    skillRoot: root,
    installedAt: m?.installedAt || null,
    files: fileStatus,
    moduleCount: BUNDLE.files.filter(f => f.relPath.startsWith('domain-skills/')).length,
  };
}

function install({ force = false } = {}) {
  const root = skillRoot();
  fs.mkdirSync(root, { recursive: true });
  const m = readManifest() || { files: {} };
  const newManifest = { bundleVersion: BUNDLE_VERSION, installedAt: new Date().toISOString(), files: {} };

  let written = 0; let kept = 0; let skippedUserEdit = 0;
  for (const f of BUNDLE.files) {
    const target = path.join(root, f.relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const expectedSha = sha256(f.content);
    const lastSha = m.files?.[f.relPath]?.sha256 || null;

    if (fs.existsSync(target)) {
      const onDiskSha = sha256(fs.readFileSync(target, 'utf-8'));
      const userEdited = lastSha != null && onDiskSha !== lastSha;

      if (!force && !f.protect && userEdited) {
        // User changed an extendable file — leave it alone.
        skippedUserEdit++;
        newManifest.files[f.relPath] = { sha256: onDiskSha, source: 'user' };
        continue;
      }
      if (onDiskSha === expectedSha) {
        kept++;
        newManifest.files[f.relPath] = { sha256: expectedSha, source: 'aoc' };
        continue;
      }
    }
    fs.writeFileSync(target, f.content, { mode: f.exec ? 0o755 : 0o644 });
    if (f.exec) { try { fs.chmodSync(target, 0o755); } catch {} }
    written++;
    newManifest.files[f.relPath] = { sha256: expectedSha, source: 'aoc' };
  }
  // Always reconcile exec bit — fs.writeFileSync's mode option is ignored
  // when the file already exists, so newly-flagged exec scripts that were
  // previously written without +x stay 644 unless we chmod explicitly.
  for (const f of BUNDLE.files) {
    if (!f.exec) continue;
    const target = path.join(root, f.relPath);
    try {
      const stat = fs.statSync(target);
      if ((stat.mode & 0o111) === 0) fs.chmodSync(target, 0o755);
    } catch {}
  }

  fs.writeFileSync(manifestPath(), JSON.stringify(newManifest, null, 2));
  return { ok: true, written, kept, skippedUserEdit, total: BUNDLE.files.length, bundleVersion: BUNDLE_VERSION };
}

function installSafe() {
  try {
    const r = install();
    if (r.written > 0) console.log(`[browser-harness-odoo] installed ${r.written}/${r.total} files (${r.skippedUserEdit} user-edited preserved)`);
    return r;
  } catch (err) {
    console.warn('[browser-harness-odoo] install failed:', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  BUNDLE_VERSION,
  skillRoot,
  status,
  install,
  installSafe,
};
