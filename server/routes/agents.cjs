/**
 * routes/agents.cjs
 *
 * Agent Workspace Browser + Agent Profile (SQLite) + Agent Channel Management +
 * DM Pairing Approval + Allow-from store + Discord guild allowlist.
 * Step 8b of server modularization.
 */
'use strict';

module.exports = function agentsRouter(deps) {
  const { db, parsers, vSave, syncBuiltinsForAgent } = deps;
  const router = require('express').Router();

// ─── Agent Workspace Browser (read-only file manager) ───────────────────────
// List immediate children of a directory inside the agent's workspace.
// Path-traversal guarded; symlinks refused. See server/lib/workspace-browser.cjs.
  router.get('/agents/:id/workspace/tree', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const rel = String(req.query.path || '');
    const result = parsers.workspaceBrowser.tree(req.params.id, rel);
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('[api/workspace/tree]', err);
    res.status(status).json({ error: err.message });
  }
});

// Auth wrapper that also accepts ?token=... so <img src> / <a href> can authenticate
// (browsers can't attach Authorization headers to native asset requests).
function authMiddlewareWithQueryToken(req, res, next) {
  if (req.headers.authorization) return db.authMiddleware(req, res, next);
  const t = req.query.token;
  if (t) {
    req.headers.authorization = `Bearer ${t}`;
    return db.authMiddleware(req, res, next);
  }
  return res.status(401).json({ error: 'Missing token' });
}

// Read a file inside the agent's workspace.
//   - text files (.md/.json/.sh/...) under 5 MB → JSON { mode: 'text', content, ... }
//   - everything else (or oversize text) → streamed with proper Content-Type
//     so <img src=...> works directly and the user can download.
  router.get('/agents/:id/workspace/file', authMiddlewareWithQueryToken, (req, res) => {
  try {
    const rel = String(req.query.path || '');
    if (!rel) return res.status(400).json({ error: 'path query param required' });
    const wantStream = req.query.stream === '1';
    const meta = parsers.workspaceBrowser.readFileMeta(req.params.id, rel);

    // For binaries (or when client explicitly asks for stream), pipe the file.
    if (wantStream || meta.mode !== 'text') {
      if (meta.size > meta.binaryCap) return res.status(413).json({ error: 'File too large to stream' });
      res.setHeader('Content-Type', meta.contentType);
      res.setHeader('Content-Length', String(meta.size));
      res.setHeader('Cache-Control', 'private, max-age=60');
      // For non-image binary, suggest download with original filename
      if (!meta.isImage && req.query.download === '1') {
        res.setHeader('Content-Disposition', `attachment; filename="${require('path').basename(rel)}"`);
      }
      require('fs').createReadStream(meta.filePath).pipe(res);
      return;
    }

    // Small text → JSON
    if (meta.size > meta.textCap) {
      return res.json({
        mode: 'text', oversize: true,
        size: meta.size, mtime: meta.mtime, ext: meta.ext, contentType: meta.contentType,
        content: null,
      });
    }
    const content = require('fs').readFileSync(meta.filePath, 'utf-8');
    res.json({
      mode: 'text', oversize: false,
      size: meta.size, mtime: meta.mtime, ext: meta.ext, contentType: meta.contentType,
      content,
    });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('[api/workspace/file]', err);
    res.status(status).json({ error: err.message });
  }
});

