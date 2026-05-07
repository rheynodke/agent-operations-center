require('dotenv').config();
const http = require('http');
const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const parsers = require('./lib/index.cjs'); // modular barrel — replaces parsers.cjs
const { LiveFeedWatcher, WatcherPool } = require('./lib/watchers.cjs');
const db = require('./lib/db.cjs');
const { gatewayProxy } = require('./lib/gateway-ws.cjs');
const aiLib = require('./lib/ai.cjs');
const versioning = require('./lib/versioning.cjs');
const integrations = require('./lib/integrations/index.cjs');
const attachmentsLib = require('./lib/attachments.cjs');
const outputsLib = require('./lib/outputs.cjs');
const metrics = require('./lib/metrics.cjs');
const mcpPool = require('./lib/connections/mcp.cjs');
const mcpOauth = require('./lib/connections/mcp-oauth.cjs');
const composio = require('./lib/connections/composio.cjs');
const pipelines = require('./lib/pipelines/index.cjs');
const workflowRuns = require('./lib/pipelines/runs.cjs');
const aocMasterInstaller = require('./lib/aoc-master/installer.cjs');
const projectGit = require('./lib/projects/git-ops.cjs');
const projectWs = require('./lib/projects/workspace-ops.cjs');
const orchestrator = require('./lib/gateway-orchestrator.cjs');
// Wire gateway into the runs module so agent steps can dispatch real sessions.
try { workflowRuns.setGatewayProxy(require('./lib/gateway-ws.cjs').gatewayProxy); } catch (e) {
  console.warn('[runs] gateway wiring failed:', e.message);
}
const multer = require('multer');
const { AGENTS_DIR } = require('./lib/config.cjs');

// ─── Extracted modules (Step 0 — server modularization) ──────────────────────
const { applyMiddleware } = require('./bootstrap/middleware.cjs');
const wsBootstrap = require('./bootstrap/websocket.cjs');
const accessControl = require('./helpers/access-control.cjs');
const agentContext = require('./helpers/agent-context.cjs');
const { loadAllJSONLMessagesForTask: _loadAllJSONLMessagesForTask } = require('./helpers/task-jsonl.cjs');
const { createVSave } = require('./helpers/versioning-helper.cjs');

// Config object passed to helpers that need OPENCLAW_HOME, AGENTS_DIR, etc.
const _helperConfig = require('./lib/config.cjs');
// Deps bundle for agent-context helpers
const _agentContextDeps = { parsers, db, config: _helperConfig };

const uploadAttachments = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: attachmentsLib.MAX_SIZE, files: 5 },
});

// ─── Delegating wrappers (call extracted modules, keep local names for compatibility) ──
function loadAllJSONLMessagesForTask(agentId, taskId) {
  return _loadAllJSONLMessagesForTask(agentId, taskId, _helperConfig);
}

const vSave = createVSave({ versioning, db });

// Task dispatch wrapper (must be defined before router mounts that reference it)
const taskDispatchHook = require('./hooks/task-dispatch.cjs');
function dispatchTaskToAgent(task, opts = {}, userId) {
  if (userId == null) {
    return Promise.reject(new Error('dispatchTaskToAgent (server/index.cjs): userId required'));
  }
  const _deps = { db, outputsLib, projectWs, parsers, broadcastTasksUpdate, userId };
  return taskDispatchHook.dispatchTaskToAgent(task, opts, _deps);
}


const PORT = parseInt(process.env.PORT || '18800', 10);
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
const server = http.createServer(app);

// ─── Middleware (extracted to bootstrap/middleware.cjs) ────────────────────────
applyMiddleware(app);

// ─── Routes: Auth + Users + Invitations (Step 2) ─────────────────────────────
app.use('/api', require('./routes/auth.cjs')({ db }));
app.use('/api', require('./routes/auth-oauth.cjs')({ db }));

// ─── Routes: Onboarding (Master Agent) — mounted late so it can pass
// `restartGateway` into the factory (defined further below).
let onboardingRouter;
// Idempotent backfill runs in start() after initDatabase()

// ─── Access-control wrappers (delegate to helpers/access-control.cjs) ─────────
function checkTaskAccess(req, taskId) {
  return accessControl.checkTaskAccess(req, taskId, db);
}

async function checkCronAccess(req, jobId) {
  return accessControl.checkCronAccess(req, jobId, db, parsers);
}

function checkSkillInstallTarget(req, target, agentId) {
  return accessControl.checkSkillInstallTarget(req, target, agentId, db);
}

// ─── Routes: Health + Overview (Step 1) ───────────────────────────────────────
app.use('/api', require('./routes/health.cjs')({ db, parsers }));

