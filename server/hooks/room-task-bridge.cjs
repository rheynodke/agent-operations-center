const crypto = require('crypto');

/**
 * hooks/room-task-bridge.cjs
 *
 * Room ↔ Agent mention forwarding and delegation-depth loop prevention.
 *
 * Session strategy: PERSISTENT PER-ROOM with idle reset.
 *   - One session per agent per room: `agent:<agentId>:room:<roomId>`
 *   - First message in a session gets full context (project, roster, hints)
 *   - Subsequent messages: just `authorName: message.body`
 *   - Auto-reset after SESSION_IDLE_MS of inactivity
 *
 * Exported functions:
 *   - forwardRoomMentionToAgent(room, message, agentId, deps)
 *   - forwardAgentMentionChain(room, agentMsg, sourceAgentId, deps)
 *   - resetRoomSession(roomId, agentId, deps)
 *
 * Singleton state:
 *   - _roomSessions     — Map<sessionKey, { lastActivity, sessionKey, isNew }>
 *   - delegationDepth   — Map<messageId, depth>
 *   - delegationByAgent — Map<`${agentId}:${roomId}`, depth>
 */
'use strict';

// ── Configuration ─────────────────────────────────────────────────────────────
const SESSION_IDLE_MS = 30 * 60 * 1000; // 30 minutes — auto-reset after this idle period

// ── Singleton state ───────────────────────────────────────────────────────────
const _roomSessions = new Map();          // baseKey → { lastActivity, gwSessionKey, version }
const _sessionVersions = new Map();       // baseKey → version counter (survives reset)
const _delegationDepth = new Map();       // messageId → depth (0 = root user post)
const _delegationByAgentRoom = new Map(); // `${agentId}:${roomId}` → depth
const MAX_DELEGATION_DEPTH = 3;

/**
 * Build the base key for a room + agent pair (no version suffix).
 */
function baseSessionKey(agentId, roomId) {
  return `agent:${agentId}:room:${roomId}`;
}

/**
 * Build the versioned session key sent to the gateway.
 * Each reset bumps the version so sessions.create makes a truly new session.
 */
function versionedSessionKey(agentId, roomId) {
  const base = baseSessionKey(agentId, roomId);
  const version = _sessionVersions.get(base) || 1;
  return `${base}:v${version}`;
}

/**
 * Check if a session should be reset (idle timeout).
 */
function shouldResetSession(baseKey) {
  const meta = _roomSessions.get(baseKey);
  if (!meta) return true; // no session yet → first message
  return (Date.now() - meta.lastActivity) > SESSION_IDLE_MS;
}

/**
 * Touch session — update last activity timestamp.
 */
function touchSession(baseKey, gwSessionKey) {
  const existing = _roomSessions.get(baseKey);
  _roomSessions.set(baseKey, {
    lastActivity: Date.now(),
    gwSessionKey: gwSessionKey || existing?.gwSessionKey || baseKey,
  });
}

/**
 * Build the FULL context prompt — used on first message or after idle reset.
 * Contains project context, room roster, orchestrator hints, and a compact recap.
 */