// ─── Agent Name Availability Check ──────────────────────────────────────────
// Used by the onboarding wizard + provisioning modal to validate the chosen
// agent name BEFORE we hit provisionAgent (which would fail late with a 409).
// Scope: per-user openclaw.json agents.list (cross-tenant isolation already
// keeps slugs apart in the filesystem).
  router.get('/agent-availability', db.authMiddleware, (req, res) => {
    try {
      const rawName = String(req.query?.name || '').trim();
      const rawId   = String(req.query?.id   || '').trim();
      if (!rawName && !rawId) return res.json({ available: false, reason: 'name or id is required' });

      const slug = rawId
        ? rawId.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30)
        : rawName.toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9-]/g, '')
            .replace(/-+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 30);
      if (!slug) return res.json({ available: false, slug: '', reason: 'empty slug — use letters or numbers' });
      if (!/^[a-z0-9][a-z0-9-]{0,29}$/.test(slug)) {
        return res.json({ available: false, slug, reason: 'Agent ID harus huruf kecil/angka/strip, mulai dengan huruf atau angka' });
      }

      const userId = Number(req.user?.userId ?? req.user?.id);
      const list = parsers.parseAgentRegistry(userId) || [];
      const slugTaken = list.some(a => a.id === slug);
      const nameTaken = rawName ? list.some(a => String(a.name || '').trim().toLowerCase() === rawName.toLowerCase()) : false;

      if (slugTaken) return res.json({ available: false, slug, reason: `Agent ID "${slug}" sudah dipakai` });
      if (nameTaken) return res.json({ available: false, slug, reason: `Nama "${rawName}" sudah dipakai oleh agent lain` });
      return res.json({ available: true, slug });
    } catch (err) {
      console.error('[api/agents/check-name]', err);
      res.status(500).json({ error: err.message || 'check-name failed' });
    }
  });

// ─── Agent Profile (SQLite) ──────────────────────────────────────────────────

// Get agent profile (dashboard-specific metadata)
  router.get('/agents/:id/profile', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const profile = db.getAgentProfile(req.params.id, Number(req.user.userId));
    res.json({ profile: profile || null });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch agent profile' });
  }
});

// Update agent profile metadata (color, description, tags, notes, ADLC role)
  router.patch('/agents/:id/profile', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const { color, description, tags, notes, emoji, displayName, avatarPresetId, role } = req.body;
    const profile = db.upsertAgentProfile({
      agentId: req.params.id,
      displayName, emoji, avatarPresetId, color, description, tags, notes, role,
      provisionedBy: req.user?.userId || null,
    });
    res.json({ ok: true, profile });
  } catch (err) {
    console.error('[api/agents/profile]', err);
    res.status(500).json({ error: err.message });
  }
});

// Upload agent avatar (base64 encoded image)
  router.put('/agents/:id/avatar', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const { avatarData, avatarMime } = req.body;
    if (!avatarData) return res.status(400).json({ error: 'avatarData is required' });
    const allowedMimes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    if (avatarMime && !allowedMimes.includes(avatarMime)) {
      return res.status(400).json({ error: 'Invalid image MIME type' });
    }
    // Basic size check: base64 ~1.37x raw size; limit to ~2MB raw → ~2.7MB base64
    if (avatarData.length > 2_800_000) {
      return res.status(413).json({ error: 'Avatar image too large (max ~2MB)' });
    }
    db.upsertAgentProfile({ agentId: req.params.id, avatarData, avatarMime: avatarMime || 'image/png', provisionedBy: req.user?.userId });
    console.log(`[api/agents/avatar] Avatar updated for agent "${req.params.id}"`);
    res.json({ ok: true, agentId: req.params.id });
  } catch (err) {
    console.error('[api/agents/avatar]', err);
    res.status(500).json({ error: err.message });
  }
});

// Get agent avatar (serves as data URL)
  router.get('/agents/:id/avatar', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const profile = db.getAgentProfile(req.params.id, Number(req.user.userId));
    if (!profile?.avatar_data) return res.status(404).json({ error: 'No avatar' });
    res.json({ avatarData: profile.avatar_data, avatarMime: profile.avatar_mime || 'image/png' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch avatar' });
  }
});