// ─── Gateway + AI + Metrics routes (Step 5) ──────────────────────────────────
const gatewayRouterMod = require('./routes/gateway.cjs');
app.use('/api', gatewayRouterMod({ db, parsers, aiLib, metrics }));
const { restartGateway } = gatewayRouterMod;

// Mount onboarding router now that restartGateway is available
// broadcast is defined further down; thunk so closure resolves at call time.
onboardingRouter = require('./routes/onboarding.cjs')({
  db, restartGateway,
  broadcast: (event) => broadcast(event),
});
app.use('/api', onboardingRouter);

// ─── Routes: Master Agent ─────────────────────────────────────────────────────
const { gatewayPool } = require('./lib/gateway-ws.cjs');
app.use('/api', require('./routes/master.cjs')({ db, gatewayPool }));

// ─── Broadcast (delegated to bootstrap/websocket.cjs) ─────────────────────────
function broadcast(event) {
  wsBootstrap.broadcast(event);
}

function broadcastTasksUpdate() {
  wsBootstrap.broadcastTasksUpdate(db);
}

function emitRoomMessage(message) {
  wsBootstrap.emitRoomMessage(message);
}

function getAgentDisplayName(agentId) {
  if (!agentId) return null;
  try {
    // SQLite profile is the cross-tenant source of truth for display names.
    // Admin's enriched registry only contains admin agents.
    const profile = db.getAgentProfile(agentId);
    if (profile?.displayName) return profile.displayName;
    if (profile?.display_name) return profile.display_name;
    const agent = getEnrichedAgents().find(a => a.id === agentId);
    return agent?.name || agent?.displayName || agentId;
  } catch (_) {
    return agentId;
  }
}

function emitTaskRoomSystemMessage(task, body) {
  try {
    if (!task?.projectId) return null;
    const room = db.ensureProjectDefaultRoom(task.projectId, null);
    if (!room) return null;
    const message = db.createMissionMessage({
      roomId: room.id,
      authorType: 'system',
      authorId: 'task-lifecycle',
      authorName: 'Task Board',
      body,
      relatedTaskId: task.id,
      meta: { taskId: task.id, status: task.status, projectId: task.projectId },
    });
    emitRoomMessage(message);
    return message;
  } catch (err) {
    console.warn('[mission-rooms] task lifecycle emit failed:', err.message);
    return null;
  }
}

// ─── Agent context wrappers (delegate to helpers/agent-context.cjs) ───────────

function readMdField(content, fieldName) {
  return agentContext.readMdField(content, fieldName);
}

function readAgentVibe(agent) {
  return agentContext.readAgentVibe(agent, _helperConfig);
}

function getEnrichedAgents(userId) {
  return agentContext.getEnrichedAgents(_agentContextDeps, userId);
}

function canAccessAgent(req, agentId) {
  return accessControl.canAccessAgent(req, agentId, db);
}

function validateAccessibleAgentIds(req, ids = []) {
  return accessControl.validateAccessibleAgentIds(req, ids, db);
}

function canAccessRoom(req, room) {
  return accessControl.canAccessRoom(req, room, db);
}

function groupRoomsForClient(rooms) {
  return accessControl.groupRoomsForClient(rooms);
}

function withRoomAccess(req, res, roomId) {
  return accessControl.withRoomAccess(req, res, roomId, db);
}

function roomAgents(room) {
  return agentContext.roomAgents(room, _agentContextDeps);
}

function resolveMentions(req, room, body, explicitMentions = []) {
  return agentContext.resolveMentions(req, room, body, explicitMentions, _agentContextDeps, accessControl);
}

// ─── Room ↔ Agent bridge (delegate to hooks/room-task-bridge.cjs, Step 3) ────
const roomTaskBridge = require('./hooks/room-task-bridge.cjs');

// Singleton delegation maps — shared with auto-reply listener below
const _delegationDepth = roomTaskBridge.delegationDepth;
const _delegationByAgentRoom = roomTaskBridge.delegationByAgentRoom;

// Bound deps for the bridge (userId resolved per-room via room.createdBy)
const _bridgeDeps = {
  db, getEnrichedAgents, getAgentDisplayName,
  // userId is resolved dynamically from room.createdBy in room-task-bridge.cjs
  forwardFn: null,
};

async function forwardRoomMentionToAgent(room, message, agentId) {
  console.log(`[index] forwardRoomMentionToAgent room=${room.id} agent=${agentId} room.createdBy=${room.createdBy}`);
  return roomTaskBridge.forwardRoomMentionToAgent(room, message, agentId, _bridgeDeps);
}

// Wire forwardFn now that the wrapper exists
_bridgeDeps.forwardFn = forwardRoomMentionToAgent;

function forwardAgentMentionChain(room, agentMsg, sourceAgentId) {
  return roomTaskBridge.forwardAgentMentionChain(room, agentMsg, sourceAgentId, _bridgeDeps);
}


