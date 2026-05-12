/**
 * routes/chat.cjs
 *
 * Chat API (Gateway WebSocket Proxy) — send, history, abort,
 * session management, SSE message streaming.
 * Step 9c of server modularization.
 */
'use strict';

const fs = require('node:fs');
const { gatewayForReq } = require('../helpers/gateway-context.cjs');
const outputsLib = require('../lib/outputs.cjs');
const memoryHooks = require('../lib/memory-hooks');

module.exports = function chatRouter(deps) {
  const { db, parsers, loadAllJSONLMessagesForTask } = deps;
  const router = require('express').Router();
  const path = require('path');

  // Resolve the agent + session-start cutoff for a chat sessionKey. Used by
  // the outputs endpoints to scope file listings to "produced during this
  // chat". Session start time = first event timestamp in the JSONL when
  // available, else the file's ctime, else null (meaning "no cutoff").
  function resolveChatSessionContext(sessionKey) {
    if (!sessionKey || typeof sessionKey !== 'string') return null;
    const parts = sessionKey.split(':');
    if (parts.length < 4 || parts[0] !== 'agent') return null;
    const agentId = parts[1];
    const sessionId = parts[parts.length - 1];
    if (!agentId || !sessionId) return null;
    const workspace = outputsLib.getAgentWorkspacePath(agentId);
    if (!workspace) return null;
    // Sessions live as siblings of `workspace/`: `<home>/agents/<agentId>/sessions/<id>.jsonl`.
    const home = path.dirname(workspace);
    const jsonl = path.join(home, 'agents', agentId, 'sessions', `${sessionId}.jsonl`);
    let sinceMs = null;
    try {
      const stat = fs.statSync(jsonl);
      // Try first event for accuracy; fall back to ctime.
      try {
        // Read just the first ~1KB — enough for the session header line.
        const buf = Buffer.alloc(1024);
        const fd = fs.openSync(jsonl, 'r');
        try { fs.readSync(fd, buf, 0, buf.length, 0); }
        finally { fs.closeSync(fd); }
        const firstLine = buf.toString('utf8').split('\n', 1)[0];
        const evt = firstLine ? JSON.parse(firstLine) : null;
        const ts = evt?.timestamp;
        const parsed = ts ? Date.parse(ts) : NaN;
        if (Number.isFinite(parsed)) sinceMs = parsed;
      } catch { /* fall through to ctime */ }
      if (sinceMs == null) sinceMs = stat.birthtime?.getTime?.() || stat.ctime.getTime();
    } catch {
      // No JSONL yet (newly-created session) — leave sinceMs null so the API
      // returns everything currently in outputs/.
    }
    return { agentId, sessionId, sinceMs };
  }

  // Authorization gate: only the agent's owner may inspect their outputs.
  function ensureChatOutputsAccess(req, agentId) {
    return db.userOwnsAgent(req, agentId);
  }

// ─── Chat API (Gateway WebSocket Proxy) ──────────────────────────────────────

// Get gateway connection status
  router.get('/chat/gateway/status', db.authMiddleware, (req, res) => {
  res.json({ connected: gatewayForReq(req).isConnected });
});

// List chat sessions (from gateway)
  router.get('/chat/sessions', db.authMiddleware, async (req, res) => {
  try {
    if (!gatewayForReq(req).isConnected) {
      return res.status(503).json({ error: 'Not connected to Gateway' });
    }
    const agentId = req.query.agentId;
    const result = await gatewayForReq(req).sessionsList(agentId);
    // Normalize: extract agentId from key pattern "agent:{agentId}:{channel}:{uuid}"
    const roomKeys = new Set(db.getRoomSessionKeys());
    const taskKeys = new Set(db.getTaskSessionKeys());
    
    const sessions = (result.sessions || []).map(s => {
      const parts = (s.key || '').split(':');
      const lastMsgOrTitle = s.lastMessage || s.derivedTitle || '';
      
      // Fallback for legacy task sessions created before DB tracking
      const isLegacyTask = /^(\s*📋\s*)?\*\*Task/i.test(lastMsgOrTitle);
      
      return {
        ...s,
        sessionKey: s.key,
        agentId: s.agentId || (parts[0] === 'agent' ? parts[1] : undefined),
        lastMessage: lastMsgOrTitle || undefined,
        isRoomTriggered: roomKeys.has(s.key),
        isTaskTriggered: taskKeys.has(s.key) || isLegacyTask,
      };
    });
    // By default, exclude room-triggered and task-triggered sessions from DMs list
    const includeRoom = req.query.includeRoom === '1';
    const filtered = includeRoom 
      ? sessions 
      : sessions.filter(s => !s.isRoomTriggered && !s.isTaskTriggered);
      
    res.json({ sessions: filtered });
  } catch (err) {
    console.error('[api/chat/sessions]', err);
    res.status(500).json({ error: err.message });
  }
});

// Create a new chat session
  router.post('/chat/sessions', db.authMiddleware, async (req, res) => {
  try {
    if (!gatewayForReq(req).isConnected) {
      return res.status(503).json({ error: 'Not connected to Gateway' });
    }
    const { agentId, roomId } = req.body;
    if (!agentId) return res.status(400).json({ error: 'agentId is required' });
    if (!db.userOwnsAgent(req, agentId)) {
      return res.status(403).json({ error: 'You can only chat with agents you own' });
    }
    const sessionOpts = {};
    const result = await gatewayForReq(req).sessionsCreate(agentId, sessionOpts);
    console.log('[api/chat/sessions/create] result:', JSON.stringify(result).slice(0, 500));
    res.json(result);
  } catch (err) {
    console.error('[api/chat/sessions/create]', err);
    res.status(500).json({ error: err.message });
  }
});

// Get merged chat history for all sessions of a task
  router.get('/chat/history-multi', db.authMiddleware, async (req, res) => {
  try {
    if (!gatewayForReq(req).isConnected) {
      return res.status(503).json({ error: 'Not connected to Gateway' });
    }
    const sessionKeys = (req.query.keys || '').split(',').map(k => k.trim()).filter(Boolean);
    if (!sessionKeys.length) return res.json({ messages: [], sessions: [] });

    const maxChars = parseInt(req.query.maxChars || '40000', 10);
    const results = await Promise.allSettled(
      sessionKeys.map(key =>
        gatewayForReq(req).chatHistory(key, maxChars).then(r => ({ key, messages: r.messages || [] }))
      )
    );

    // Subscribe to latest session for real-time updates
    const lastKey = sessionKeys[sessionKeys.length - 1];
    gatewayForReq(req).sessionsMessagesSubscribe(lastKey).catch(() => {});

    const sessions = results.map((r, i) => ({
      key: sessionKeys[i],
      messages: r.status === 'fulfilled' ? r.value.messages : [],
      ok: r.status === 'fulfilled',
    }));

    res.json({ sessions });
  } catch (err) {
    console.error('[api/chat/history-multi]', err);
    res.status(500).json({ error: err.message });
  }
});

// Get chat history for a session
  router.get('/chat/history/:sessionKey', db.authMiddleware, async (req, res) => {
  try {
    if (!gatewayForReq(req).isConnected) {
      return res.status(503).json({ error: 'Not connected to Gateway' });
    }
    const { sessionKey } = req.params;
    const taskId = req.query.taskId;
    const maxChars = parseInt(req.query.maxChars || '80000', 10);

    // Also subscribe to real-time updates
    gatewayForReq(req).sessionsMessagesSubscribe(sessionKey).catch(() => {});

    // If taskId provided, merge all JSONL dispatch files for this task.
    // Gateway creates a new JSONL file per chatSend round, so each "Continue"
    // dispatch lives in a separate file — we need to combine them all.
    if (taskId) {
      // Extract agentId from session key: "agent:tadaki:dashboard:..." → "tadaki"
      const agentId = sessionKey.split(':')[1];
      if (agentId) {
        const merged = loadAllJSONLMessagesForTask(agentId, taskId);
        if (merged.length > 0) {
          return res.json({ messages: merged });
        }
      }
    }

    // For claude-cli backed sessions, gateway's chat.history only returns
    // plain text turns — no thinking, no tool_use, no tool_result. The full
    // trace lives in the claude-cli JSONL. Try to locate it and return those
    // parsed messages instead so the reload UI matches the live experience.
    const agentId = sessionKey.split(':')[1];
    if (agentId) {
      const { OPENCLAW_HOME, readJsonSafe } = require('../lib/config.cjs');
      const sessionsFile = path.join(OPENCLAW_HOME, 'agents', agentId, 'sessions', 'sessions.json');
      const gwSessions = readJsonSafe(sessionsFile) || {};
      const meta = gwSessions[sessionKey];
      if (meta) {
        const cli = parsers.findClaudeCliFileForGatewaySession(meta, agentId);
        if (cli?.fullPath) {
          const cliMessages = parsers.parseClaudeCliAsGatewayMessages(cli.fullPath);
          if (cliMessages.length > 0) {
            return res.json({ messages: cliMessages, source: 'claude-cli' });
          }
        }
      }
    }

    const result = await gatewayForReq(req).chatHistory(sessionKey, maxChars);
    res.json(result);
  } catch (err) {
    console.error('[api/chat/history]', err);
    res.status(500).json({ error: err.message });
  }
});

// Send a message to an agent
  router.post('/chat/send', db.authMiddleware, async (req, res) => {
  try {
    if (!gatewayForReq(req).isConnected) {
      return res.status(503).json({ error: 'Not connected to Gateway' });
    }
    const { sessionKey, text, agentId, images } = req.body;
    if (!sessionKey) return res.status(400).json({ error: 'sessionKey is required' });
    if (!text?.trim() && (!images || images.length === 0)) {
      return res.status(400).json({ error: 'text or images is required' });
    }
    // Ownership: sessionKey format is "agent:{agentId}:..." — enforce ownership
    const sessionAgentId = sessionKey.split(':')[1];
    if (sessionAgentId && !db.userOwnsAgent(req, sessionAgentId)) {
      return res.status(403).json({ error: 'You can only chat with agents you own' });
    }
    // Token budget gate. Block at the request edge before we kick off model
    // generation. Quota of 0/null = unlimited (default for new users + admin).
    // We can't pre-compute the exact spend but we refuse if the user is
    // already over quota — the actual usage delta lands via WS event handlers
    // that call recordTokenUsage().
    {
      const ok = db.checkTokenBudget(req.user?.userId, 0);
      if (!ok.allowed) {
        return res.status(429).json({
          error: 'Daily token quota exceeded',
          code: 'TOKEN_QUOTA_EXCEEDED',
          quota: ok.quota,
          used: ok.used,
          remaining: 0,
          hint: 'Hubungi admin untuk menaikkan kuota harian, atau tunggu reset di pergantian hari (UTC).',
        });
      }
    }
    // Gateway's chat.send requires `message` as a plain string and carries
    // media via the separate `attachments` array (see ChatSendParamsSchema in
    // openclaw:src/gateway/protocol/schema/logs-chat.ts). Previous code shoved
    // content blocks into `message` which the schema rejects with
    // "invalid chat.send params: at /message: must be string".
    let message = (text || '').trim();
    // Memory hooks: pre-inject persistent-memory block + capture user turn for
    // post-turn extractor correlation. Skip if disabled via env. Never blocks.
    if (process.env.AOC_MEMORY_HOOKS_DISABLED !== '1' && message) {
      try { memoryHooks.captureUserTurn(sessionKey, message); } catch {}
      try { message = await memoryHooks.preInjectMemory(sessionKey, message); } catch {}
    }
    const attachments = [];
    if (Array.isArray(images) && images.length > 0) {
      images.forEach((dataUrl, i) => {
        // Accept "data:<mediaType>;base64,<data>" — fall back to raw base64.
        const match = typeof dataUrl === 'string' ? dataUrl.match(/^data:([^;]+);base64,(.+)$/) : null;
        const mimeType = match ? match[1] : 'image/png';
        const content  = match ? match[2] : (typeof dataUrl === 'string' ? dataUrl : '');
        if (!content) return;
        const extFromMime = (mimeType.split('/')[1] || 'bin').split('+')[0];
        attachments.push({
          type: 'image',
          mimeType,
          fileName: `upload-${Date.now()}-${i}.${extFromMime}`,
          content,
        });
      });
    }
    // Ensure we're subscribed
    await gatewayForReq(req).sessionsMessagesSubscribe(sessionKey);
    const result = await gatewayForReq(req).chatSend(sessionKey, message, attachments);
    // agentId is accepted by the legacy wrapper call signature but the gateway
    // does not use it for chat.send — session routing is by sessionKey.
    void agentId;
    res.json(result || { ok: true });
  } catch (err) {
    console.error('[api/chat/send]', err);
    res.status(500).json({ error: err.message });
  }
});

// Abort an active agent run
  router.post('/chat/abort', db.authMiddleware, async (req, res) => {
  try {
    if (!gatewayForReq(req).isConnected) {
      return res.status(503).json({ error: 'Not connected to Gateway' });
    }
    const { sessionKey } = req.body;
    if (!sessionKey) return res.status(400).json({ error: 'sessionKey is required' });
    const result = await gatewayForReq(req).chatAbort(sessionKey);
    res.json(result || { ok: true });
  } catch (err) {
    console.error('[api/chat/abort]', err);
    res.status(500).json({ error: err.message });
  }
});

// Subscribe to a session's real-time events
  router.post('/chat/subscribe', db.authMiddleware, async (req, res) => {
  try {
    if (!gatewayForReq(req).isConnected) {
      return res.status(503).json({ error: 'Not connected to Gateway' });
    }
    const { sessionKey } = req.body;
    if (!sessionKey) return res.status(400).json({ error: 'sessionKey is required' });
    await gatewayForReq(req).sessionsMessagesSubscribe(sessionKey);
    res.json({ ok: true, subscribed: sessionKey });
  } catch (err) {
    console.error('[api/chat/subscribe]', err);
    res.status(500).json({ error: err.message });
  }
});


  // ─── Chat-session outputs (artifacts produced during this conversation) ──
  // List files produced during a chat session. Walks `<workspace>/outputs/`
  // recursively (the convention) plus, transitionally, files written outside
  // it by older agents (flagged outOfConvention=true so the UI can hint).
  router.get('/chat/outputs', db.authMiddleware, (req, res) => {
    try {
      const sessionKey = String(req.query.sessionKey || '');
      if (!sessionKey) return res.status(400).json({ error: 'sessionKey query param required' });
      const ctx = resolveChatSessionContext(sessionKey);
      if (!ctx) return res.status(400).json({ error: 'invalid sessionKey' });
      if (!ensureChatOutputsAccess(req, ctx.agentId)) {
        return res.status(403).json({ error: 'You can only view outputs for agents you own' });
      }
      const result = outputsLib.listChatOutputs(ctx.agentId, { sinceMs: ctx.sinceMs });
      res.json({
        agentId: ctx.agentId,
        sessionId: ctx.sessionId,
        sinceMs: ctx.sinceMs,
        outputsRoot: result.outputsRoot,
        files: result.files,
        truncated: result.truncated,
      });
    } catch (err) {
      console.error('[api/chat/outputs]', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Stream a single output file's bytes. Used by the chat panel's Outputs
  // tab to download/preview an artifact. Path is workspace-relative; the
  // resolver refuses any traversal outside the workspace.
  router.get('/chat/outputs/file', db.authMiddleware, (req, res) => {
    try {
      const sessionKey = String(req.query.sessionKey || '');
      const relPath = String(req.query.path || '');
      if (!sessionKey || !relPath) {
        return res.status(400).json({ error: 'sessionKey and path query params are required' });
      }
      const ctx = resolveChatSessionContext(sessionKey);
      if (!ctx) return res.status(400).json({ error: 'invalid sessionKey' });
      if (!ensureChatOutputsAccess(req, ctx.agentId)) {
        return res.status(403).json({ error: 'You can only view outputs for agents you own' });
      }
      const file = outputsLib.resolveChatOutputFile(ctx.agentId, relPath);
      if (!file) return res.status(404).json({ error: 'file not found' });
      // Inline preview by default (UI shows in a viewer/iframe). Clients that
      // want a download can set `?download=1` to force the disposition.
      const dispo = req.query.download === '1' ? 'attachment' : 'inline';
      res.setHeader('Content-Type', file.mimeType);
      res.setHeader('Content-Disposition', `${dispo}; filename="${path.basename(file.filename)}"`);
      res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
      fs.createReadStream(file.absPath).pipe(res);
    } catch (err) {
      console.error('[api/chat/outputs/file]', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
