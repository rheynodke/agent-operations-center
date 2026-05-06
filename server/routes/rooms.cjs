/**
 * routes/rooms.cjs
 *
 * Mission Rooms + Agent CRUD (provision, update, delete, rename, soul-inject).
 * Step 8c of server modularization.
 */
'use strict';

const { parseOwnerParam } = require('../helpers/access-control.cjs');

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
    // listMissionRoomsForUser already enforces baseline access (admin sees all,
    // regular users see global rooms + rooms in their projects/agents).
    // We then layer ?owner= scoping on top for per-user resources.
    const base = db.listMissionRoomsForUser(req);
    // Admin default = own rooms only. Cross-tenant monitoring requires explicit ?owner=all|<id>.
    const hasOwnerParam = req.query?.owner != null && req.query.owner !== '';
    const scope = hasOwnerParam ? parseOwnerParam(req) : 'me';
    const isAdmin = req.user?.role === 'admin';
    const uid = req.user?.userId;

    const rooms = base.filter((room) => {
      // HQ rooms are private to their owner. Admin can monitor cross-tenant
      // only with explicit ?owner=all|<id>; default 'me' restricts to own HQ.
      if (room.kind === 'global' && room.isHq) {
        if (room.ownerUserId === uid) return true;
        if (!isAdmin) return false;
        if (scope === 'all') return true;
        if (typeof scope === 'number') return room.ownerUserId === scope;
        return false;
      }
      // Other global rooms scoped by owner (cross-tenant isolation).
      if (room.kind === 'global') {
        const ownerId = room.createdBy ?? null;
        if (ownerId == null) return isAdmin;
        if (isAdmin) {
          if (scope === 'all') return true;
          if (scope === 'me') return ownerId === uid;
          if (typeof scope === 'number') return ownerId === scope;
          return true;
        }
        return ownerId === uid;
      }
      const ownerId = room.createdBy ?? null;
      if (ownerId == null) return isAdmin; // legacy unowned non-global → admin only
      if (isAdmin) {
        if (scope === 'all') return true;
        if (scope === 'me') return ownerId === uid;
        if (typeof scope === 'number') return ownerId === scope;
        return true;
      }
      return ownerId === uid;
    });

    res.json({ rooms: groupRoomsForClient(rooms) });
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
    // Always include the requesting user's Master Agent (per-user, isolated).
    // Admin's master is 'main'; other users have their own slug.
    const userId = req.user?.userId ?? null;
    const masterAgentId = userId != null ? (db.getUserMasterAgentId(userId) || 'main') : 'main';
    const room = db.createMissionRoom({
      kind, projectId, name, description,
      memberAgentIds: validateAccessibleAgentIds(req, [masterAgentId, ...memberAgentIds]),
      createdBy: userId,
      masterAgentId,
    });
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
    // Use the room owner's Master Agent (per-user, isolated). Admin's master is 'main'.
    const ownerId = room.createdBy ?? req.user?.userId ?? null;
    const masterAgentId = ownerId != null ? (db.getUserMasterAgentId(ownerId) || 'main') : 'main';
    const updated = db.updateMissionRoomMembers(
      room.id,
      validateAccessibleAgentIds(req, [masterAgentId, ...(req.body?.memberAgentIds || [])]),
      masterAgentId,
    );
    broadcast({ type: 'room:created', payload: { room: updated } });
    res.json({ room: updated });
  } catch (err) {
    console.error('[api/rooms/:id/members PATCH]', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Failed to update room members' });
  }
});

  router.delete('/rooms/:id', db.authMiddleware, (req, res) => {
  try {
    const room = withRoomAccess(req, res, req.params.id);
    if (!room) return;
    // System rooms (HQ) cannot be deleted.
    if (room.isSystem) {
      return res.status(409).json({ error: 'System rooms cannot be deleted.', code: 'ROOM_IS_SYSTEM' });
    }
    // Only owner or admin can delete.
    const isOwner = req.user?.role === 'admin' || Number(room.createdBy) === Number(req.user?.userId);
    if (!isOwner) return res.status(403).json({ error: 'Only the room owner can delete it.' });
    db.deleteMissionRoom(room.id);
    broadcast({ type: 'room:deleted', payload: { roomId: room.id } });
    res.json({ ok: true });
  } catch (err) {
    console.error('[api/rooms/:id DELETE]', err);
    res.status(500).json({ error: 'Failed to delete room' });
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

    // ── Slash commands ────────────────────────────────────────────────────
    if (body.startsWith('/')) {
      const parts = body.split(' ');
      const cmd = parts[0];
      const args = parts.slice(1).join(' ').trim();

      if (cmd === '/reset' || cmd === '/stop') {
        const roomTaskBridge = require('../hooks/room-task-bridge.cjs');
        const userId = Number(req.user?.userId ?? req.user?.id);
        const shouldAbort = cmd === '/stop';
        roomTaskBridge.resetAllRoomSessions(room.id, userId, shouldAbort);
        const sysMsg = db.createMissionMessage({
          roomId: room.id, authorType: 'system', authorId: 'system',
          authorName: 'System', body: cmd === '/stop' ? '🛑 Execution forcefully stopped.' : '🔄 Session reset — next message will start a fresh conversation.',
        });
        emitRoomMessage(sysMsg);
        
        if (cmd === '/stop') {
          broadcast({ type: 'room:stop', payload: { roomId: room.id } });
        }
        return res.status(201).json({ message: sysMsg });
      }

      if (cmd === '/status') {
        const agents = roomAgents(room);
        let md = `### 📋 Mission Room Status\n\n| Agent | Role | Status |\n| :--- | :--- | :--- |\n`;
        for (const a of agents) {
          md += `| ${a.emoji || '🤖'} **${a.name}** | ${a.role || 'Agent'} | Available |\n`;
        }
        const sysMsg = db.createMissionMessage({
          roomId: room.id, authorType: 'system', authorId: 'system',
          authorName: 'System', body: md,
        });
        emitRoomMessage(sysMsg);
        return res.status(201).json({ message: sysMsg });
      }

      if (cmd === '/connections') {
        // List each room agent + the connections they're assigned to.
        // Owner-scoped (room.createdBy) so we read the right tenant slice
        // of agent_connections under the composite-PK schema.
        const ownerId = room.createdBy ?? req.user?.userId ?? null;
        const agents = roomAgents(room);
        const allConns = db.getAllConnections();
        const connById = Object.fromEntries(allConns.map(c => [c.id, c]));

        let md = `### 🔌 Agent Connections\n\n`;
        if (!agents.length) {
          md += `_No agents in this room yet._`;
        } else {
          for (const a of agents) {
            const ids = ownerId != null ? db.getAgentConnectionIds(a.id, ownerId) : [];
            const rows = ids.map(cid => connById[cid]).filter(Boolean);
            md += `**${a.emoji || '🤖'} ${a.name}** _(${a.role || 'Agent'})_\n`;
            if (!rows.length) {
              md += `  - _no connections assigned_\n\n`;
            } else {
              for (const c of rows) {
                const status = c.enabled ? '🟢' : '⚪️';
                md += `  - ${status} \`${c.name}\` — ${c.type}\n`;
              }
              md += `\n`;
            }
          }
        }
        const sysMsg = db.createMissionMessage({
          roomId: room.id, authorType: 'system', authorId: 'system',
          authorName: 'System', body: md,
        });
        emitRoomMessage(sysMsg);
        return res.status(201).json({ message: sysMsg });
      }

      if (cmd === '/summary' || cmd === '/delegate') {
        const ownerId = room.createdBy ?? req.user?.userId ?? null;
        const masterAgentId = ownerId != null ? (db.getUserMasterAgentId(ownerId) || null) : null;
        
        if (!masterAgentId) {
          return res.status(400).json({ error: 'Master Agent not found. Cannot process command.' });
        }

        const mentions = resolveMentions(req, room, body, req.body?.mentions || []);
        const message = db.createMissionMessage({
          roomId: room.id,
          authorType: 'user',
          authorId: String(req.user?.userId ?? ''),
          authorName: req.user?.displayName || req.user?.username || 'User',
          body,
          mentions,
          meta: req.body?.meta || {},
        });
        emitRoomMessage(message);
        res.status(201).json({ message });
        
        // Forward to Master Agent with hidden system instruction
        const sysInstruct = cmd === '/summary' 
          ? `[SYSTEM INSTRUCTION: Generate a concise executive summary and list of actionable items based on the recent conversation in this room.]`
          : `[SYSTEM INSTRUCTION: The user is requesting delegation for the following task: "${args}". Analyze the team roles and explicitly mention (@) the best suited agent with clear instructions.]`;
        
        const forwardedMessage = { ...message, body: `${sysInstruct}\n\n${body}` };
        
        forwardRoomMentionToAgent(room, forwardedMessage, masterAgentId).catch((err) => {
          console.error(`[room-msg] command forward failed for room=${room.id}:`, err.message);
        });
        return;
      }
    }
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
    if (mentions.length === 0) {
      // No explicit @mention — auto-route to the room owner's master agent.
      // The master is the default responder / orchestrator for room conversations.
      const ownerId = room.createdBy ?? req.user?.userId ?? null;
      const masterAgentId = ownerId != null ? (db.getUserMasterAgentId(ownerId) || null) : null;
      if (masterAgentId && room.memberAgentIds?.includes(masterAgentId)) {
        console.log(`[room-msg] no mention — auto-routing to master=${masterAgentId} room=${room.id}`);
        forwardRoomMentionToAgent(room, message, masterAgentId).catch((err) => {
          console.error(`[room-msg] master auto-forward failed room=${room.id} master=${masterAgentId}:`, err.message);
        });
      } else {
        console.log(`[room-msg] no mentions and no master agent in room=${room.id}`);
      }
      return;
    }
    console.log(`[room-msg] forwarding mentions room=${room.id} agents=[${mentions.join(',')}] body="${body.slice(0, 60)}"`);
    for (const agentId of mentions) {
      forwardRoomMentionToAgent(room, message, agentId).catch((err) => {
        console.error(`[room-msg] forward failed for room=${room.id} agent=${agentId}:`, err.message);
      });
    }
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

  // POST /rooms/:id/reset-session — reset agent session(s) for this room
  router.post('/rooms/:id/reset-session', db.authMiddleware, (req, res) => {
    try {
      const room = withRoomAccess(req, res, req.params.id);
      if (!room) return;
      const roomTaskBridge = require('../hooks/room-task-bridge.cjs');
      const agentId = req.body?.agentId;
      if (agentId) {
        roomTaskBridge.resetRoomSession(room.id, agentId);
      } else {
        roomTaskBridge.resetAllRoomSessions(room.id);
      }
      res.json({ ok: true, reset: agentId || 'all' });
    } catch (err) {
      console.error('[api/rooms/:id/reset-session POST]', err);
      res.status(500).json({ error: 'Failed to reset session' });
    }
  });

// Provision a new agent — creates config, workspace, channel bindings, and SQLite profile
  router.post('/agents', db.authMiddleware, async (req, res) => {
  try {
    const userId = Number(req.user?.userId ?? req.user?.id);

    // Block sub-agent provisioning until the user has a Master Agent.
    // The dedicated POST /api/onboarding/master endpoint sets isMaster=true and
    // bypasses this check; regular /agents calls must come from a user with a Master.
    // Admin uid=1 is auto-backfilled at server startup so this never blocks them.
    if (!req.body?.isMaster && !db.getUserMasterAgentId(userId)) {
      return res.status(409).json({
        error: 'No Master Agent found. Please complete onboarding first.',
        code: 'MASTER_REQUIRED',
      });
    }

    const result = await parsers.provisionAgent(req.body, userId);
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
      provisionedBy: userId || null,
      role: req.body.adlcRole || null,
    });
    result.profileSaved = true;
    console.log(`[api/agents/provision] uid=${userId} agent="${result.agentId}" bindings=${result.bindings.length}`);

    // Add new sub-agent to the user's HQ room membership.
    try {
      const hqRoom = require('../lib/hq-room.cjs');
      hqRoom.addAgentToHq(db, userId, result.agentId);
    } catch (e) {
      console.warn(`[api/agents/provision] HQ membership add failed (non-fatal): ${e.message}`);
    }

    // Restart the appropriate gateway so heartbeat config for the new agent takes effect.
    //  - admin (uid=1): restart the external openclaw-gateway process
    //  - other users: restart their orchestrator-managed per-user gateway
    if (userId === 1) {
      restartGateway(`agent provisioned: ${result.agentId}`);
    } else {
      const orchestrator = require('../lib/gateway-orchestrator.cjs');
      try {
        await orchestrator.restartGateway(userId);
      } catch (e) {
        console.warn(`[api/agents/provision] orchestrator.restartGateway(${userId}) failed: ${e.message}`);
      }
    }
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
    const { parseScopeUserId } = require('../helpers/access-control.cjs');
    const targetUid = parseScopeUserId(req);
    const agents = parsers.parseAgentRegistry(targetUid);
    const agent = agents.find(a => a.id === req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    res.json(agent);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch agent' });
  }
});

// Agent detail (full profile with workspace files, soul, tools, etc.)
  router.get('/agents/:id/detail', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    // requireAgentOwnership already verified the caller owns this slug → scope by userId.
    const targetUid = Number(req.user.userId);
    const detail = parsers.getAgentDetail(req.params.id, targetUid);
    if (!detail) return res.status(404).json({ error: 'Agent not found' });
    // Enrich with SQLite profile (avatar preset, color, role, master flag)
    const profile = db.getAgentProfile(req.params.id, targetUid);
    if (profile) {
      detail.profile = {
        avatarPresetId: profile.avatar_preset_id || null,
        color: profile.color || null,
        role: profile.role || null,
        isMaster: profile.is_master === 1 || profile.is_master === true,
        provisionedBy: profile.provisioned_by ?? null,
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
      db.renameAgentProfile(req.params.id, result.agentId, Number(req.user.userId));
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
    // Remove profile from SQLite (scoped to caller's tenant)
    db.deleteAgentProfile(agentId, Number(req.user.userId));
    // Remove agent from HQ membership (throws if agentId is the master — expected).
    try {
      const hqRoom = require('../lib/hq-room.cjs');
      hqRoom.removeAgentFromHq(db, req.user.userId, agentId);
    } catch (e) {
      if (!/master/i.test(e.message)) {
        console.warn(`[api/agents/delete] HQ membership remove failed: ${e.message}`);
      }
    }
    console.log(`[api/agents] Deleted agent "${agentId}"`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[api/agents/delete]', err);
    res.status(err.message?.includes('not found') ? 404 : 500).json({ error: err.message });
  }
});

// ─── Room Artifacts ───────────────────────────────────────────────────────────

  router.post('/rooms/:id/artifacts', db.authMiddleware, (req, res) => {
    try {
      const { category, title, description, tags, content, fileName, mimeType } = req.body || {};
      if (!category || !title || content == null || !fileName) {
        return res.status(400).json({ error: 'category, title, content, and fileName are required' });
      }
      const result = parsers.createArtifact({
        roomId: req.params.id,
        category,
        title,
        description,
        tags,
        createdBy: req.user.username,
        content,
        fileName,
        mimeType,
      });
      res.status(201).json(result);
    } catch (err) {
      console.error('[api/rooms/:id/artifacts POST]', err);
      const status = err.message?.includes('Invalid category') ? 400 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  router.get('/rooms/:id/artifacts', db.authMiddleware, (req, res) => {
    try {
      const artifacts = parsers.listArtifacts({
        roomId: req.params.id,
        category: req.query.category,
        archived: req.query.archived === 'true',
      });
      res.json({ artifacts });
    } catch (err) {
      console.error('[api/rooms/:id/artifacts GET]', err);
      res.status(500).json({ error: 'Failed to list artifacts' });
    }
  });

  router.get('/rooms/:id/artifacts/:artifactId', db.authMiddleware, (req, res) => {
    try {
      const result = parsers.getArtifact(req.params.artifactId);
      if (!result) return res.status(404).json({ error: 'Artifact not found' });
      res.json(result);
    } catch (err) {
      console.error('[api/rooms/:id/artifacts/:artifactId GET]', err);
      res.status(500).json({ error: 'Failed to get artifact' });
    }
  });

  router.get('/rooms/:id/artifacts/:artifactId/versions/:versionNumber/content', db.authMiddleware, (req, res) => {
    try {
      const result = parsers.getArtifactContent(req.params.artifactId, Number(req.params.versionNumber));
      if (!result) return res.status(404).json({ error: 'Artifact version not found' });
      res.json(result);
    } catch (err) {
      console.error('[api/rooms/:id/artifacts/:artifactId/versions/:versionNumber/content GET]', err);
      res.status(500).json({ error: 'Failed to get artifact content' });
    }
  });

  router.post('/rooms/:id/artifacts/:artifactId/versions', db.authMiddleware, (req, res) => {
    try {
      const { content, fileName, mimeType } = req.body || {};
      if (content == null || !fileName) {
        return res.status(400).json({ error: 'content and fileName are required' });
      }
      const result = parsers.addArtifactVersion({
        artifactId: req.params.artifactId,
        content,
        fileName,
        mimeType,
        createdBy: req.user.username,
      });
      res.status(201).json(result);
    } catch (err) {
      console.error('[api/rooms/:id/artifacts/:artifactId/versions POST]', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.patch('/rooms/:id/artifacts/:artifactId/pin', db.authMiddleware, (req, res) => {
    try {
      const artifact = parsers.pinArtifact(req.params.artifactId, Boolean(req.body?.pinned));
      res.json({ artifact });
    } catch (err) {
      console.error('[api/rooms/:id/artifacts/:artifactId/pin PATCH]', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.patch('/rooms/:id/artifacts/:artifactId/archive', db.authMiddleware, (req, res) => {
    try {
      const artifact = parsers.archiveArtifact(req.params.artifactId, Boolean(req.body?.archived));
      res.json({ artifact });
    } catch (err) {
      console.error('[api/rooms/:id/artifacts/:artifactId/archive PATCH]', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/rooms/:id/artifacts/:artifactId', db.authMiddleware, (req, res) => {
    try {
      parsers.deleteArtifact(req.params.artifactId);
      res.json({ ok: true });
    } catch (err) {
      console.error('[api/rooms/:id/artifacts/:artifactId DELETE]', err);
      res.status(500).json({ error: err.message });
    }
  });

// ─── Room Context ─────────────────────────────────────────────────────────────

  router.get('/rooms/:id/context', db.authMiddleware, (req, res) => {
    try {
      const result = parsers.getRoomContext(req.params.id);
      res.json(result);
    } catch (err) {
      console.error('[api/rooms/:id/context GET]', err);
      res.status(500).json({ error: 'Failed to get room context' });
    }
  });

  router.post('/rooms/:id/context/append', db.authMiddleware, (req, res) => {
    try {
      const body = req.body?.body;
      if (!body) return res.status(400).json({ error: 'body is required' });
      const authorId = req.body?.authorId || req.user.username;
      const result = parsers.appendToContext(req.params.id, { authorId, body });
      res.json(result);
    } catch (err) {
      console.error('[api/rooms/:id/context/append POST]', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/rooms/:id/context', db.authMiddleware, (req, res) => {
    try {
      const isAdmin = req.user?.role === 'admin';
      if (!isAdmin) {
        // Check room ownership
        const room = db.getMissionRoomById(req.params.id);
        if (!room) return res.status(404).json({ error: 'Room not found' });
        if (Number(room.createdBy) !== Number(req.user.userId)) {
          return res.status(403).json({ error: 'Only the room owner or admin can clear context' });
        }
      }
      parsers.clearContext(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      console.error('[api/rooms/:id/context DELETE]', err);
      res.status(500).json({ error: err.message });
    }
  });

// ─── Agent Room State ─────────────────────────────────────────────────────────

  router.get('/rooms/:id/agents/:agentId/state', db.authMiddleware, (req, res) => {
    try {
      const result = parsers.getAgentRoomState(req.params.agentId, req.params.id);
      res.json(result);
    } catch (err) {
      console.error('[api/rooms/:id/agents/:agentId/state GET]', err);
      res.status(500).json({ error: 'Failed to get agent room state' });
    }
  });

  router.put('/rooms/:id/agents/:agentId/state', db.authMiddleware, (req, res) => {
    try {
      const state = req.body?.state;
      if (state == null || typeof state !== 'object' || Array.isArray(state)) {
        return res.status(400).json({ error: 'state must be an object' });
      }
      const result = parsers.setAgentRoomState(req.params.agentId, req.params.id, state);
      res.json(result);
    } catch (err) {
      console.error('[api/rooms/:id/agents/:agentId/state PUT]', err);
      res.status(500).json({ error: err.message });
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