// Agents — per-user
app.get('/api/agents', db.authMiddleware, (req, res) => {
  try {
    const targetUid = accessControl.parseScopeUserId(req);
    const allAgents = getEnrichedAgents(targetUid);
    // Owner-scoped by default for everyone (admin too) — explicit ?owner=all|<id>
    // is required for cross-tenant viewing.
    const explicit = req.query?.owner ? accessControl.parseOwnerParam(req) : 'me';
    const filtered = accessControl.filterAgentsByOwner(
      allAgents, req.user, explicit, db.getAgentOwner
    );
    res.json({ agents: filtered });
  } catch (err) {
    console.error('[api/agents]', err);
    res.status(500).json({ error: 'Failed to fetch agents' });
  }
});


// ─── Mission Rooms + Agent CRUD (extracted to routes/rooms.cjs, Step 8c) ──
app.use('/api', require('./routes/rooms.cjs')({
  db, parsers, broadcast, emitRoomMessage, canAccessAgent, getAgentDisplayName, restartGateway,
  groupRoomsForClient, withRoomAccess, validateAccessibleAgentIds,
  roomAgents, resolveMentions, forwardRoomMentionToAgent, vSave,
}));

// ─── Agents (extracted to routes/agents.cjs, Step 8b) ──────────────────────
app.use('/api', require('./routes/agents.cjs')({ db, parsers, vSave }));

// ─── Browser Harness (extracted to routes/browser-harness.cjs, Step 6c) ────
app.use('/api', require('./routes/browser-harness.cjs')({ db, parsers }));


// ─── Skills + Sessions (extracted to routes/skills.cjs, Step 7c) ──────────
app.use('/api', require('./routes/skills.cjs')({ db, parsers, broadcast, checkSkillInstallTarget, vSave, broadcastTasksUpdate }));


// ─── Tasks + Attachments + Outputs + Comments (extracted to routes/tasks.cjs, Step 8a) ──
app.use('/api', require('./routes/tasks.cjs')({
  db, parsers, broadcast, broadcastTasksUpdate,
  outputsLib, vSave,
  checkTaskAccess, dispatchTaskToAgent,
  emitTaskRoomSystemMessage, getAgentDisplayName,
  attachmentsLib, integrations, uploadAttachments, projectWs,
}));

// ─── Connections + MCP OAuth (extracted to routes/connections.cjs, Step 6) ──
app.use('/api', require('./routes/connections.cjs')({ db, parsers, broadcast, mcpOauth, composio }));


// ─── Composio + MCP + Agent-Connections (extracted to routes/composio.cjs, Step 7a) ──
app.use('/api', require('./routes/composio.cjs')({ db, parsers, broadcast, composio, mcpPool, mcpOauth }));

// ─── Pipelines/Missions/Playbooks routes — REMOVED in Phase D ───────────────
// DB tables (pipelines, pipeline_runs, pipeline_steps, pipeline_artifacts,
// pipeline_templates) intentionally retained for potential reuse in Phase E
// (ADLC blueprint generator). No HTTP surface today.

// ─── MCP + Agent-Connections + FS Browser (extracted to routes/mcp-agents.cjs, Step 9a) ──
// Note: syncBuiltinsForAgent is hoistable (function declaration) but defined further
// down — passed via thunk so the closure resolves at call time.
app.use('/api', require('./routes/mcp-agents.cjs')({
  db, parsers, mcpPool, composio,
  syncBuiltinsForAgent: (agentId) => syncBuiltinsForAgent(agentId),
  // restartGateway is the admin's external-gateway signaller; per-user gateways
  // are bounced via orchestrator inside the route handler when ownerId !== 1.
  restartGateway: typeof restartGateway === 'function'
    ? (reason) => restartGateway(reason)
    : null,
}));

// ─── Projects + Integrations + Epics + Dependencies + Memory (extracted to routes/projects.cjs, Step 7b) ──
app.use('/api', require('./routes/projects.cjs')({ db, parsers, projectGit, projectWs, vSave, integrations }));


// ─── Config + File History + Hooks + Media (extracted to routes/config.cjs, Step 9b) ──
app.use('/api', require('./routes/config.cjs')({ db, parsers, versioning, vSave }));


// ─── Chat API (extracted to routes/chat.cjs, Step 9c) ──────────────────────
app.use('/api', require('./routes/chat.cjs')({ db, parsers, gatewayProxy, loadAllJSONLMessagesForTask }));
app.use('/api', require('./routes/role-templates.cjs')({ db, parsers }));

// ─── Serve Vite build in prod ─────────────────────────────────────────────────
const distDir = path.join(__dirname, '..', 'dist');
app.use(express.static(distDir, { etag: false }));
app.get('/{*path}', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(distDir, 'index.html'));
});