// List all skills visible to an agent
  router.get('/agents/:id/skills', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const skills = parsers.getAgentSkills(req.params.id);
    res.json({ skills });
  } catch (err) {
    console.error('[api/agents/skills]', err);
    const status = err.message?.includes('not found') ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// Get a skill's SKILL.md content
  router.get('/agents/:id/skills/:name/file', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const result = parsers.getSkillFile(req.params.id, req.params.name);
    res.json(result);
  } catch (err) {
    console.error('[api/agents/skills/file]', err);
    const status = err.message?.includes('not found') ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// Save a skill's SKILL.md content
  router.put('/agents/:id/skills/:name/file', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const { content } = req.body;
    if (content === undefined) return res.status(400).json({ error: 'content is required' });
    const result = parsers.saveSkillFile(req.params.id, req.params.name, content);
    console.log(`[api/agents/skills] Saved skill "${req.params.name}" for agent "${req.params.id}"`);
    vSave(`skill:${req.params.id}:${req.params.name}`, content, req);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[api/agents/skills/file/put]', err);
    const status = err.message?.includes('not found') ? 404 : err.message?.includes('not editable') ? 403 : 500;
    res.status(status).json({ error: err.message });
  }
});

// Create a new skill
  router.post('/agents/:id/skills', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const { name, scope, content } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!content) return res.status(400).json({ error: 'content is required' });
    const result = parsers.createSkill(req.params.id, name, scope || 'workspace', content);
    console.log(`[api/agents/skills] Created skill "${name}" (scope: ${scope || 'workspace'}) for agent "${req.params.id}"`);
    syncBuiltinsForAgent(req.params.id);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[api/agents/skills/create]', err);
    const status = err.message?.includes('not found') ? 404 : err.message?.includes('already exists') ? 409 : 500;
    res.status(status).json({ error: err.message });
  }
});

// Toggle skill enabled/disabled FOR THIS AGENT ONLY (via agents.list[].skills allowlist)
  router.patch('/agents/:id/skills/:name/toggle', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const { enabled } = req.body;
    if (enabled === undefined) return res.status(400).json({ error: 'enabled is required' });
    const result = parsers.toggleAgentSkill(req.params.id, req.params.name, !!enabled);
    console.log(`[api/agents/skills] Toggled skill "${req.params.name}" for agent "${req.params.id}" => enabled: ${enabled}`);
    syncBuiltinsForAgent(req.params.id);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[api/agents/skills/toggle]', err);
    const status = err.message?.includes('not found') ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// Delete an agent's workspace skill (only 'workspace' source allowed)
  router.delete('/agents/:id/skills/:name', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const result = parsers.deleteAgentSkill(req.params.id, req.params.name);
    console.log(`[api/agents/skills] Deleted skill "${req.params.name}" for agent "${req.params.id}"`);
    syncBuiltinsForAgent(req.params.id);
    res.json(result);
  } catch (err) {
    console.error('[api/agents/skills/delete]', err);
    const status = err.message?.includes('not found') ? 404 : err.message?.includes('Cannot delete') ? 403 : 500;
    res.status(status).json({ error: err.message });
  }
});

