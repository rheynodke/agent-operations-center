/**
 * routes/skills.cjs
 *
 * ClawHub install, skill upload, SkillsMP integration, Skill Catalog,
 * Global Skills & Tools Library, Skill Directory Tree, Skill Scripts Management.
 * Step 7c of server modularization.
 */
'use strict';

const { parseOwnerParam } = require('../helpers/access-control.cjs');

function roleTemplateErrorStatus(err) {
  if (err.code === 'NOT_FOUND') return 404;
  if (err.code === 'CONFLICT' || err.code === 'ALREADY_EXISTS') return 409;
  if (err.code === 'INVALID' || err.code === 'VALIDATION') return 400;
  return 500;
}

module.exports = function skillsRouter(deps) {
  const { db, parsers, broadcast, checkSkillInstallTarget, vSave, gatewayProxy, broadcastTasksUpdate } = deps;
  const router = require('express').Router();

// ─── ClawHub Skill Install ────────────────────────────────────────────────────

const skillsInstall = require('../lib/skills-install.cjs');

// GET /api/skills/clawhub/targets — list install location options
  router.get('/skills/clawhub/targets', db.authMiddleware, (req, res) => {
  try {
    res.json({ targets: skillsInstall.getInstallTargets() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/skills/clawhub/preview — fetch + scan skill without installing
// Body: { url: "https://clawhub.ai/author/slug" }
  router.post('/skills/clawhub/preview', db.authMiddleware, async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }
  try {
    const preview = await skillsInstall.previewSkill(url);
    res.json(preview);
  } catch (err) {
    console.error('[api/skills/clawhub/preview]', err);
    res.status(500).json({ error: err.message || 'Failed to fetch skill from ClawHub' });
  }
});

// POST /api/skills/clawhub/install — download + extract skill
// Body: { url, target, agentId?, bufferB64? }
  router.post('/skills/clawhub/install', db.authMiddleware, async (req, res) => {
  const { url, target, agentId, bufferB64, overwrite } = req.body || {};
  if (!url || !target) {
    return res.status(400).json({ error: 'url and target are required' });
  }
  const gate = checkSkillInstallTarget(req, target, agentId);
  if (gate) return res.status(403).json({ error: gate });
  try {
    const result = await skillsInstall.installSkill({ urlOrSlug: url, target, agentId, bufferB64, overwrite: !!overwrite });
    console.log(`[api/skills/clawhub] ${result.updated ? 'Updated' : 'Installed'} "${result.slug}" to ${result.path}`);
    res.json(result);
  } catch (err) {
    console.error('[api/skills/clawhub/install]', err);
    const code = err.code === 'ALREADY_INSTALLED' ? 409 : 500;
    res.status(code).json({ error: err.message || 'Install failed', code: err.code, slug: err.slug, installPath: err.installPath });
  }
});

// ─── Upload Skill (zip / .skill / raw SKILL.md) ───────────────────────────────

// POST /api/skills/upload/preview — scan an uploaded buffer without installing
// Body: { filename, bufferB64 }
  router.post('/skills/upload/preview', db.authMiddleware, (req, res) => {
  const { filename, bufferB64 } = req.body || {};
  if (!bufferB64 || typeof bufferB64 !== 'string') {
    return res.status(400).json({ error: 'bufferB64 is required' });
  }
  try {
    const buffer = Buffer.from(bufferB64, 'base64');
    if (!buffer.length) return res.status(400).json({ error: 'Empty upload' });
    const preview = skillsInstall.previewFromUpload(buffer, filename);
    res.json(preview);
  } catch (err) {
    console.error('[api/skills/upload/preview]', err);
    res.status(400).json({ error: err.message || 'Failed to parse upload' });
  }
});

// POST /api/skills/upload/install — install from uploaded buffer
// Body: { filename, bufferB64, target, agentId?, slug? }
  router.post('/skills/upload/install', db.authMiddleware, (req, res) => {
  const { filename, bufferB64, target, agentId, slug, overwrite } = req.body || {};
  if (!bufferB64 || !target) {
    return res.status(400).json({ error: 'bufferB64 and target are required' });
  }
  const gate = checkSkillInstallTarget(req, target, agentId);
  if (gate) return res.status(403).json({ error: gate });
  try {
    const result = skillsInstall.installFromUpload({ bufferB64, filename, target, agentId, slug, overwrite: !!overwrite });
    console.log(`[api/skills/upload] ${result.updated ? 'Updated' : 'Installed'} "${result.slug}" to ${result.path}`);
    res.json(result);
  } catch (err) {
    console.error('[api/skills/upload/install]', err);
    const code = err.code === 'ALREADY_INSTALLED' ? 409 : 400;
    res.status(code).json({ error: err.message || 'Install failed', code: err.code, slug: err.slug, installPath: err.installPath });
  }
});

// ─── SkillsMP Integration ─────────────────────────────────────────────────────

const SKILLSMP_KEY = 'skillsmp_api_key';

// GET /api/settings/skillsmp — check if API key is configured (masked)
  router.get('/settings/skillsmp', db.authMiddleware, (req, res) => {
  const key = db.getSetting(SKILLSMP_KEY);
  res.json({
    configured: !!key,
    // Return only first/last 4 chars for display
    preview: key ? `${key.slice(0, 11)}…${key.slice(-4)}` : null,
  });
});

// POST /api/settings/skillsmp — save API key
  router.post('/settings/skillsmp', db.authMiddleware, (req, res) => {
  const { apiKey } = req.body || {};
  if (!apiKey || typeof apiKey !== 'string') {
    return res.status(400).json({ error: 'apiKey is required' });
  }
  if (!apiKey.startsWith('sk_live_')) {
    return res.status(400).json({ error: 'Invalid API key format. Must start with sk_live_' });
  }
  db.setSetting(SKILLSMP_KEY, apiKey.trim());
  res.json({ ok: true, preview: `${apiKey.slice(0, 11)}…${apiKey.slice(-4)}` });
});

// DELETE /api/settings/skillsmp — remove API key
  router.delete('/settings/skillsmp', db.authMiddleware, (req, res) => {
  db.deleteSetting(SKILLSMP_KEY);
  res.json({ ok: true });
});

// GET /api/skills/skillsmp/search?q= — search SkillsMP
  router.get('/skills/skillsmp/search', db.authMiddleware, async (req, res) => {
  const { q } = req.query;
  if (!q || typeof q !== 'string' || !q.trim()) {
    return res.status(400).json({ error: 'q (query) is required' });
  }
  const apiKey = db.getSetting(SKILLSMP_KEY);
  if (!apiKey) {
    return res.status(401).json({ error: 'SkillsMP API key not configured', code: 'NO_API_KEY' });
  }
  try {
    const skills = await skillsInstall.skillsmpSearch(q.trim(), apiKey);
    res.json({ skills });
  } catch (err) {
    console.error('[api/skills/skillsmp/search]', err);
    const code = err.message?.includes('auth failed') || err.message?.includes('Invalid') ? 401 : 500;
    res.status(code).json({ error: err.message });
  }
});

// POST /api/skills/skillsmp/preview — fetch SKILL.md content + basic security scan
  router.post('/skills/skillsmp/preview', db.authMiddleware, async (req, res) => {
  const { skill } = req.body || {};
  if (!skill) return res.status(400).json({ error: 'skill is required' });
  try {
    const result = await skillsInstall.fetchSkillsmpSkillMd(skill);
    if (!result) {
      return res.status(404).json({ error: 'Could not fetch SKILL.md — GitHub source not available or inaccessible' });
    }
    // Run basic security scan on the SKILL.md content
    const { runSecurityScan } = skillsInstall;
    const security = runSecurityScan ? runSecurityScan({ 'SKILL.md': () => result.content }) : null;
    res.json({ content: result.content, sourceUrl: result.url, security });
  } catch (err) {
    console.error('[api/skills/skillsmp/preview]', err);
    res.status(500).json({ error: err.message || 'Failed to fetch skill preview' });
  }
});

// POST /api/skills/skillsmp/install — install from SkillsMP
  router.post('/skills/skillsmp/install', db.authMiddleware, async (req, res) => {
  const { skill, target, agentId, overwrite } = req.body || {};
  if (!skill || !target) {
    return res.status(400).json({ error: 'skill and target are required' });
  }
  const gate = checkSkillInstallTarget(req, target, agentId);
  if (gate) return res.status(403).json({ error: gate });
  try {
    const result = await skillsInstall.installSkillsmpSkill({ skill, target, agentId, overwrite: !!overwrite });
    console.log(`[api/skills/skillsmp] ${result.updated ? 'Updated' : 'Installed'} "${result.slug}" to ${result.path}`);
    res.json(result);
  } catch (err) {
    console.error('[api/skills/skillsmp/install]', err);
    const code = err.code === 'ALREADY_INSTALLED' ? 409 : 500;
    res.status(code).json({ error: err.message || 'Install failed', code: err.code, slug: err.slug, installPath: err.installPath });
  }
});


// ─── Role Templates are mounted separately in index.cjs (Step 6b) ──────

// ─── Skill Catalog (Internal Marketplace) ──────────────────────────────────
// First-party AOC skill registry. Source for resolving "missing" skill refs in
// role templates without forcing inline content into TS files.

// GET /api/skills/catalog — list with optional filters
//   query: ?envScope=odoo&role=pm-discovery&risk=value&search=foo
  router.get('/skills/catalog', db.authMiddleware, (req, res) => {
  try {
    const filters = {
      envScope: req.query.envScope,
      role:     req.query.role,
      risk:     req.query.risk,
      search:   req.query.search,
    };
    const skills = parsers.listCatalogSkills(filters);
    const slugs = skills.map(s => s.slug);
    const installed = parsers.catalogInstalledMap(slugs);
    const enriched = skills.map(s => ({ ...s, installed: !!installed[s.slug] }));
    res.json({ skills: enriched, total: enriched.length });
  } catch (err) {
    console.error('[api/skills/catalog][list]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/skills/catalog/:slug — single skill details
  router.get('/skills/catalog/:slug', db.authMiddleware, (req, res) => {
  try {
    const skill = parsers.getCatalogSkill(req.params.slug);
    if (!skill) return res.status(404).json({ error: 'Skill not in catalog' });
    res.json({ skill: { ...skill, installed: parsers.isCatalogSkillInstalled(skill.slug) } });
  } catch (err) {
    console.error('[api/skills/catalog/:slug]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/skills/catalog — create a user skill (admin only for now)
  router.post('/skills/catalog', db.authMiddleware, db.requireAdmin, (req, res) => {
  try {
    const created = parsers.createCatalogSkill(req.body || {}, { createdBy: req.user?.id || null });
    console.log(`[api/skills/catalog] Created "${created.slug}"`);
    res.status(201).json({ skill: created });
  } catch (err) {
    console.error('[api/skills/catalog][POST]', err.message);
    res.status(roleTemplateErrorStatus(err)).json({ error: err.message, code: err.code, details: err.details });
  }
});

// PATCH /api/skills/catalog/:slug — update; seed origin allowed (editable)
  router.patch('/skills/catalog/:slug', db.authMiddleware, db.requireAdmin, (req, res) => {
  try {
    const updated = parsers.updateCatalogSkill(req.params.slug, req.body || {});
    res.json({ skill: updated });
  } catch (err) {
    console.error('[api/skills/catalog][PATCH]', err.message);
    res.status(roleTemplateErrorStatus(err)).json({ error: err.message, code: err.code, details: err.details });
  }
});

// DELETE /api/skills/catalog/:slug — user-origin only; seed protected
  router.delete('/skills/catalog/:slug', db.authMiddleware, db.requireAdmin, (req, res) => {
  try {
    const result = parsers.deleteCatalogSkill(req.params.slug);
    res.json(result);
  } catch (err) {
    console.error('[api/skills/catalog][DELETE]', err.message);
    res.status(roleTemplateErrorStatus(err)).json({ error: err.message, code: err.code });
  }
});

// POST /api/skills/catalog/refresh-seed — overwrite seed-origin rows from JSON
  router.post('/skills/catalog/refresh-seed', db.authMiddleware, db.requireAdmin, (req, res) => {
  try {
    const result = parsers.refreshSkillCatalogSeed();
    console.log('[api/skills/catalog/refresh-seed]', result);
    res.json(result);
  } catch (err) {
    console.error('[api/skills/catalog/refresh-seed]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/skills/catalog/:slug/install — materialize skill to ~/.openclaw/skills/{slug}/
//   body: { force?: boolean }
  router.post('/skills/catalog/:slug/install', db.authMiddleware, (req, res) => {
  try {
    const force = !!(req.body && req.body.force);
    const result = parsers.installCatalogSkill(req.params.slug, { force });
    console.log(`[api/skills/catalog/install] "${req.params.slug}" → ${result.action}`);
    res.json(result);
  } catch (err) {
    console.error('[api/skills/catalog/install]', err.message);
    res.status(roleTemplateErrorStatus(err)).json({ error: err.message, code: err.code });
  }
});

// POST /api/skills/catalog/install-many — bulk install (used for "install all missing")
//   body: { slugs: string[], force?: boolean }
  router.post('/skills/catalog/install-many', db.authMiddleware, (req, res) => {
  try {
    const slugs = Array.isArray(req.body?.slugs) ? req.body.slugs : [];
    if (!slugs.length) return res.status(400).json({ error: 'slugs[] required' });
    const force = !!req.body.force;
    const results = parsers.installCatalogSkills(slugs, { force });
    const summary = {
      total: results.length,
      installed: results.filter(r => r.action === 'installed').length,
      updated:   results.filter(r => r.action === 'updated').length,
      noop:      results.filter(r => r.action === 'noop').length,
      missing:   results.filter(r => r.action === 'not-in-catalog').length,
      errors:    results.filter(r => r.action === 'error').length,
    };
    console.log('[api/skills/catalog/install-many]', summary);
    res.json({ results, summary });
  } catch (err) {
    console.error('[api/skills/catalog/install-many]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Global Skills & Tools Library ──────────────────────────────────────────

// All skills across all scopes with per-agent assignment info
  router.get('/skills', db.authMiddleware, (req, res) => {
  try {
    const result = parsers.getAllSkills();
    // Skills are a shared filesystem resource — no ownership column exists yet.
    // Scoping by ?owner= is a no-op for now; the full result is always returned.
    // TODO: add ownership tracking to skills when the data model supports it.
    res.json(result);
  } catch (err) {
    console.error('[api/skills]', err);
    res.status(500).json({ error: err.message });
  }
});

// Create a new skill globally (no agent context needed)
  router.post('/skills', db.authMiddleware, db.requireAdmin, (req, res) => {
  try {
    const { slug, scope, content } = req.body;
    if (!slug) return res.status(400).json({ error: 'slug is required' });
    const result = parsers.createGlobalSkill(slug, scope || 'workspace', content || '');
    console.log(`[api/skills] Created global skill "${slug}" (scope: ${scope})`);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[api/skills/create]', err);
    const status = err.message?.includes('already exists') ? 409 : 500;
    res.status(status).json({ error: err.message });
  }
});

// Delete a skill from the global library by slug
  router.delete('/skills/:slug', db.authMiddleware, db.requireAdmin, (req, res) => {
  try {
    const result = parsers.deleteSkillBySlug(req.params.slug);
    console.log(`[api/skills] Deleted skill "${req.params.slug}"`);
    res.json(result);
  } catch (err) {
    console.error('[api/skills/delete]', err);
    const status = err.message?.includes('not found') ? 404 : err.message?.includes('not deletable') ? 403 : 500;
    res.status(status).json({ error: err.message });
  }
});

// GET /api/skills/:slug/tree — full directory tree of a skill
  router.get('/skills/:slug/tree', db.authMiddleware, (req, res) => {
  try {
    const result = parsers.getSkillDirTree(req.params.slug);
    res.json(result);
  } catch (err) {
    const status = err.message?.includes('not found') ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// GET /api/skills/:slug/anyfile?path=assets/AGENTS.md — read any file in skill dir
  router.get('/skills/:slug/anyfile', db.authMiddleware, (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'path query param required' });
    const result = parsers.getSkillAnyFile(req.params.slug, filePath);
    res.json(result);
  } catch (err) {
    const status = err.message?.includes('not found') ? 404 : err.message?.includes('traversal') ? 403 : 500;
    res.status(status).json({ error: err.message });
  }
});

// PUT /api/skills/:slug/anyfile?path=assets/AGENTS.md — save any file in skill dir
  router.put('/skills/:slug/anyfile', db.authMiddleware, db.requireAdmin, (req, res) => {
  try {
    const filePath = req.query.path;
    const { content } = req.body;
    if (!filePath) return res.status(400).json({ error: 'path query param required' });
    if (content === undefined) return res.status(400).json({ error: 'content is required' });
    const result = parsers.saveSkillAnyFile(req.params.slug, filePath, content);
    res.json({ ok: true, ...result });
  } catch (err) {
    const status = err.message?.includes('not found') ? 404 : err.message?.includes('read-only') ? 403 : 500;
    res.status(status).json({ error: err.message });
  }
});

// Read a skill's SKILL.md directly by slug
  router.get('/skills/:slug/file', db.authMiddleware, (req, res) => {
  try {
    const result = parsers.getSkillFileBySlug(req.params.slug);
    res.json(result);
  } catch (err) {
    console.error('[api/skills/file]', err);
    const status = err.message?.includes('not found') ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// Save a skill's SKILL.md directly by slug
  router.put('/skills/:slug/file', db.authMiddleware, db.requireAdmin, (req, res) => {
  try {
    const { content } = req.body;
    if (content === undefined) return res.status(400).json({ error: 'content is required' });
    const result = parsers.saveSkillFileBySlug(req.params.slug, content);
    console.log(`[api/skills] Saved SKILL.md for "${req.params.slug}"`);
    vSave(`skill:global:${req.params.slug}`, content, req);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[api/skills/file/put]', err);
    const status = err.message?.includes('not found') ? 404 : err.message?.includes('not editable') ? 403 : 500;
    res.status(status).json({ error: err.message });
  }
});

// All built-in tools with per-agent status
  router.get('/tools', db.authMiddleware, (req, res) => {
  try {
    const result = parsers.getAllTools();
    res.json(result);
  } catch (err) {
    console.error('[api/tools]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Skill Directory Tree (all files, not just scripts/) ─────────────────────

  router.get('/agents/:id/skills/:name/tree', db.authMiddleware, (req, res) => {
  try {
    const result = parsers.getAgentSkillDirTree(req.params.id, req.params.name);
    res.json(result);
  } catch (err) {
    const status = err.message?.includes('not found') ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

  router.get('/agents/:id/skills/:name/anyfile', db.authMiddleware, (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'path query param required' });
    const result = parsers.getAgentSkillAnyFile(req.params.id, req.params.name, filePath);
    res.json(result);
  } catch (err) {
    const status = err.message?.includes('not found') ? 404 : err.message?.includes('traversal') ? 403 : 500;
    res.status(status).json({ error: err.message });
  }
});

  router.put('/agents/:id/skills/:name/anyfile', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const filePath = req.query.path;
    const { content } = req.body;
    if (!filePath) return res.status(400).json({ error: 'path query param required' });
    if (content === undefined) return res.status(400).json({ error: 'content is required' });
    const result = parsers.saveAgentSkillAnyFile(req.params.id, req.params.name, filePath, content);
    res.json({ ok: true, ...result });
  } catch (err) {
    const status = err.message?.includes('not found') ? 404 : err.message?.includes('traversal') ? 403 : 500;
    res.status(status).json({ error: err.message });
  }
});

// ─── Skill Scripts Management ────────────────────────────────────────────────

// List scripts in a skill's scripts/ folder
  router.get('/agents/:id/skills/:name/scripts', db.authMiddleware, (req, res) => {
  try {
    const scripts = parsers.listSkillScripts(req.params.id, req.params.name);
    res.json({ scripts });
  } catch (err) {
    console.error('[api/agents/skills/scripts/list]', err);
    const status = err.message?.includes('not found') ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// Get scripts directory path hint
  router.get('/agents/:id/skills/:name/scripts-path', db.authMiddleware, (req, res) => {
  try {
    const result = parsers.getSkillScriptsPath(req.params.id, req.params.name);
    res.json(result);
  } catch (err) {
    console.error('[api/agents/skills/scripts/path]', err);
    const status = err.message?.includes('not found') ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// Get a single script content
  router.get('/agents/:id/skills/:name/scripts/:filename', db.authMiddleware, (req, res) => {
  try {
    const result = parsers.getSkillScript(req.params.id, req.params.name, req.params.filename);
    res.json(result);
  } catch (err) {
    console.error('[api/agents/skills/scripts/get]', err);
    const status = err.message?.includes('not found') ? 404 : err.message?.includes('not allowed') ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// Save (create or overwrite) a script
  router.put('/agents/:id/skills/:name/scripts/:filename', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const { content, appendToSkillMd } = req.body;
    if (content === undefined) return res.status(400).json({ error: 'content is required' });
    const result = parsers.saveSkillScript(
      req.params.id,
      req.params.name,
      req.params.filename,
      content,
      { appendToSkillMd: appendToSkillMd !== false }
    );
    console.log(`[api/agents/skills/scripts] Saved "${req.params.filename}" in skill "${req.params.name}" for agent "${req.params.id}" (new: ${result.isNew}, skillMdUpdated: ${result.skillMdUpdated})`);
    vSave(`skill-script:${req.params.id}:${req.params.name}:${req.params.filename}`, content, req, result.isNew ? 'create' : 'edit');
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[api/agents/skills/scripts/save]', err);
    const status = err.message?.includes('not found') ? 404 : err.message?.includes('not allowed') || err.message?.includes('Invalid filename') ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// Delete a script
  router.delete('/agents/:id/skills/:name/scripts/:filename', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const result = parsers.deleteSkillScript(req.params.id, req.params.name, req.params.filename);
    console.log(`[api/agents/skills/scripts] Deleted "${req.params.filename}" from skill "${req.params.name}" for agent "${req.params.id}"`);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[api/agents/skills/scripts/delete]', err);
    const status = err.message?.includes('not found') ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});


  router.get('/sessions', db.authMiddleware, (req, res) => {
  try {
    // Read from the effective user's filesystem. parseScopeUserId enforces
    // admin-only impersonation; non-admin always self.
    const { parseScopeUserId } = require('../helpers/access-control.cjs');
    const targetUid = parseScopeUserId(req);
    const all = parsers.getAllSessions(targetUid);
    const { type, status, agentId } = req.query;
    let sessions = all;
    if (type) sessions = sessions.filter(s => s.type === type);
    if (status) sessions = sessions.filter(s => s.status === status);
    if (agentId) sessions = sessions.filter(s => s.agentId === agentId || s.agent === agentId);

    // Multi-tenant: getAllSessions(targetUid) already reads only from the
    // effective user's filesystem, so no further per-agent ownership filter is
    // needed. Each per-user gateway auto-spawns its own 'main' agent — those
    // sessions belong to that user (locally-scoped agent id) and must be
    // visible to them, even though 'main' as a *registry* entry stays
    // admin-private (see filterAgentsByOwner). The two scopes are different.

    res.json({ sessions, total: sessions.length });
  } catch (err) {
    console.error('[api/sessions]', err);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

/**
 * Collect all events for a session, including Claude CLI events when the session is
 * linked (or IS a claude-cli session). Returns events sorted oldest→newest by timestamp.
 */
function collectSessionEvents(sessionId, session) {
  const gatewayEvents = parsers.parseGatewaySessionEvents(sessionId) || [];
  let claudeCliEvents = [];

  // 1) Session has an explicit link → fetch by claude-cli UUID
  if (session?.claudeCliSessionId) {
    claudeCliEvents = parsers.parseClaudeCliSessionEvents(session.claudeCliSessionId) || [];
  }
  // 2) Session source is claude-cli (standalone) → the id IS a claude-cli UUID
  else if (session?.source === 'claude-cli') {
    claudeCliEvents = parsers.parseClaudeCliSessionEvents(sessionId) || [];
  }
  // 3) No session match yet — try both; whichever finds the id wins
  else if (!session) {
    claudeCliEvents = parsers.parseClaudeCliSessionEvents(sessionId) || [];
  }

  if (claudeCliEvents.length === 0) return gatewayEvents;
  if (gatewayEvents.length === 0) return claudeCliEvents;

  // Merge both streams, de-duplicate by (id || timestamp+role), sort by timestamp
  const seen = new Set();
  const combined = [];
  for (const e of [...gatewayEvents, ...claudeCliEvents]) {
    const key = e.id || `${e.timestamp}:${e.role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    combined.push(e);
  }
  combined.sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return ta - tb;
  });
  return combined;
}

/**
 * POST /api/sessions/:id/abort — generic session-level interrupt.
 *
 * Works for any session key (task-driven, chat-page, Telegram DM, cron-
 * triggered, etc.) as long as the OpenClaw Gateway knows about it. Calls
 * the gateway's chat.abort RPC to stop the in-flight generation while
 * keeping the session alive so follow-up messages can continue.
 *
 * If the session key maps to a known task, a task activity row is logged
 * so the abort shows up on the task board history as well.
 */
  router.post('/sessions/:id/abort', db.authMiddleware, async (req, res) => {
  try {
    const sessionKey = req.params.id;
    if (!sessionKey) return res.status(400).json({ error: 'sessionKey is required' });
    if (!gatewayProxy.isConnected) return res.status(503).json({ error: 'Gateway not connected' });

    let abortResult = null;
    try {
      abortResult = await gatewayProxy.chatAbort(sessionKey);
    } catch (rpcErr) {
      console.error('[api/sessions/abort] chat.abort RPC failed:', rpcErr.message);
      return res.status(502).json({ error: `Gateway abort failed: ${rpcErr.message}` });
    }

    // If this session is linked to a task, mirror the activity entry so the
    // board's task history stays in sync with what happened here.
    try {
      const linkedTasks = db.getAllTasks({}).filter(t => t.sessionId === sessionKey);
      const actor = req.user?.username ? `user:${req.user.username}` : 'user';
      const note = typeof req.body?.note === 'string' && req.body.note.trim()
        ? req.body.note.trim().slice(0, 500)
        : 'Interrupted from sessions view';
      for (const t of linkedTasks) {
        db.addTaskActivity({ taskId: t.id, type: 'comment', actor, note: `🛑 ${note}` });
      }
      if (linkedTasks.length) broadcastTasksUpdate();
    } catch (logErr) {
      console.warn('[api/sessions/abort] activity log failed:', logErr.message);
    }

    broadcast({ type: 'session:aborted', payload: { sessionKey } });
    res.json({ ok: true, sessionKey, abortResult });
  } catch (err) {
    console.error('[api/sessions/abort]', err);
    res.status(500).json({ error: err.message });
  }
});

  router.get('/sessions/:id', db.authMiddleware, (req, res) => {
  try {
    const sessions = parsers.getAllSessions();
    let session = sessions.find(s => s.id === req.params.id);

    let events = collectSessionEvents(req.params.id, session);

    // If the session isn't in the list yet (race condition during active writing:
    // sessions.json may not be flushed yet, or the file read got partial data),
    // try to load events directly — if a JSONL file exists, build a minimal session stub.
    if (!session && events.length > 0) {
      session = {
        id: req.params.id,
        name: 'Session',
        agent: 'unknown',
        agentName: 'Agent',
        status: 'active',
        messageCount: events.length,
        updatedAt: Date.now(),
      };
    }

    if (!session) return res.status(404).json({ error: 'Session not found' });

    let result = null;
    if (events.length === 0) {
      const numericId = req.params.id.match(/\d+/)?.[0];
      events = numericId ? parsers.parseOpenCodeEvents(numericId) : [];
      result = numericId ? parsers.parseOpenCodeResult(numericId) : null;
    }
    res.json({ ...session, events, result });
  } catch (err) {
    console.error('[api/sessions/:id]', err);
    res.status(500).json({ error: 'Failed to fetch session detail' });
  }
});

// Session messages (for chat view)
  router.get('/sessions/:agentId/:sessionId/messages', db.authMiddleware, (req, res) => {
  try {
    const sessions = parsers.getAllSessions();
    const session = sessions.find(s => s.id === req.params.sessionId);
    let events = collectSessionEvents(req.params.sessionId, session);
    if (events.length === 0) {
      const numericId = req.params.sessionId.match(/\d+/)?.[0];
      events = numericId ? parsers.parseOpenCodeEvents(numericId) : [];
    }
    const messages = events
      .filter(e => ['human', 'assistant', 'tool_use', 'tool_result'].includes(e.role))
      .map(e => ({
        role: e.role,
        content: typeof e.content === 'string' ? e.content : JSON.stringify(e.content),
        timestamp: e.timestamp,
        toolName: e.tool_name || e.toolName,
        toolId: e.tool_use_id || e.toolId,
        inputTokens: e.usage?.input_tokens,
        outputTokens: e.usage?.output_tokens,
        cost: e.cost,
        model: e.model,
      }));
    res.json({ messages });
  } catch (err) {
    console.error('[api/sessions/messages]', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});



  return router;
};
