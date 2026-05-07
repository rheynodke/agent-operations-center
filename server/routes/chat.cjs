/**
 * routes/chat.cjs
 *
 * Chat API (Gateway WebSocket Proxy) — send, history, abort,
 * session management, SSE message streaming.
 * Step 9c of server modularization.
 */
'use strict';

const { gatewayForReq } = require('../helpers/gateway-context.cjs');

module.exports = function chatRouter(deps) {
  const { db, parsers, loadAllJSONLMessagesForTask } = deps;
  const router = require('express').Router();
  const path = require('path');

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
    const message = (text || '').trim();
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


  return router;
};