// Get built-in tools for a specific agent (with enabled/disabled state)
  router.get('/agents/:id/tools', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const tools = parsers.getAgentTools(req.params.id);
    res.json({ tools });
  } catch (err) {
    console.error('[api/agents/tools]', err);
    const status = err.message?.includes('not found') ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// Composite capabilities — for workflow editor UI. Returns skills + enabled
// built-in tools + assigned connections + custom scripts in one call so the
// agent capability card can render without 4 round-trips.
  router.get('/agents/:id/capabilities', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const id = req.params.id;
    const ownerId = Number(req.user.userId);
    const profile = db.getAgentProfile(id, ownerId);
    const skills = parsers.getAgentSkills(id) || [];
    const tools = (parsers.getAgentTools(id) || []).filter((t) => t.enabled !== false);
    const connIds = db.getAgentConnectionIds(id, ownerId);
    const connections = connIds.map((cid) => db.getConnection(cid)).filter(Boolean);
    let customTools = { agent: [], shared: [] };
    try { customTools = parsers.listAgentCustomTools(id); } catch {}
    res.json({
      agentId: id,
      displayName: profile?.display_name || id,
      role: profile?.role || null,
      emoji: profile?.emoji || null,
      skills: skills.map((s) => ({
        name: s.name,
        description: s.description || null,
        enabled: s.enabled !== false,
        source: s.source || 'local',
      })),
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description || null,
        category: t.category || 'builtin',
      })),
      customTools: {
        agent: (customTools.agent || []).map((t) => ({ name: t.filename, description: t.description || null, enabled: t.enabled })),
        shared: (customTools.shared || []).map((t) => ({ name: t.filename, description: t.description || null, enabled: t.enabled })),
      },
      connections: connections.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        enabled: c.enabled,
      })),
    });
  } catch (err) {
    console.error('[api/agents/capabilities]', err);
    const status = err.message?.includes('not found') ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// Toggle a built-in tool ON or OFF for a specific agent (via agents.list[].tools.deny)
  router.patch('/agents/:id/tools/:name/toggle', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const { enabled } = req.body;
    if (enabled === undefined) return res.status(400).json({ error: 'enabled is required' });
    const result = parsers.toggleAgentTool(req.params.id, req.params.name, !!enabled);
    console.log(`[api/agents/tools] Toggled tool "${req.params.name}" for agent "${req.params.id}" => enabled: ${enabled}`);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[api/agents/tools/toggle]', err);
    const status = err.message?.includes('not found') ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// ─── Agent Channel Management ────────────────────────────────────────────────

// Get all channel bindings for an agent
  router.get('/agents/:id/channels', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const result = parsers.getAgentChannels(req.params.id);
    res.json(result);
  } catch (err) {
    console.error('[api/agents/channels/get]', err);
    res.status(err.message?.includes('not found') ? 404 : 500).json({ error: err.message });
  }
});

// Add a new channel binding for an agent
  router.post('/agents/:id/channels', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const result = parsers.addAgentChannel(req.params.id, req.body);
    console.log(`[api/agents/channels] Added ${req.body.type} channel for agent "${req.params.id}"`);
    res.status(201).json(result);
  } catch (err) {
    console.error('[api/agents/channels/add]', err);
    const code = err.message?.includes('not found') ? 404
      : err.message?.includes('required') || err.message?.includes('invalid') ? 400 : 500;
    res.status(code).json({ error: err.message });
  }
});

// Update an existing channel binding (dmPolicy, streaming, botToken, allowFrom)
  router.patch('/agents/:id/channels/:channelType/:accountId', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const result = parsers.updateAgentChannel(req.params.id, req.params.channelType, req.params.accountId, req.body);
    console.log(`[api/agents/channels] Updated ${req.params.channelType}/${req.params.accountId} for agent "${req.params.id}"`);
    res.json(result);
  } catch (err) {
    console.error('[api/agents/channels/update]', err);
    const code = err.message?.includes('not found') ? 404
      : err.message?.includes('invalid') || err.message?.includes('required') || err.message?.includes('empty') ? 400 : 500;
    res.status(code).json({ error: err.message });
  }
});

// Remove a channel binding from an agent
  router.delete('/agents/:id/channels/:channelType/:accountId', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const result = parsers.removeAgentChannel(req.params.id, req.params.channelType, req.params.accountId);
    console.log(`[api/agents/channels] Removed ${req.params.channelType}/${req.params.accountId} from agent "${req.params.id}"`);
    res.json(result);
  } catch (err) {
    console.error('[api/agents/channels/remove]', err);
    res.status(err.message?.includes('not found') ? 404 : 500).json({ error: err.message });
  }
});

// ─── DM Pairing Approval ─────────────────────────────────────────────────────

