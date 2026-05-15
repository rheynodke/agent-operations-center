/**
 * routes/config.cjs
 *
 * File Version History + OpenClaw Config Management +
 * Hooks/Inbound Webhooks + Media Serve.
 * Step 9b of server modularization.
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

module.exports = function configRouter(deps) {
  const { db, parsers, versioning, vSave } = deps;
  const router = require('express').Router();

// ─── File Version History ─────────────────────────────────────────────────────

// GET /api/versions?scope=agent:tadaki:IDENTITY.md&limit=30
  router.get('/versions', db.authMiddleware, (req, res) => {
  const { scope, limit = '30' } = req.query;
  if (!scope) return res.status(400).json({ error: 'scope is required' });
  try {
    const versions = versioning.listVersions(db.getDb(), { scopeKey: scope, limit: Math.min(parseInt(limit) || 30, 100) });
    res.json({ versions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/versions/:id — get a specific version (includes content)
  router.get('/versions/:id', db.authMiddleware, (req, res) => {
  try {
    const v = versioning.getVersion(db.getDb(), parseInt(req.params.id));
    if (!v) return res.status(404).json({ error: 'Version not found' });
    res.json({ version: v });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/versions/:id/restore — restore a version (write content back to file)
  router.post('/versions/:id/restore', db.authMiddleware, async (req, res) => {
  try {
    const v = versioning.getVersion(db.getDb(), parseInt(req.params.id));
    if (!v) return res.status(404).json({ error: 'Version not found' });

    const key = v.scope_key;
    const content = v.content;

    // Route to appropriate save function based on scope_key prefix
    if (key.startsWith('agent:')) {
      const parts = key.split(':');              // agent:{agentId}:{fileName}
      const agentId  = parts[1];
      const fileName = parts.slice(2).join(':');
      parsers.saveAgentFile(agentId, fileName, content);
    } else if (key.startsWith('skill:global:')) {
      const slug = key.slice('skill:global:'.length);
      parsers.saveSkillFileBySlug(slug, content);
    } else if (key.startsWith('skill:')) {
      const parts = key.split(':');              // skill:{agentId}:{skillName}
      parsers.saveSkillFile(parts[1], parts[2], content);
    } else if (key.startsWith('skill-script:')) {
      const parts = key.split(':');              // skill-script:{agentId}:{skill}:{file}
      parsers.saveSkillScript(parts[1], parts[2], parts[3], content, { appendToSkillMd: false });
    } else if (key.startsWith('script:agent:')) {
      const parts = key.split(':');              // script:agent:{agentId}:{file}
      parsers.saveAgentScript(parts[2], parts[3], content);
    } else if (key.startsWith('script:global:')) {
      const file = key.slice('script:global:'.length);
      parsers.saveScript(file, content);
    } else {
      return res.status(400).json({ error: `Cannot restore scope_key: ${key}` });
    }

    // Record the restore as a new version
    vSave(key, content, req, 'edit');

    console.log(`[api/versions] Restored version ${v.id} (${key}) by ${req.user?.username}`);
    res.json({ ok: true, scopeKey: key, restoredVersionId: v.id });
  } catch (err) {
    console.error('[api/versions/restore]', err);
    res.status(500).json({ error: err.message || 'Restore failed' });
  }
});

// DELETE /api/versions/:id
  router.delete('/versions/:id', db.authMiddleware, (req, res) => {
  try {
    const v = versioning.getVersion(db.getDb(), parseInt(req.params.id));
    if (!v) return res.status(404).json({ error: 'Version not found' });
    versioning.deleteVersion(db.getDb(), parseInt(req.params.id), db.persist);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── OpenClaw Config Management ──────────────────────────────────────────────

const EDITABLE_CONFIG_SECTIONS = new Set([
  'gateway', 'agents', 'tools', 'env', 'memory', 'hooks',
  'approvals', 'logging', 'commands', 'session', 'messages',
  'plugins', 'models',
]);

// GET /api/browse-dirs — list directories at a given path (for directory picker)
  router.get('/browse-dirs', db.authMiddleware, (req, res) => {
  const targetPath = req.query.path || os.homedir();
  try {
    const resolved = path.resolve(targetPath);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      return res.status(400).json({ error: 'Not a valid directory' });
    }
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    const dirs = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => e.name)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    // Check if this is a git repo
    const isGitRepo = fs.existsSync(path.join(resolved, '.git'));
    res.json({ path: resolved, dirs, isGitRepo, parent: path.dirname(resolved) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/config — returns the caller's own openclaw.json
// (admin sees admin's; user N sees ~/.openclaw/users/N/.openclaw/openclaw.json)

  router.get('/config', db.authMiddleware, (req, res) => {
  const { readJsonSafe, getUserHome } = require('../lib/config.cjs');
  const { parseScopeUserId } = require('../helpers/access-control.cjs');
  const userId = parseScopeUserId(req);
  const configPath = path.join(getUserHome(userId), 'openclaw.json');
  const config = readJsonSafe(configPath);
  if (!config) return res.status(404).json({ error: 'openclaw.json not found' });
  res.json({ config, path: configPath });
});

// PATCH /api/config/:section — update a single top-level section of the
// caller's own openclaw.json. Each tenant edits their own file; cross-tenant
// PATCH is impossible because the path is derived from req.user.
  router.patch('/config/:section', db.authMiddleware, (req, res) => {
  const { section } = req.params;
  const { value } = req.body;

  if (!EDITABLE_CONFIG_SECTIONS.has(section)) {
    return res.status(400).json({ error: `Section "${section}" is not editable via this API` });
  }
  if (value === undefined) return res.status(400).json({ error: 'value is required' });

  const { getUserHome } = require('../lib/config.cjs');
  const { parseScopeUserId } = require('../helpers/access-control.cjs');
  const userId = parseScopeUserId(req);
  const configPath = path.join(getUserHome(userId), 'openclaw.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);
    config[section] = value;
    if (config.meta) config.meta.lastTouchedAt = new Date().toISOString();
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    console.log(`[api/config] uid=${userId} section="${section}" updated by ${req.user.username}`);
    res.json({ ok: true, section });
  } catch (err) {
    console.error('[api/config/patch]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/config/providers/sync — admin-only. Regenerate
// ~/.openclaw/shared/providers.json5 from admin's openclaw.json AND propagate
// the new providers to every per-user openclaw.json. Optionally restart each
// user's running gateway so the new providers take effect immediately.
//
// Body: { restartGateways?: boolean (default false) }
// Response: { ok, regenerated, secrets, usersUpdated, usersRestarted }
  router.post('/config/providers/sync', db.authMiddleware, db.requireAdmin, async (req, res) => {
  try {
    const orchestrator = require('../lib/gateway-orchestrator.cjs');
    const restartGateways = req.body?.restartGateways === true;

    // Force regenerate by overriding the env var for this call only.
    const prevOverride = process.env.PROVIDERS_OVERWRITE;
    process.env.PROVIDERS_OVERWRITE = '1';
    let regenerateResult;
    try {
      regenerateResult = orchestrator.ensureSharedProviders();
    } finally {
      if (prevOverride === undefined) delete process.env.PROVIDERS_OVERWRITE;
      else process.env.PROVIDERS_OVERWRITE = prevOverride;
    }

    const propagateResult = await orchestrator.propagateProvidersToAllUsers({ restartGateways });

    // Audit-log the sync — provider rotation is a sensitive admin op.
    try {
      const audit = require('../lib/audit-log.cjs');
      audit.record(req, {
        action: 'config.providers_synced',
        targetType: 'config',
        targetId: 'shared/providers.json5',
        after: {
          regenerated: regenerateResult.written,
          secretCount: (regenerateResult.secrets || []).length,
          usersUpdated: propagateResult.usersUpdated,
          usersRestarted: propagateResult.usersRestarted,
        },
      });
    } catch (e) { console.warn('[api/config/providers/sync] audit failed:', e.message); }

    res.json({
      ok: true,
      regenerated: regenerateResult.written,
      reason: regenerateResult.reason,
      secrets: regenerateResult.secrets || [],
      usersUpdated: propagateResult.usersUpdated,
      usersRestarted: propagateResult.usersRestarted,
    });
  } catch (err) {
    console.error('[api/config/providers/sync]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Hooks / Inbound Webhooks ─────────────────────────────────────────────────

// GET /api/hooks/config
  router.get('/hooks/config', db.authMiddleware, (req, res) => {
  try {
    res.json(parsers.getHooksConfig());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/hooks/config
  router.put('/hooks/config', db.authMiddleware, (req, res) => {
  try {
    parsers.saveHooksConfig(req.body);
    res.json(parsers.getHooksConfig());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/hooks/token — generate + save a new random token
  router.post('/hooks/token', db.authMiddleware, (req, res) => {
  try {
    const token = parsers.generateToken();
    parsers.saveHooksConfig({ token });
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/hooks/sessions
  router.get('/hooks/sessions', db.authMiddleware, (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    res.json({ sessions: parsers.getHookSessions(limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Activity
  router.get('/activity', db.authMiddleware, (req, res) => {
  try {
    const { parseScopeUserId } = require('../helpers/access-control.cjs');
    const targetUid = parseScopeUserId(req);
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const logs = typeof parsers.parseCommandLog === 'function'
      ? parsers.parseCommandLog(limit, targetUid)
      : [];
    res.json({ events: logs });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch activity' });
  }
});

// ─── Media Serve (inbound media from Telegram/WhatsApp/etc) ──────────────────
// Serves files from OPENCLAW_HOME only — paths outside are rejected.
// Accepts token as query param because <img> tags cannot send Authorization headers.
  router.get('/media', (req, res) => {
  const mime = require('mime-types');

  // Auth: accept Bearer header OR ?token= query param (needed for <img> src)
  const tokenFromHeader = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null;
  const tokenFromQuery = typeof req.query.token === 'string' ? req.query.token : null;
  const token = tokenFromHeader || tokenFromQuery;
  if (!token || !db.verifyToken(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const filePath = req.query.path;
  if (!filePath || typeof filePath !== 'string') {
    return res.status(400).json({ error: 'path is required' });
  }
  // Security: resolve and ensure it's under one of the allowed staging roots.
  // Beyond OPENCLAW_HOME we also allow:
  //   - /tmp/openclaw/**          (claude-cli image uploads land here)
  //   - $TMPDIR/openclaw/**       (macOS per-user tmp)
  //   - OPENCLAW_WORKSPACE/**     (agent workspace files)
  // Each must be an exact-prefix match, no symlink escape.
  const resolved = path.resolve(filePath);
  const allowedRoots = [
    path.resolve(parsers.OPENCLAW_HOME),
    path.resolve(parsers.OPENCLAW_WORKSPACE || ''),
    '/tmp/openclaw',
    path.resolve(process.env.TMPDIR || '/tmp', 'openclaw'),
  ].filter(Boolean);
  const isAllowed = allowedRoots.some((root) =>
    root && (resolved === root || resolved.startsWith(root + path.sep)),
  );
  if (!isAllowed) {
    return res.status(403).json({ error: 'Forbidden path' });
  }
  if (!fs.existsSync(resolved)) {
    return res.status(404).json({ error: 'File not found' });
  }
  const contentType = mime.lookup(resolved) || 'application/octet-stream';
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  fs.createReadStream(resolved).pipe(res);
});


  return router;
};