// ─── WebSocket (init via bootstrap/websocket.cjs) ──────────────────────────────
const wss = wsBootstrap.init();

// One-shot startup sweep on first gateway connection
let startupSweepDone = false;
gatewayProxy.addListener((event) => {
  if (event.type === 'gateway:connected' && !startupSweepDone) {
    startupSweepDone = true;
    sweepPendingTasks().catch(err => console.warn('[startup-sweep]', err.message));
  }
});

// ── Phase 3: Auto-reply — post agent responses back to room ────────────────
// When a room-triggered session completes (chat:done), fetch the agent's
// last response and post it as a room message. This removes the dependency
// on agents manually running `mission_room.sh`.
const _roomAutoReplyInFlight = new Set();
gatewayPool.addGlobalListener((event) => {
  if (event.type !== 'chat:done') return;
  const sessionKey = event.payload?.sessionKey;
  if (!sessionKey) return;

  const roomInfo = db.getRoomForSession(sessionKey);
  if (!roomInfo) return; // Not a room-triggered session

  // Dedup guard — prevent concurrent auto-replies for the same session
  if (_roomAutoReplyInFlight.has(sessionKey)) return;
  _roomAutoReplyInFlight.add(sessionKey);

  // Wait for JSONL to flush before fetching the final response
  setTimeout(async () => {
    try {
      const room = db.getMissionRoom(roomInfo.roomId);
      const roomOwnerId = room?.createdBy ?? 1;
      const gw = gatewayPool.forUser(roomOwnerId);
      const historyResult = await gw.chatHistory(sessionKey, 8000);
      const messages = historyResult.messages || [];
      // Find the last assistant message
      const lastAssistant = [...messages].reverse().find(m =>
        m.role === 'assistant' && (m.text || m.content)
      );
      if (!lastAssistant) return;

      // Extract plain text from the assistant response
      let responseText = '';
      if (typeof lastAssistant.text === 'string') {
        responseText = lastAssistant.text;
      } else if (typeof lastAssistant.content === 'string') {
        responseText = lastAssistant.content;
      } else if (Array.isArray(lastAssistant.content)) {
        responseText = lastAssistant.content
          .filter(b => b.type === 'text')
          .map(b => b.text || '')
          .join('');
      }
      responseText = responseText.trim();

      if (!responseText) return;
      if (responseText === 'NO_REPLY') return;

      // Dedup: check if the agent already posted to the room (via mission_room.sh)
      // by checking the most recent messages
      const recentRoomMsgs = db.listMissionMessages(roomInfo.roomId, { limit: 5 });
      const alreadyPosted = recentRoomMsgs.some(m =>
        m.authorType === 'agent' &&
        m.authorId === roomInfo.agentId &&
        // Check if message body matches (or is a prefix/suffix)
        (m.body === responseText || responseText.includes(m.body) || m.body.includes(responseText))
      );
      if (alreadyPosted) {
        console.log(`[room-auto-reply] Agent ${roomInfo.agentId} already posted to room ${roomInfo.roomId}, skipping`);
        return;
      }

      // Post the agent's response to the room
      const roomMsg = db.createMissionMessage({
        roomId: roomInfo.roomId,
        authorType: 'agent',
        authorId: roomInfo.agentId,
        authorName: getAgentDisplayName(roomInfo.agentId),
        body: responseText,
      });
      emitRoomMessage(roomMsg);

      // Inherit delegation depth: if this agent was itself forwarded-to via
      // a delegation, its reply continues the chain at the recorded depth.
      // Otherwise it's depth 0 (replying directly to a user mention).
      const inheritKey = `${roomInfo.agentId}:${roomInfo.roomId}`;
      const inheritedDepth = _delegationByAgentRoom.get(inheritKey) ?? 0;
      _delegationDepth.set(roomMsg.id, inheritedDepth);
      _delegationByAgentRoom.delete(inheritKey);

      console.log(`[room-auto-reply] Agent ${roomInfo.agentId} replied to room ${roomInfo.roomId} depth=${inheritedDepth}`);

      // Delegation: if the agent's reply mentions other agents in the room,
      // forward the message to them. Max depth 3 prevents runaway chains.
      try {
        const room = db.getMissionRoom(roomInfo.roomId);
        if (room) forwardAgentMentionChain(room, roomMsg, roomInfo.agentId);
      } catch (e) { /* ignore */ }
    } catch (err) {
      console.warn(`[room-auto-reply] Failed for session ${sessionKey}:`, err.message);
    } finally {
      _roomAutoReplyInFlight.delete(sessionKey);
    }
  }, 4000); // 4s delay for JSONL flush
});
const feedWatcher = new LiveFeedWatcher({ ownerUserId: 1, db });
const watcherPool = new WatcherPool({ db });

