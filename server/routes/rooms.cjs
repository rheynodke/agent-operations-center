/**
 * routes/rooms.cjs
 *
 * Mission Rooms + Agent CRUD (provision, update, delete, rename, soul-inject).
 * Step 8c of server modularization.
 */
'use strict';

module.exports = function roomsRouter(deps) {
  const {
    db, parsers, broadcast,
    emitRoomMessage, canAccessAgent, getAgentDisplayName,
    restartGateway,
    groupRoomsForClient, withRoomAccess, validateAccessibleAgentIds,
    roomAgents, resolveMentions, forwardRoomMentionToAgent, vSave,
  } = deps;
  const router = require('express').Router();

// ─── Mission Rooms ────────────────────────────────────────────────────────────

  router.get('/rooms', db.authMiddleware, (req, res) => {
  try {
    res.json({ rooms: groupRoomsForClient(db.listMissionRoomsForUser(req)) });
  } catch (err) {
    console.error('[api/rooms GET]', err);
    res.status(500).json({ error: 'Failed to fetch rooms' });
  }
});

  router.get('/rooms/:id', db.authMiddleware, (req, res) => {
  try {
    const room = withRoomAccess(req, res, req.params.id);
    if (!room) return;
    res.json({ room, agents: roomAgents(room) });
  } catch (err) {
    console.error('[api/rooms/:id GET]', err);
    res.status(500).json({ error: 'Failed to fetch room' });
  }
});

  router.post('/rooms', db.authMiddleware, (req, res) => {
  try {
    const { kind = 'global', projectId = null, name, description, memberAgentIds = [] } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
    if (kind !== 'global' && kind !== 'project') return res.status(400).json({ error: "kind must be 'global' or 'project'" });
    if (kind === 'project') {
      if (!projectId) return res.status(400).json({ error: 'projectId is required for project rooms' });
      if (!db.userOwnsProject(req, projectId)) return res.status(403).json({ error: 'You do not have access to this project' });
    }
    const room = db.createMissionRoom({ kind, projectId, name, description, memberAgentIds: validateAccessibleAgentIds(req, ['main', ...memberAgentIds]), createdBy: req.user?.userId ?? null });
    broadcast({ type: 'room:created', payload: { room } });
    res.status(201).json({ room });
  } catch (err) {
    console.error('[api/rooms POST]', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Failed to create room' });
  }
});

  router.patch('/rooms/:id/members', db.authMiddleware, (req, res) => {
  try {
    const room = withRoomAccess(req, res, req.params.id);
    if (!room) return;
    const updated = db.updateMissionRoomMembers(room.id, validateAccessibleAgentIds(req, ['main', ...(req.body?.memberAgentIds || [])]));
    broadcast({ type: 'room:created', payload: { room: updated } });
    res.json({ room: updated });
  } catch (err) {
    console.error('[api/rooms/:id/members PATCH]', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Failed to update room members' });
  }
});

  router.get('/projects/:id/room', db.authMiddleware, (req, res) => {
  try {
    if (!db.userOwnsProject(req, req.params.id)) return res.status(403).json({ error: 'You do not have access to this project' });
    const room = db.ensureProjectDefaultRoom(req.params.id, req.user?.userId ?? null);
    if (!room) return res.status(404).json({ error: 'Project not found' });
    res.json({ room });
  } catch (err) {
    console.error('[api/projects/:id/room GET]', err);
    res.status(500).json({ error: 'Failed to fetch project room' });
  }
});

  router.get('/rooms/:id/messages', db.authMiddleware, (req, res) => {
  try {
    const room = withRoomAccess(req, res, req.params.id);
    if (!room) return;
    res.json({ messages: db.listMissionMessages(room.id, { before: req.query.before, limit: req.query.limit }) });
  } catch (err) {
    console.error('[api/rooms/:id/messages GET]', err);
    res.status(500).json({ error: 'Failed to fetch room messages' });
  }
});

  router.post('/rooms/:id/messages', db.authMiddleware, (req, res) => {
  try {
    const room = withRoomAccess(req, res, req.params.id);
    if (!room) return;
    const body = String(req.body?.body || '').trim();
    if (!body) return res.status(400).json({ error: 'body is required' });
    const mentions = resolveMentions(req, room, body, req.body?.mentions || []);
    const meta = req.body?.meta || {};
    const message = db.createMissionMessage({
      roomId: room.id,
      authorType: 'user',
      authorId: String(req.user?.userId ?? ''),
      authorName: req.user?.displayName || req.user?.username || 'User',
      body,
      mentions,
      meta,
    });
    emitRoomMessage(message);
    res.status(201).json({ message });
    for (const agentId of mentions) forwardRoomMentionToAgent(room, message, agentId).catch(() => {});
  } catch (err) {
    console.error('[api/rooms/:id/messages POST]', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Failed to post room message' });
  }
});

  router.post('/rooms/:id/messages/agent', db.authMiddleware, (req, res) => {
  try {
    if (req.user?.role !== 'agent') return res.status(403).json({ error: 'Agent service token required' });
    const room = withRoomAccess(req, res, req.params.id);
    if (!room) return;
    const agentId = String(req.body?.agentId || '').trim();
    const body = String(req.body?.body || '').trim();
    const relatedTaskId = req.body?.relatedTaskId ? String(req.body.relatedTaskId).trim() : null;
    if (!agentId) return res.status(400).json({ error: 'agentId is required' });
    if (!body) return res.status(400).json({ error: 'body is required' });
    if (!room.memberAgentIds.includes(agentId) || !canAccessAgent(req, agentId)) return res.status(403).json({ error: 'Agent cannot post to this room' });
    const message = db.createMissionMessage({ roomId: room.id, authorType: 'agent', authorId: agentId, authorName: getAgentDisplayName(agentId), body, relatedTaskId });
    emitRoomMessage(message);
    res.status(201).json({ message });
  } catch (err) {
    console.error('[api/rooms/:id/messages/agent POST]', err);
    res.status(500).json({ error: 'Failed to post agent room message' });
  }
});

// Provision a new agent — creates config, workspace, channel bindings, and SQLite profile
  router.post('/agents', db.authMiddleware, (req, res) => {
  try {
    const result = parsers.provisionAgent(req.body, req.user?.userId);
    // Save profile to SQLite (including ADLC role if template was used)
    db.upsertAgentProfile({
      agentId: result.agentId,
      displayName: result.agentName,
      emoji: req.body.emoji,
      avatarPresetId: req.body.avatarPresetId || null,
      color: req.body.color || null,
      description: req.body.description || null,
      tags: req.body.tags || [],
      notes: null,
      provisionedBy: req.user?.userId || null,
      role: req.body.adlcRole || null,
    });
    result.profileSaved = true;
    console.log(`[api/agents/provision] Provisioned agent "${result.agentId}" with ${result.bindings.length} binding(s)`);

    // Restart gateway so heartbeat config for the new agent takes effect
    restartGateway(`agent provisioned: ${result.agentId}`);
    result.gatewayRestarted = true;

    res.status(201).json(result);
  } catch (err) {
    console.error('[api/agents/provision]', err);
    const code = err.message?.includes('already exists') ? 409
      : err.message?.includes('invalid') ? 400
      : err.message?.includes('required') ? 400 : 500;
    res.status(code).json({ error: err.message });
  }
});

// Apply research output standard to all agents (idempotent)
  router.post('/agents/soul-standard', db.authMiddleware, (req, res) => {
  try {
    const { agentIds } = req.body || {};
    const config = require('../lib/config.cjs').readJsonSafe(require('path').join(require('../lib/config.cjs').OPENCLAW_HOME, 'openclaw.json'));
    const allAgents = config?.agents?.list || [];
    const targets = agentIds?.length
      ? allAgents.filter(a => agentIds.includes(a.id))
      : allAgents;
    const results = targets.map(a => parsers.injectSoulStandard(a.id));
    res.json({ ok: true, results });
  } catch (err) {
    console.error('[api/agents/soul-standard]', err);
    res.status(500).json({ error: err.message });
  }
});

  router.get('/agents/:id', db.authMiddleware, (req, res) => {
  try {
    const agents = parsers.parseAgentRegistry();
    const agent = agents.find(a => a.id === req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    res.json(agent);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch agent' });
  }
});

// Agent detail (full profile with workspace files, soul, tools, etc.)
  router.get('/agents/:id/detail', db.authMiddleware, (req, res) => {
  try {
    const detail = parsers.getAgentDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: 'Agent not found' });
    // Enrich with SQLite profile (avatar preset, color)
    const profile = db.getAgentProfile(req.params.id);
    if (profile) {
      detail.profile = {
        avatarPresetId: profile.avatar_preset_id || null,
        color: profile.color || null,
      };
    }
    res.json(detail);
  } catch (err) {
    console.error('[api/agents/detail]', err);
    res.status(500).json({ error: 'Failed to fetch agent detail' });
  }
});

// Update agent config + workspace files
  router.patch('/agents/:id', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const result = parsers.updateAgent(req.params.id, req.body);
    // If agent was renamed, migrate the SQLite profile to the new ID
    if (result.agentId && result.agentId !== req.params.id) {
      db.renameAgentProfile(req.params.id, result.agentId);
      console.log(`[api/agents] Migrated profile "${req.params.id}" → "${result.agentId}"`);
    }
    console.log(`[api/agents] Updated agent "${req.params.id}":`, result.changed);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[api/agents/update]', err);
    res.status(err.message?.includes('not found') ? 404 : 500).json({ error: err.message });
  }
});

  router.delete('/agents/:id', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const agentId = req.params.id;
    parsers.deleteAgent(agentId);
    // Remove profile from SQLite
    db.deleteAgentProfile(agentId);
    console.log(`[api/agents] Deleted agent "${agentId}"`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[api/agents/delete]', err);
    res.status(err.message?.includes('not found') ? 404 : 500).json({ error: err.message });
  }
});