// Resolve the per-tenant home owner for an agent. Falls back to the
// authenticated user when the agent has no DB-tracked owner (legacy admin).
function _userIdForAgent(req, agentId) {
  // Always prefer the authenticated user — under composite-PK multi-tenancy
  // the same slug can exist under multiple owners. Auth identity wins.
  const callerId = Number(req.user?.userId ?? req.user?.id) || null;
  if (callerId) return callerId;
  if (!agentId) return null;
  const owner = db.getAgentOwner(agentId); // single-owner only; null if ambiguous
  return owner != null ? Number(owner) : null;
}

// List pending pairing requests for a specific agent (across all channels)
  router.get('/agents/:id/pairing', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const userId = _userIdForAgent(req, req.params.id);
    const result = parsers.listAllPairingRequests(req.params.id, userId);
    res.json(result);
  } catch (err) {
    console.error('[api/agents/pairing/list]', err);
    res.status(500).json({ error: err.message });
  }
});

// List pending pairing requests for a specific channel (optionally filtered by account)
  router.get('/pairing/:channel', db.authMiddleware, (req, res) => {
  try {
    const acc = req.query.account || undefined;
    const userId = _userIdForAgent(req, acc);
    const requests = parsers.listPairingRequests(req.params.channel, acc, userId);
    res.json({ channel: req.params.channel, requests });
  } catch (err) {
    console.error('[api/pairing/list]', err);
    const code = err.message?.includes('Unsupported') ? 400 : 500;
    res.status(code).json({ error: err.message });
  }
});

// Approve a pairing code
  router.post('/pairing/:channel/approve', db.authMiddleware, async (req, res) => {
  try {
    const { code, accountId } = req.body;
    if (!code) return res.status(400).json({ error: 'Pairing code is required' });

    // Ownership gate: pairing approval modifies the agent's allowFrom file.
    // accountId in the body is the agent slug ("default" → "main" by convention).
    const agentSlug = accountId && accountId !== 'default' ? accountId : 'main';
    if (!db.userOwnsAgent(req, agentSlug)) {
      return res.status(403).json({ error: 'You do not have permission to modify this agent' });
    }

    const userId = _userIdForAgent(req, agentSlug);
    const result = await parsers.approvePairingCode(req.params.channel, code, accountId || undefined, userId);
    if (result.ok) {
      console.log(`[api/pairing] Approved ${req.params.channel} pairing code ${code}${accountId ? ` (account: ${accountId})` : ''} uid=${userId}`);
    }
    res.json(result);
  } catch (err) {
    console.error('[api/pairing/approve]', err);
    const code = err.message?.includes('Unsupported') || err.message?.includes('required') ? 400 : 500;
    res.status(code).json({ error: err.message });
  }
});

// Reject (delete) a pending pairing request
  router.post('/pairing/:channel/reject', db.authMiddleware, (req, res) => {
  try {
    const { code, accountId } = req.body;
    if (!code) return res.status(400).json({ error: 'Pairing code is required' });

    const agentSlug = accountId && accountId !== 'default' ? accountId : 'main';
    if (!db.userOwnsAgent(req, agentSlug)) {
      return res.status(403).json({ error: 'You do not have permission to modify this agent' });
    }

    const userId = _userIdForAgent(req, agentSlug);
    const result = parsers.rejectPairingCode(req.params.channel, code, accountId || undefined, userId);
    if (result.ok) {
      console.log(`[api/pairing] Rejected ${req.params.channel} pairing code ${code}${accountId ? ` (account: ${accountId})` : ''}`);
    }
    res.json(result);
  } catch (err) {
    console.error('[api/pairing/reject]', err);
    const code = err.message?.includes('Unsupported') || err.message?.includes('required') ? 400 : 500;
    res.status(code).json({ error: err.message });
  }
});

// ─── Allow-from store management ─────────────────────────────────────────────