orchestrator.on('spawned', ({ userId }) => {
  if (Number(userId) === 1) return;   // admin already covered by feedWatcher
  try { watcherPool.ensureForUser(userId); }
  catch (e) { console.warn(`[watchers] ensureForUser(${userId}) failed: ${e.message}`); }
});
orchestrator.on('stopped', ({ userId }) => {
  if (Number(userId) === 1) return;
  try { watcherPool.removeForUser(userId); }
  catch (e) { console.warn(`[watchers] removeForUser(${userId}) failed: ${e.message}`); }
});

// On startup, ensure a watcher for every gateway already in DB as 'running'
try {
  for (const row of (db.listGatewayStates() || [])) {
    const uid = row.userId;
    if (row.state === 'running' && Number(uid) !== 1) {
      try { watcherPool.ensureForUser(uid); } catch {}
    }
  }
} catch (_) {}

const terminal = require('./lib/terminal.cjs');

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (url.pathname === '/ws/terminal') {
    terminal.handleUpgrade(request, socket, head, db);
    return;
  }

  if (url.pathname !== '/ws') { socket.destroy(); return; }

  // Verify JWT token from query param + decode the user identity so the
  // connection handler can scope the init snapshot per-tenant.
  const token = url.searchParams.get('token');
  const payload = token ? db.verifyToken(token) : null;
  if (!payload) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    // Attach decoded user to the socket so handlers can scope per-tenant.
    ws._wsUser = { userId: Number(payload.userId), username: payload.username, role: payload.role };
    wss.emit('connection', ws, request);
  });
});

wss.on('connection', (ws) => {
  const wsUser = ws._wsUser || { userId: 1, role: 'admin' };
  console.log(`[ws] Client connected user=${wsUser.userId} role=${wsUser.role} (${wss.clients.size} total)`);

  // Send current snapshot on connect — scoped to this user.
  try {
    const isAdmin = wsUser.role === 'admin';
    const allAgents = getEnrichedAgents(wsUser.userId);
    const agents = isAdmin
      ? allAgents
      : allAgents.filter((a) => {
          const ownerId = a.id === 'main' ? 1 : db.getAgentOwner(a.id);
          return ownerId === wsUser.userId;
        });
    const sessions = parsers.getAllSessions(wsUser.userId);
    ws.send(JSON.stringify({ type: 'init', payload: { agents, sessions }, timestamp: new Date().toISOString() }));
  } catch (e) {
    console.warn(`[ws] init snapshot failed for user=${wsUser.userId}: ${e.message}`);
  }

  const wsBroadcastWatcher = (event) => {
    if (ws.readyState !== ws.OPEN) return;
    // Server-side filter: drop events not owned by this user (defense in depth;
    // frontend also filters). Events without ownerUserId are treated as global.
    const ownerUid = event && event.ownerUserId;
    if (ownerUid != null && wsUser.role !== 'admin' && Number(ownerUid) !== wsUser.userId) {
      return;
    }
    ws.send(JSON.stringify(event));
  };
  const unsubscribe = feedWatcher.addListener(wsBroadcastWatcher);
  const unsubscribePool = watcherPool.addListener(wsBroadcastWatcher);

  // Forward gateway real-time chat events to this dashboard WS client
  const unsubGateway = gatewayProxy.addListener((event) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
  });

  ws.on('close', () => {
    unsubscribe();
    unsubscribePool();
    unsubGateway();
    console.log(`[ws] Client disconnected (${wss.clients.size} total)`);
  });
  ws.on('error', () => { unsubscribe(); unsubscribePool(); unsubGateway(); });

  // Heartbeat
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});

// Note: heartbeat interval is managed inside wsBootstrap.init()

// ─── Sync update_task.sh for all agents ──────────────────────────────────────
// Legacy: scripts now live in skill bundles (aoc-tasks, aoc-connections).
// Injection is handled via SKILL.md when the skill is enabled.
// Kept as no-ops for call-site compatibility.
function syncTaskScriptForAllAgents() { /* moved to aoc-tasks skill */ }
function syncConnectionsScriptForAllAgents() { /* moved to aoc-connections skill */ }