// Inject research output standard into a single agent's SOUL.md (idempotent)
  router.post('/agents/:id/soul-standard', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const result = parsers.injectSoulStandard(req.params.id);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

  router.get('/agents/:id/sessions', db.authMiddleware, (req, res) => {
  try {
    const sessions = parsers.getAllSessions().filter(s => s.agent === req.params.id || s.agentId === req.params.id);
    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch agent sessions' });
  }
});

// Read a single workspace file (IDENTITY.md, SOUL.md, etc.)
  router.get('/agents/:id/files/:filename', db.authMiddleware, (req, res) => {
  try {
    const result = parsers.getAgentFile(req.params.id, req.params.filename);
    res.json(result);
  } catch (err) {
    console.error('[api/agents/files/get]', err);
    const status = err.message?.includes('not found') ? 404 : err.message?.includes('not allowed') ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// Save / overwrite a single workspace file
  router.put('/agents/:id/files/:filename', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const { content } = req.body;
    if (content === undefined) return res.status(400).json({ error: 'content is required' });
    const result = parsers.saveAgentFile(req.params.id, req.params.filename, content);
    console.log(`[api/agents/files] Saved ${result.filename} for agent "${req.params.id}"`);
    vSave(`agent:${req.params.id}:${result.filename}`, content, req);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[api/agents/files/put]', err);
    const status = err.message?.includes('not found') ? 404 : err.message?.includes('not allowed') ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});



  return router;
};