function buildFullContextPrompt(room, message, agentId, deps, recap) {
  const { db } = deps;

  // Project context — compact summary, only for project rooms.
  let projectContext = '';
  if (room.kind === 'project' && room.projectId) {
    const project = db.getProject(room.projectId);
    if (project) {
      const lines = [
        `[Project: ${project.name} (${project.id})]`,
        project.description ? project.description : null,
      ].filter(Boolean);

      try {
        const tasks = db.getAllTasks({ projectId: project.id }) || [];
        const active = tasks.filter(t => ['in_progress', 'in_review', 'open', 'todo'].includes(t.status));
        if (active.length) {
          lines.push('Active tasks:');
          for (const t of active.slice(0, 8)) {
            lines.push(`  [${t.status}] ${t.title}${t.agentId ? ` → ${t.agentId}` : ''}`);
          }
        }
      } catch (_) { /* ignore */ }

      try {
        const mem = db.buildProjectMemorySnapshot(room.projectId, { decisionLimit: 3, glossaryLimit: 0 });
        if (mem?.decisions?.length) {
          lines.push('Decisions:');
          for (const d of mem.decisions.slice(0, 3)) lines.push(`  • ${d.title}`);
        }
      } catch (_) { /* ignore */ }

      projectContext = lines.join('\n');
    }
  }

  // Roster — who else is in this room.
  let rosterContext = '';
  try {
    const allAgents = deps.getEnrichedAgents() || [];
    const roomMembers = (room.memberAgentIds || [])
      .filter(id => id !== agentId)
      .map(id => allAgents.find(a => a.id === id))
      .filter(Boolean);
    if (roomMembers.length) {
      const lines = ['Room members:'];
      for (const m of roomMembers) {
        lines.push(`  @${m.name || m.id} (id="${m.id}")${m.role ? ` [${m.role}]` : ''}`);
      }
      rosterContext = lines.join('\n');
    }
  } catch (_) { /* ignore */ }

  // Orchestrator hint — compact.
  const masterAgentId = db.getUserMasterAgentId(room.createdBy) || 'main';
  const isOrchestrator = agentId === masterAgentId;
  const projectIdForTools = (room.kind === 'project' && room.projectId) ? room.projectId : null;
  let orchestratorHint = '';
  if (isOrchestrator && projectIdForTools) {
    orchestratorHint = [
      '',
      'You are the orchestrator. Use mission_room.sh to manage tasks:',
      `  create-task --project ${projectIdForTools} --title "..." --assignee <agentId> --stage <stage> --role <role>`,
      '  update-task | dispatch-task | approve | request-change | comment-task',
      'Assign to room members only (never self-assign). Run mission_room.sh --help for full syntax.',
      'Lifecycle hooks auto-post status to this room — do NOT duplicate announcements.',
    ].join('\n');
  } else if (isOrchestrator) {
    orchestratorHint = '\nYou are the orchestrator. Use mission_room.sh for task management (run --help for syntax).';
  }

  // Assemble full context prompt.
  const parts = [
    `[Room: "${room.name}" id=${room.id}]`,
    projectContext || null,
    rosterContext || null,
    orchestratorHint || null,
  ].filter(v => v != null);

  // If we have a recap from idle reset, include it.
  if (recap) {
    parts.push('', '[Session resumed — recent conversation recap:]', recap);
  }

  parts.push(
    '',
    `${message.authorName || message.authorId || 'user'}: ${message.body}`,
    '',
    'Reply as plain text (AOC auto-posts to room). Do NOT call mission_room.sh post for THIS room. Use @name to delegate. Reply "NO_REPLY" if no response needed.',
  );

  return parts.join('\n');
}

/**
 * Build a compact recap from recent room messages — used when resetting
 * an idle session so the agent has minimal context about what happened.
 */
function buildRecap(db, roomId, maxMessages = 5) {
  try {
    const history = db.listMissionMessages(roomId, { limit: maxMessages * 2 }).reverse();
    const filtered = [];
    let lastBody = '';
    for (const m of history) {
      if (m.body && m.body.startsWith('/')) continue;
      if (m.authorType === 'system') continue;
      if (m.body === lastBody) continue;
      lastBody = m.body;
      filtered.push(m);
    }
    return filtered.slice(-maxMessages)
      .map(m => `${m.authorName || m.authorId || m.authorType}: ${(m.body || '').slice(0, 150)}`)
      .join('\n');
  } catch (_) {
    return '';
  }
}

/**
 * Forward a room message to a specific agent by creating / reusing a
 * persistent gateway session and sending the appropriate prompt.
 *
 * Strategy:
 *   - First message (or after idle reset): full context prompt
 *   - Subsequent messages: just `authorName: message.body`
 */