// ─── AOC built-in scripts auto-injection ─────────────────────────────────────
// Reconciles agent's TOOLS.md with the AOC built-in script manifest based on
// current connections + enabled skills. Replaces per-script manual toggles for
// all aoc-builtin-source scripts. See server/lib/scripts.cjs:BUILTIN_SCRIPT_MANIFEST.
function syncBuiltinsForAgent(agentId) {
  try {
    // Resolve agent's single owner (composite-PK aware). For ambiguous cross-tenant
    // slugs we'd need an explicit ownerHint; called from server-internal flows where
    // a unique owner is implied (provision/connection-change for a specific user).
    const ownerId = db.getAgentOwner(agentId);
    if (ownerId == null) return; // ambiguous or missing — caller should pass owner
    const allConns = db.getAllConnections();
    const assignedIds = db.getAgentConnectionIds(agentId, ownerId);
    const connections = allConns.filter(c => assignedIds.includes(c.id));

    let skills = [];
    try {
      skills = parsers.getAgentSkills(agentId)
        .filter(s => s.enabled)
        .map(s => s.name)
        .concat(parsers.getAgentSkills(agentId).filter(s => s.enabled).map(s => s.slug).filter(Boolean));
    } catch {}

    parsers.syncAgentBuiltins(
      agentId,
      { connections, skills },
      parsers.getAgentFile,
      parsers.saveAgentFile,
    );
    if (agentId === 'main') parsers.missionOrchestratorSkill.ensureSkillEnabledForMainAgent();
  } catch (err) {
    console.warn(`[builtins] syncBuiltinsForAgent(${agentId}):`, err.message);
  }
}

function syncBuiltinsForAllAgents() {
  try {
    parsers.stampBuiltinSharedMeta();
    const agents = parsers.parseAgentRegistry();
    for (const agent of agents) syncBuiltinsForAgent(agent.id);
    console.log(`[builtins] reconciled built-in scripts for ${agents.length} agent(s)`);
  } catch (err) {
    console.warn('[builtins] syncBuiltinsForAllAgents failed:', err.message);
  }
}

function syncHeartbeatForAllAgents() {
  try {
    parsers.ensureCheckTasksScript();
    const agents = parsers.parseAgentRegistry();
    for (const agent of agents) {
      try {
        const workspacePath = agent.workspace || parsers.OPENCLAW_WORKSPACE;
        parsers.injectHeartbeatTaskCheck(agent.id, workspacePath);
      } catch (err) {
        console.warn(`[heartbeat-sync] ${agent.id}:`, err.message);
      }
    }
    console.log(`[heartbeat-sync] Injected task check for ${agents.length} agents`);
  } catch (err) {
    console.warn('[heartbeat-sync] failed:', err.message);
  }
}

/**
 * Ensure all agents in openclaw.json have explicit `heartbeat: {}` config.
 * OpenClaw's heartbeat-runner only enables heartbeat for agents with explicit
 * heartbeat config once ANY agent has it — without this, only the default
 * (first) agent gets heartbeat polling.
 */
function ensureHeartbeatConfig() {
  try {
    const { readJsonSafe, OPENCLAW_HOME } = require('./lib/config.cjs');
    const configPath = require('path').join(OPENCLAW_HOME, 'openclaw.json');
    const config = readJsonSafe(configPath);
    if (!config?.agents?.list) return;

    let patched = 0;
    for (const agent of config.agents.list) {
      if (!agent.heartbeat) {
        agent.heartbeat = {};
        patched++;
      }
    }

    if (patched > 0) {
      require('fs').writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
      console.log(`[heartbeat-config] Backfilled heartbeat config for ${patched} agent(s)`);
    }
  } catch (err) {
    console.warn('[heartbeat-config] failed:', err.message);
  }
}