// Build the (channel, accountId) bindings list for an agent based on the
// channels currently bound to it. Each entry maps to one allowFrom file.
function resolveAgentAllowFromBindings(agentId) {
  const channels = parsers.getAgentChannels(agentId);
  const bindings = [];
  for (const t of channels.telegram || []) {
    bindings.push({ channel: 'telegram', accountId: t.accountId });
  }
  for (const w of channels.whatsapp || []) {
    bindings.push({ channel: 'whatsapp', accountId: w.accountId });
  }
  for (const d of channels.discord || []) {
    bindings.push({ channel: 'discord', accountId: d.accountId });
  }
  return bindings;
}

// GET /api/agents/:id/allowfrom — list allowFrom entries grouped by binding
  router.get('/agents/:id/allowfrom', db.authMiddleware, (req, res) => {
  try {
    const userId = _userIdForAgent(req, req.params.id);
    const bindings = resolveAgentAllowFromBindings(req.params.id);
    const result = bindings.map(b => ({
      channel: b.channel,
      accountId: b.accountId,
      entries: parsers.listAllowFromEntries(b.channel, b.accountId, userId),
    }));
    res.json({ bindings: result });
  } catch (err) {
    console.error('[api/agents/allowfrom/list]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/agents/:id/allowfrom — add an entry
// body: { channel, accountId, entry }
  router.post('/agents/:id/allowfrom', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const { channel, accountId, entry } = req.body;
    if (!channel || !entry) return res.status(400).json({ error: 'channel and entry are required' });
    const userId = _userIdForAgent(req, req.params.id);
    const result = parsers.addAllowFromEntry(channel, accountId || undefined, entry, userId);
    res.json(result);
  } catch (err) {
    console.error('[api/agents/allowfrom/add]', err);
    const code = err.message?.includes('Unsupported') || err.message?.includes('required') ? 400 : 500;
    res.status(code).json({ error: err.message });
  }
});

// DELETE /api/agents/:id/allowfrom — remove an entry
// body: { channel, accountId, entry }
  router.delete('/agents/:id/allowfrom', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const { channel, accountId, entry } = req.body;
    if (!channel || !entry) return res.status(400).json({ error: 'channel and entry are required' });
    const userId = _userIdForAgent(req, req.params.id);
    const result = parsers.removeAllowFromEntry(channel, accountId || undefined, entry, userId);
    res.json(result);
  } catch (err) {
    console.error('[api/agents/allowfrom/remove]', err);
    const code = err.message?.includes('Unsupported') || err.message?.includes('required') ? 400 : 500;
    res.status(code).json({ error: err.message });
  }
});

// ─── Discord guild allowlist management ──────────────────────────────────────

// GET /api/agents/:id/discord/guilds — list configured guilds for the agent's discord account
  router.get('/agents/:id/discord/guilds', db.authMiddleware, (req, res) => {
  try {
    const result = parsers.listAgentDiscordGuilds(req.params.id, parsers.getAgentChannels);
    res.json(result);
  } catch (err) {
    console.error('[api/agents/discord/guilds/list]', err);
    const code = err.message?.includes('no Discord binding') ? 404 : 500;
    res.status(code).json({ error: err.message });
  }
});

// PUT /api/agents/:id/discord/guilds/:guildId — upsert a guild entry
// body: { label?: string, requireMention?: boolean, users?: string[] }
  router.put('/agents/:id/discord/guilds/:guildId', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const { label, requireMention, users } = req.body || {};
    const result = parsers.upsertAgentDiscordGuild(
      req.params.id,
      req.params.guildId,
      { label, requireMention, users },
      parsers.getAgentChannels,
    );
    res.json(result);
  } catch (err) {
    console.error('[api/agents/discord/guilds/upsert]', err);
    const msg = err.message || '';
    const code = /must be a numeric|is required|not configured|no Discord binding/i.test(msg) ? 400 : 500;
    res.status(code).json({ error: msg });
  }
});