async function forwardRoomMentionToAgent(room, message, agentId, deps) {
  const { db } = deps;
  const userId = deps.userId ?? room.createdBy ?? null;
  if (userId == null) throw new Error('forwardRoomMentionToAgent: unable to resolve userId');

  const { gatewayPool } = require('../lib/gateway-ws.cjs');
  const orchestrator = require('../lib/gateway-orchestrator.cjs');
  const gw = gatewayPool.forUser(userId);

  // ── Ensure gateway is connected ──────────────────────────────────────────
  if (!gw.isConnected) {
    const dbState = orchestrator.getGatewayState(userId);

    if (!dbState || !dbState.state) {
      console.log(`[forward-mention] no gateway state for userId=${userId}, spawning...`);
      try {
        await orchestrator.spawnGateway(userId);
        const start = Date.now();
        while (Date.now() - start < 10000) {
          const fresh = orchestrator.getGatewayState(userId);
          if (fresh?.state === 'running') break;
          await new Promise(r => setTimeout(r, 500));
        }
      } catch (e) {
        console.warn(`[forward-mention] spawn failed for userId=${userId}:`, e.message);
      }
    }

    if (dbState?.state === 'stale' && dbState?.port) {
      console.log(`[forward-mention] restarting stale gateway for userId=${userId}`);
      try {
        await orchestrator.restartGateway(userId);
        const start = Date.now();
        while (Date.now() - start < 6000) {
          const fresh = orchestrator.getGatewayState(userId);
          if (fresh?.state === 'running') break;
          await new Promise(r => setTimeout(r, 500));
        }
      } catch (e) {
        console.warn(`[forward-mention] restart failed for userId=${userId}:`, e.message);
      }
    }

    const freshState = orchestrator.getGatewayState(userId);
    const freshToken = orchestrator.getRunningToken(userId);
    if (freshState?.state === 'running' && freshState?.port && freshToken) {
      gw.connect({ port: freshState.port, token: freshToken });
      const start = Date.now();
      while (!gw.isConnected && Date.now() - start < 4000) {
        await new Promise(r => setTimeout(r, 100));
      }
    }
    if (!gw.isConnected) {
      console.warn(`[forward-mention] gateway not connected for userId=${userId}, room=${room.id}, agent=${agentId}`);
      return;
    }
  }

  // ── Persistent session key (one per agent per room, versioned) ─────────────
  const baseKey = baseSessionKey(agentId, room.id);
  const needsReset = shouldResetSession(baseKey);

  if (needsReset) {
    // First message or idle timeout — bump version and create a truly fresh session.
    const isIdleReset = _roomSessions.has(baseKey);
    const resetReason = isIdleReset ? 'idle timeout' : 'first message';

    // Bump version so gateway creates a NEW session (old key is abandoned)
    if (isIdleReset) {
      _sessionVersions.set(baseKey, (_sessionVersions.get(baseKey) || 1) + 1);
    }
    const desiredKey = versionedSessionKey(agentId, room.id);
    console.log(`[forward-mention] ${resetReason} → creating session key=${desiredKey} agent=${agentId} room=${room.id}`);

    // Build recap if this is an idle reset (not first-ever message)
    const recap = isIdleReset ? buildRecap(db, room.id, 5) : '';

    const sessionResult = await gw.sessionsCreate(agentId, { key: desiredKey });
    const gwSessionKey = sessionResult.key || sessionResult.session_key || sessionResult.id;
    if (!gwSessionKey) throw new Error('Gateway did not return a session key');

    // Tag session as room-triggered
    db.markSessionAsRoomTriggered(gwSessionKey, room.id, agentId);

    // Send full context prompt
    const prompt = buildFullContextPrompt(room, message, agentId, deps, recap);
    touchSession(baseKey, gwSessionKey);

    try {
      await gw.chatSend(gwSessionKey, prompt);
    } catch (err) {
      console.warn(`[forward-mention] chatSend failed (full context) room=${room.id} agent=${agentId}:`, err.message);
    }
  } else {
    // Subsequent message — reuse existing session, send only the new message.
    const meta = _roomSessions.get(baseKey);
    const gwSessionKey = meta?.gwSessionKey || versionedSessionKey(agentId, room.id);
    console.log(`[forward-mention] reusing session key=${gwSessionKey} agent=${agentId} room=${room.id}`);

    touchSession(baseKey, gwSessionKey);

    // Compact message — just the author and body, no context repetition
    const prompt = `${message.authorName || message.authorId || 'user'}: ${message.body}`;
    try {
      await gw.chatSend(gwSessionKey, prompt);
    } catch (err) {
      console.warn(`[forward-mention] chatSend failed (follow-up) room=${room.id} agent=${agentId}:`, err.message);
    }
  }
}