async function sweepPendingTasks() {
  try {
    const tasks = db.getAllTasks({ status: 'todo' });
    const pending = tasks.filter(t => t.agentId);
    if (pending.length === 0) return;
    console.log(`[startup-sweep] Found ${pending.length} pending tasks, dispatching...`);
    for (const task of pending) {
      // TODO(slice 1.5.e): thread real userId from cron job / pipeline owner
      await dispatchTaskToAgent(task, {}, 1).catch(err =>
        console.warn(`[startup-sweep] task ${task.id}:`, err.message)
      );
    }
    console.log('[startup-sweep] Done');
  } catch (err) {
    console.warn('[startup-sweep] failed:', err.message);
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────
async function start() {
  await db.initDatabase();

  // Idempotent backfill: assign admin user 1 a master_agent_id if their main agent exists
  try { onboardingRouter.runMasterBackfill(); } catch (e) { console.warn('[onboarding] backfill error:', e.message); }

  // Idempotent backfill: create HQ room for every user who has a master but no HQ yet
  try {
    const hqRoom = require('./lib/hq-room.cjs');
    const users = db.getAllUsers();
    for (const user of users) {
      const masterId = db.getUserMasterAgentId(user.id);
      if (!masterId) continue;
      if (db.getHqRoomForUser(user.id)) continue;
      hqRoom.ensureHqRoom(db, user.id, masterId);
      console.log(`[startup] HQ room backfilled for user ${user.id} (master=${masterId})`);
    }
  } catch (e) {
    console.warn('[startup] HQ backfill failed:', e.message);
  }

  // Auto-bootstrap shared/providers.json5 from admin's openclaw.json on first
  // run. Idempotent: skips if the file already exists. Set PROVIDERS_OVERWRITE=1
  // to force regenerate after rotating provider credentials in admin's config.
  try {
    orchestrator.ensureSharedProviders();
  } catch (e) {
    console.warn('[orchestrator] ensureSharedProviders failed:', e.message);
  }

  try {
    await orchestrator.cleanupOrphans();
    console.log('[orchestrator] startup cleanup complete');
  } catch (e) {
    console.error('[orchestrator] cleanup failed:', e.message);
    // Non-fatal — continue startup.
  }

  // Seed built-in ADLC role templates on first run (idempotent)
  try {
    const seedResult = parsers.seedRoleTemplatesIfEmpty();
    if (seedResult.seeded > 0) {
      console.log(`[startup] Role templates seeded: ${seedResult.seeded}`);
    }
  } catch (err) {
    console.error('[startup] Role template seed failed:', err.message);
  }

  // Seed AOC skill catalog (internal marketplace) on first run (idempotent)
  try {
    const skillSeed = parsers.seedSkillCatalogIfEmpty();
    if (skillSeed.seeded > 0) {
      console.log(`[startup] Skill catalog seeded: ${skillSeed.seeded}`);
    }
  } catch (err) {
    console.error('[startup] Skill catalog seed failed:', err.message);
  }

  // Note: broadcast is unified via bootstrap/websocket.cjs — no re-definition needed

  integrations.init(db, broadcast);
  integrations.startScheduler();

  feedWatcher.start();
  parsers.ensureAocEnvFile();   // write ~/.openclaw/.aoc_env with current token
  syncTaskScriptForAllAgents(); // non-blocking, fire-and-forget
  syncConnectionsScriptForAllAgents(); // ensure check_connections.sh is available
  syncBuiltinsForAllAgents();   // stamp + reconcile built-in scripts for every agent
  ensureHeartbeatConfig();      // backfill heartbeat: {} in openclaw.json for all agents
  syncHeartbeatForAllAgents();  // inject HEARTBEAT task check into all agent workspaces

  // Ensure all agents have skills: [] field in openclaw.json
  try { parsers.ensureAgentSkillsFields(); } catch (e) { console.warn('[startup] ensureAgentSkillsFields failed:', e.message); }

  // browser-harness Layer 1 (core): clone upstream + start pool GC
  try {
    parsers.browserHarnessInstaller.installCoreSafe();
    parsers.browserHarnessPool.startIdleGc();
  } catch (e) { console.warn('[startup] browser-harness core init failed:', e.message); }
  // browser-harness Layer 2 (Odoo): write bundled skill files
  try { parsers.browserHarnessOdoo.installSafe(); }
  catch (e) { console.warn('[startup] browser-harness odoo init failed:', e.message); }
  // aoc-tasks built-in skill: install bundle + auto-enable for every agent.
  // ensureSkillEnabledForAllAgents is now async (file-locked); fire-and-forget at startup.
  try {
    parsers.aocTasksSkill.installSafe();
    parsers.aocTasksSkill.ensureSkillEnabledForAllAgents()
      .catch((e) => console.warn('[startup] aoc-tasks ensure failed:', e.message));
  } catch (e) { console.warn('[startup] aoc-tasks skill init failed:', e.message); }
  // aoc-connections built-in skill: install bundle + auto-enable for every agent.
  try {
    parsers.aocConnectionsSkill.installSafe();
    parsers.aocConnectionsSkill.ensureSkillEnabledForAllAgents()
      .catch((e) => console.warn('[startup] aoc-connections ensure failed:', e.message));
  } catch (e) { console.warn('[startup] aoc-connections skill init failed:', e.message); }
  // aoc-room built-in skill: install bundle + auto-enable for every agent.
  try {
    parsers.aocRoomSkill.installSafe();
    parsers.aocRoomSkill.ensureSkillEnabledForAllAgents()
      .catch((e) => console.warn('[startup] aoc-room ensure failed:', e.message));
  } catch (e) { console.warn('[startup] aoc-room skill init failed:', e.message); }
  // aoc-odoo built-in skill: install bundle + auto-enable for every agent.
  try {
    parsers.aocOdooSkill.installSafe();
    parsers.aocOdooSkill.ensureSkillEnabledForAllAgents()
      .catch((e) => console.warn('[startup] aoc-odoo ensure failed:', e.message));
  } catch (e) { console.warn('[startup] aoc-odoo skill init failed:', e.message); }

  // aoc-schedules built-in skill: install bundle + auto-enable in admin's
  // openclaw.json AND every per-user openclaw.json that already exists.
  try {
    parsers.aocSchedulesSkill.installSafe();
    parsers.aocSchedulesSkill.ensureSkillEnabledForAllAgents()
      .catch((e) => console.warn('[startup] aoc-schedules ensure failed:', e.message));
  } catch (e) { console.warn('[startup] aoc-schedules skill init failed:', e.message); }
  // mission-orchestrator built-in skill: install bundle + enable only for main.
  try {
    parsers.missionOrchestratorSkill.installSafe();
    parsers.missionOrchestratorSkill.ensureSkillEnabledForMainAgent();
  } catch (e) { console.warn('[startup] mission-orchestrator skill init failed:', e.message); }
  // aoc-master skill: install bundle (master agents are enrolled per-provision / per-onboarding).
  try {
    aocMasterInstaller.installSafe();
  } catch (e) { console.warn('[startup] aoc-master skill init failed:', e.message); }
  // After all skill bundles install, purge legacy flat copies of skill scripts
  // (they live inside the skill folder now). Idempotent.
  try { parsers.purgeLegacyFlatScripts(); }
  catch (e) { console.warn('[startup] purgeLegacyFlatScripts failed:', e.message); }

  // Connect to OpenClaw Gateway for real-time chat
  gatewayProxy.connect();
  console.log('[gateway-ws] Connecting to OpenClaw Gateway...');

  const hasUsers = db.hasAnyUsers();
  console.log(`[auth] Database ready. ${hasUsers ? 'Users exist.' : 'No users — setup required.'}`);

  // Periodic SQLite backup (opt-in via AOC_BACKUP_ENABLED=1). See server/lib/backup.cjs.
  try {
    const backupResult = require('./lib/backup.cjs').start();
    if (!backupResult.enabled) {
      console.log('[backup] disabled — set AOC_BACKUP_ENABLED=1 to turn on hourly snapshots');
    }
  } catch (e) {
    console.warn(`[backup] start failed: ${e.message}`);
  }

  // ── EADDRINUSE retry logic for `node --watch` restarts ──────────────────
  // When node --watch restarts the server, the old process may not have fully
  // released port 18800 yet. Retry with backoff instead of crashing.
  const MAX_LISTEN_RETRIES = 6;
  const LISTEN_RETRY_BASE_MS = 500;
  let listenAttempt = 0;

  function tryListen() {
    server.listen(PORT, HOST);
  }

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && listenAttempt < MAX_LISTEN_RETRIES) {
      listenAttempt++;
      const delay = LISTEN_RETRY_BASE_MS * listenAttempt;
      console.warn(`[server] Port ${PORT} busy, retrying in ${delay}ms (attempt ${listenAttempt}/${MAX_LISTEN_RETRIES})...`);
      setTimeout(tryListen, delay);
    } else {
      console.error(`[server] Fatal server error:`, err);
      process.exit(1);
    }
  });

  server.on('listening', () => {
    if (listenAttempt > 0) {
      console.log(`[server] Port ${PORT} acquired after ${listenAttempt} retry(s)`);
    }
    console.log(`
┌─────────────────────────────────────────┐
│  🐙 OpenClaw AOC v2.0                  │
│  API:  http://${HOST}:${PORT}/api       │
│  WS:   ws://${HOST}:${PORT}/ws          │
│  Auth: SQLite + JWT                     │
│  Dev:  http://localhost:5173            │
└─────────────────────────────────────────┘
    `);
    // Start periodic Google OAuth health check
    try { parsers.googleHealthCronStart(broadcast); } catch (e) { console.warn('[startup] googleHealthCronStart failed:', e.message); }

    // Idempotently inject SOUL.md standard blocks (research + connection protocol) into all agents
    try {
      const cfg = require('./lib/config.cjs');
      const registry = cfg.readJsonSafe(require('path').join(cfg.OPENCLAW_HOME, 'openclaw.json'));
      const list = registry?.agents?.list || [];
      let injected = 0, already = 0, errors = 0;
      for (const a of list) {
        const r = parsers.injectSoulStandard(a.id);
        if (r.status === 'injected') injected++;
        else if (r.status === 'already_applied') already++;
        else errors++;
      }
      console.log(`[startup] SOUL standards: ${injected} injected, ${already} already applied, ${errors} errors`);
    } catch (e) { console.warn('[startup] soul-standard injection failed:', e.message); }
  });

  tryListen();
}

start().catch(err => {
  console.error('[FATAL] Failed to start server:', err);
  process.exit(1);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal} received — graceful shutdown`);
  feedWatcher.stop();
  watcherPool.stopAll();
  server.close();
  try {
    await orchestrator.gracefulShutdown();
    console.log('[server] all user gateways stopped');
  } catch (e) {
    console.error('[server] shutdown error:', e.message);
  }
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