// DELETE /api/agents/:id/discord/guilds/:guildId — remove a guild entry
  router.delete('/agents/:id/discord/guilds/:guildId', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const result = parsers.removeAgentDiscordGuild(
      req.params.id,
      req.params.guildId,
      parsers.getAgentChannels,
    );
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  } catch (err) {
    console.error('[api/agents/discord/guilds/remove]', err);
    const code = err.message?.includes('no Discord binding') ? 404 : 500;
    res.status(code).json({ error: err.message });
  }
});

// ─── WhatsApp group allowlist + activation management ────────────────────────

  router.get('/agents/:id/whatsapp/groups', db.authMiddleware, (req, res) => {
    try {
      const result = parsers.listAgentWhatsAppGroups(req.params.id, parsers.getAgentChannels);
      res.json(result);
    } catch (err) {
      console.error('[api/agents/whatsapp/groups/list]', err);
      const code = err.message?.includes('no WhatsApp binding') ? 404 : 500;
      res.status(code).json({ error: err.message });
    }
  });

  // Body: { label?, requireMention? }
  router.put('/agents/:id/whatsapp/groups/:jid', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
    try {
      const { label, requireMention } = req.body || {};
      const result = parsers.upsertAgentWhatsAppGroup(
        req.params.id,
        decodeURIComponent(req.params.jid),
        { label, requireMention },
        parsers.getAgentChannels,
      );
      res.json(result);
    } catch (err) {
      console.error('[api/agents/whatsapp/groups/upsert]', err);
      const msg = err.message || '';
      const code = /must be|is required|not configured|no WhatsApp binding/i.test(msg) ? 400 : 500;
      res.status(code).json({ error: msg });
    }
  });

  router.delete('/agents/:id/whatsapp/groups/:jid', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
    try {
      const result = parsers.removeAgentWhatsAppGroup(
        req.params.id,
        decodeURIComponent(req.params.jid),
        parsers.getAgentChannels,
      );
      if (!result.ok) return res.status(404).json(result);
      res.json(result);
    } catch (err) {
      console.error('[api/agents/whatsapp/groups/remove]', err);
      const code = err.message?.includes('no WhatsApp binding') ? 404 : 500;
      res.status(code).json({ error: err.message });
    }
  });

  // Body: { groupPolicy?, groupAllowFrom?, historyLimit?, mentionPatterns? }
  router.put('/agents/:id/whatsapp/account', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
    try {
      const { groupPolicy, groupAllowFrom, historyLimit, mentionPatterns } = req.body || {};
      const result = parsers.updateAgentWhatsAppSettings(
        req.params.id,
        { groupPolicy, groupAllowFrom, historyLimit, mentionPatterns },
        parsers.getAgentChannels,
      );
      res.json(result);
    } catch (err) {
      console.error('[api/agents/whatsapp/account/update]', err);
      const msg = err.message || '';
      const code = /must be|is required|not configured|no WhatsApp binding|Invalid regex/i.test(msg) ? 400 : 500;
      res.status(code).json({ error: msg });
    }
  });

  // Passive group discovery: scans gateway.log for inbound group messages
  // belonging to this account's bot E.164. Only shows groups that have sent
  // at least one message to the bot.
  router.get('/agents/:id/whatsapp/groups/seen', db.authMiddleware, (req, res) => {
    try {
      const channels = parsers.getAgentChannels(req.params.id);
      const wa = channels.whatsapp || [];
      if (wa.length === 0) {
        return res.status(404).json({ error: `Agent "${req.params.id}" has no WhatsApp binding` });
      }
      const accountId = (wa.find(d => d.accountId === req.params.id) || wa[0]).accountId;
      const groups = parsers.listSeenWhatsAppGroupsForAgent(req.params.id, accountId);
      res.json({ accountId, groups });
    } catch (err) {
      console.error('[api/agents/whatsapp/groups/seen]', err);
      res.status(500).json({ error: err.message });
    }
  });



  return router;
};