/**
 * Reset a room session for a specific agent — used by /rooms/:id/reset-session
 * or /reset slash command. Next message will get full context in a new session.
 */
function resetRoomSession(roomId, agentId) {
  const key = baseSessionKey(agentId, roomId);
  _roomSessions.delete(key);
  // Bump version so next sessions.create uses a new key
  _sessionVersions.set(key, (_sessionVersions.get(key) || 1) + 1);
  console.log(`[room-session] manually reset session key=${key} next version=v${_sessionVersions.get(key)}`);
}

/**
 * Reset ALL agent sessions for a room — used when all sessions should start fresh.
 */
function resetAllRoomSessions(roomId, userId = null, shouldAbort = false) {
  let count = 0;
  
  let gw = null;
  if (shouldAbort && userId != null) {
    const { gatewayPool } = require('../lib/gateway-ws.cjs');
    gw = gatewayPool.forUser(userId);
  }

  for (const [key] of _roomSessions) {
    if (key.includes(`:room:${roomId}`)) {
      _roomSessions.delete(key);
      // Bump version
      _sessionVersions.set(key, (_sessionVersions.get(key) || 1) + 1);
      count++;

      if (gw && gw.isConnected()) {
        try {
          gw.chatAbort(key).catch(() => {});
        } catch (e) {}
      }
    }
  }
  // Also bump version for agents that had no active session but had a previous version
  for (const [key] of _sessionVersions) {
    if (key.includes(`:room:${roomId}`) && !_roomSessions.has(key)) {
      _sessionVersions.set(key, (_sessionVersions.get(key) || 1) + 1);
      count = Math.max(count, 1); // ensure we report something
    }
  }
  console.log(`[room-session] reset ${count} session(s) for room=${roomId} (aborted=${shouldAbort})`);
}

/**
 * After an agent posts to a room, check if it mentions other agents.
 * If so, forward the message to each mentioned agent — respecting max
 * delegation depth to prevent runaway chains.
 *
 * @param {object} room
 * @param {object} agentMsg   - the room message posted by the agent
 * @param {string} sourceAgentId
 * @param {{ getEnrichedAgents, forwardFn }} deps
 *   - forwardFn is the bound forwardRoomMentionToAgent with deps already applied
 */
function forwardAgentMentionChain(room, agentMsg, sourceAgentId, deps) {
  if (!agentMsg?.body) return;
  const parentDepth = _delegationDepth.get(agentMsg.id) ?? 0;
  const nextDepth = parentDepth + 1;
  if (nextDepth > MAX_DELEGATION_DEPTH) {
    console.log(`[delegation] dropped — max depth ${MAX_DELEGATION_DEPTH} exceeded for msg=${agentMsg.id}`);
    return;
  }

  const allAgents = (typeof deps.getEnrichedAgents === 'function' ? deps.getEnrichedAgents() : []) || [];
  const memberAgents = (room.memberAgentIds || [])
    .map(id => allAgents.find(a => a.id === id))
    .filter(Boolean);
  const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const text = String(agentMsg.body);
  const mentioned = new Set();
  for (const a of memberAgents) {
    if (a.id === sourceAgentId) continue;
    const labels = [a.id, a.name, a.displayName].filter(Boolean).map(String);
    if (labels.some(l => new RegExp(`(^|[^\\w@])@${escapeRegex(l)}(?![\\w])`, 'i').test(text))) {
      mentioned.add(a.id);
    }
  }
  if (mentioned.size === 0) return;

  for (const targetAgentId of mentioned) {
    console.log(`[delegation] ${sourceAgentId} → ${targetAgentId} (depth ${nextDepth}) msg=${agentMsg.id}`);
    deps.forwardFn(room, agentMsg, targetAgentId)
      .then(() => {
        _delegationByAgentRoom.set(`${targetAgentId}:${room.id}`, nextDepth);
      })
      .catch(() => {});
  }
}

module.exports = {
  forwardRoomMentionToAgent,
  forwardAgentMentionChain,
  resetRoomSession,
  resetAllRoomSessions,
  // Expose singleton maps so auto-reply listener can read/write them
  delegationDepth: _delegationDepth,
  delegationByAgentRoom: _delegationByAgentRoom,
  MAX_DELEGATION_DEPTH,
};
