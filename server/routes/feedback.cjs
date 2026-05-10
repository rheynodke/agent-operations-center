'use strict';

/**
 * routes/feedback.cjs
 *
 * Satisfaction feedback REST endpoints.
 * - POST /feedback/message            (Phase 1 — dashboard button)
 * - GET  /feedback/messages?sessionId  (Phase 1 — render thumb states)
 * - POST /feedback/channel-reaction    (internal, used by reaction-bridge in Phase 2/3)
 * - POST /feedback/internal/reflect    (Phase 1 — admin manual trigger)
 * - GET  /satisfaction/agent/:id/metrics
 * - GET  /satisfaction/agent/:id/flagged-messages
 * - GET  /satisfaction/health
 *
 * See spec §8.3.
 */

module.exports = function feedbackRouter(deps) {
  const { db } = deps;
  const router = require('express').Router();

  const VALID_RATINGS = new Set(['positive', 'negative']);
  const VALID_CHANNELS = new Set(['dashboard', 'telegram', 'whatsapp', 'discord', 'reflection']);
  const VALID_SOURCES = new Set(['button', 'reaction', 'nl_correction']);

  function ensureAuth(req, res) {
    if (!req.user) {
      res.status(401).json({ error: 'unauthorized' });
      return false;
    }
    return true;
  }

  // POST /api/feedback/message — dashboard button click
  router.post('/feedback/message', db.authMiddleware, (req, res) => {
    if (!ensureAuth(req, res)) return;

    const { messageId, sessionId, agentId, rating, reason } = req.body || {};
    if (!messageId || !sessionId || !agentId) {
      return res.status(400).json({ error: 'messageId, sessionId, agentId required' });
    }
    if (!VALID_RATINGS.has(rating)) {
      return res.status(400).json({ error: `rating must be one of: ${[...VALID_RATINGS].join(', ')}` });
    }

    let ownerId;
    try {
      ownerId = typeof db.getAgentOwner === 'function'
        ? (db.getAgentOwner(agentId, req.user.userId) ?? req.user.userId)
        : req.user.userId;
    } catch (e) {
      return res.status(500).json({ error: 'owner lookup failed' });
    }

    db.recordRating({
      messageId, sessionId, agentId, ownerId,
      channel: 'dashboard', source: 'button', rating,
      reason: reason || null,
      raterExternalId: null,
      createdAt: Date.now(),
    });
    return res.json({ ok: true });
  });

  // GET /api/feedback/messages?sessionId=… — list ratings for a session
  router.get('/feedback/messages', db.authMiddleware, (req, res) => {
    if (!ensureAuth(req, res)) return;
    const { sessionId, agentId } = req.query;
    if (!sessionId && !agentId) {
      return res.status(400).json({ error: 'sessionId or agentId required' });
    }
    const rows = db.getMessageRatings({ sessionId, agentId });
    return res.json({ ratings: rows });
  });

  // POST /api/feedback/channel-reaction — internal (service token gated)
  router.post('/feedback/channel-reaction', db.authMiddleware, (req, res) => {
    if (!ensureAuth(req, res)) return;
    if (req.user.role !== 'agent' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'service or admin token required' });
    }
    const { messageId, sessionId, agentId, channel, rating, raterExternalId, ownerId } = req.body || {};
    if (!messageId || !sessionId || !agentId || !channel || !rating || !ownerId) {
      return res.status(400).json({ error: 'messageId, sessionId, agentId, channel, rating, ownerId required' });
    }
    if (!VALID_RATINGS.has(rating)) return res.status(400).json({ error: 'invalid rating' });
    if (!VALID_CHANNELS.has(channel)) return res.status(400).json({ error: 'invalid channel' });

    db.recordRating({
      messageId, sessionId, agentId, ownerId,
      channel, source: 'reaction', rating,
      reason: null, raterExternalId: raterExternalId || null,
      createdAt: Date.now(),
    });
    return res.json({ ok: true });
  });

  // GET /api/satisfaction/agent/:id/metrics?range=7d|30d|90d|all
  router.get('/satisfaction/agent/:agentId/metrics', db.authMiddleware, (req, res) => {
    if (!ensureAuth(req, res)) return;
    const { agentId } = req.params;
    const range = (req.query.range || '7d').toLowerCase();
    const channel = req.query.channel || 'all';

    const today = new Date().toISOString().slice(0, 10);
    const days = range === '7d' ? 7 : range === '30d' ? 30 : range === '90d' ? 90 : 365 * 5;
    const fromDate = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

    const ownerId = (typeof db.getAgentOwner === 'function')
      ? (db.getAgentOwner(agentId, req.user.userId) ?? req.user.userId)
      : req.user.userId;

    const metrics = db.getDailyMetrics({ agentId, ownerId, fromDay: fromDate, toDay: today, channel });
    return res.json({ agentId, ownerId, range, channel, metrics });
  });

  // GET /api/satisfaction/agent/:id/flagged-messages?limit=20
  router.get('/satisfaction/agent/:agentId/flagged-messages', db.authMiddleware, (req, res) => {
    if (!ensureAuth(req, res)) return;
    const { agentId } = req.params;
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));

    const all = db.getMessageRatings({ agentId });
    const flagged = all
      .filter(r => r.rating === 'negative')
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
    return res.json({ agentId, flagged });
  });

  // GET /api/satisfaction/health — reflection + provider status
  router.get('/satisfaction/health', db.authMiddleware, (req, res) => {
    if (!ensureAuth(req, res)) return;
    let queueStats = { inFlight: 0, pending: 0, concurrency: 0, maxQueue: 0 };
    try {
      const reflection = require('../lib/reflection-service.cjs');
      if (typeof reflection.getQueueStats === 'function') {
        queueStats = reflection.getQueueStats();
      }
    } catch {}

    return res.json({
      reflection: {
        queue_depth: queueStats.pending,
        in_flight: queueStats.inFlight,
        concurrency: queueStats.concurrency,
        max_queue: queueStats.maxQueue,
      },
      llm_provider: {
        name: process.env.REFLECTION_LLM_PROVIDER || 'claude-code',
        model: process.env.REFLECTION_LLM_MODEL || 'claude-haiku-4-5',
      },
    });
  });

  // POST /api/feedback/internal/reflect — manual trigger by admin OR agent owner.
  // Phase 1 entry point. Phase 5 replaces with OpenClaw session_end webhook.
  // Body: { sessionId, agentId, mockLlm? } — server derives ownerId, workspace,
  // jsonlPath from agentId so the UI doesn't have to know filesystem layout.
  router.post('/feedback/internal/reflect', db.authMiddleware, async (req, res) => {
    if (!ensureAuth(req, res)) return;
    const { sessionId, agentId, mockLlm } = req.body || {};
    if (!sessionId || !agentId) {
      return res.status(400).json({ error: 'sessionId, agentId required' });
    }

    // Authorize: admin OR owner of this agent.
    const { userOwnsAgent } = require('../lib/db/agent-profiles.cjs');
    if (req.user.role !== 'admin' && !userOwnsAgent(req, agentId)) {
      return res.status(403).json({ error: 'forbidden: not admin and not agent owner' });
    }

    // Derive ownerId, workspace, jsonlPath from agentId + sessionId.
    const path = require('node:path');
    const fs = require('fs');
    const ownerId = (typeof db.getAgentOwner === 'function' ? db.getAgentOwner(agentId) : null) ?? req.user.userId ?? 0;
    const { getAgentWorkspacePath } = require('../lib/outputs.cjs');
    const { getUserHome } = require('../lib/config.cjs');
    const workspace = getAgentWorkspacePath(agentId);

    // Resolve jsonl path. Dashboard session keys ("agent:<id>:<channel>:<uuid>")
    // are mapped to the *real* jsonl filename inside `sessions.json` because the
    // chat-key UUID and the gateway session UUID are independent. Bare UUIDs
    // fall through to direct path resolution.
    const home = ownerId === 1 ? require('../lib/config.cjs').OPENCLAW_BASE : getUserHome(ownerId);
    const sessionsDir = path.join(home, 'agents', agentId, 'sessions');
    let jsonlPath = null;
    try {
      const sessionsIndex = JSON.parse(fs.readFileSync(path.join(sessionsDir, 'sessions.json'), 'utf8'));
      const rec = sessionsIndex[sessionId];
      if (rec?.sessionFile && fs.existsSync(rec.sessionFile)) {
        jsonlPath = rec.sessionFile;
      } else if (rec?.sessionId) {
        const candidate = path.join(sessionsDir, `${rec.sessionId}.jsonl`);
        if (fs.existsSync(candidate)) jsonlPath = candidate;
      }
    } catch (_) { /* index missing or unreadable — fall through */ }

    if (!jsonlPath) {
      const lastColon = sessionId.lastIndexOf(':');
      const sessionUuid = lastColon >= 0 ? sessionId.slice(lastColon + 1) : sessionId;
      if (!/^[a-zA-Z0-9._-]+$/.test(sessionUuid)) {
        return res.status(400).json({ error: 'invalid sessionId — bad uuid segment' });
      }
      const candidate = path.join(sessionsDir, `${sessionUuid}.jsonl`);
      if (fs.existsSync(candidate)) jsonlPath = candidate;
    }

    if (!jsonlPath) {
      return res.status(404).json({ error: `jsonl not found for session ${sessionId}` });
    }

    const raw = fs.readFileSync(jsonlPath, 'utf8');
    const messages = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.type === 'message' || obj.role) messages.push(obj);
      } catch {}
    }

    const ratings = db.getMessageRatings({ sessionId });

    let provider;
    if (mockLlm) {
      provider = {
        complete: async () => ({
          text: JSON.stringify({
            schema_version: '1', session_quality: 'mixed',
            flagged_messages: [], lessons: [], validated_examples: [],
          }),
          inputTokens: 100, outputTokens: 30, modelUsed: 'mock',
          providerLatencyMs: 1,
        }),
      };
    } else {
      const { getProvider } = require('../lib/llm-providers/index.cjs');
      provider = getProvider(process.env.REFLECTION_LLM_PROVIDER || 'claude-code');
    }

    const reflection = require('../lib/reflection-service.cjs');
    const lessons = require('../lib/lessons-writer.cjs');

    try {
      const result = await reflection.reflectSession({
        sessionId, agentId, ownerId,
        messages, ratings,
        workspace, jsonlPath,
        deps: {
          provider,
          recordRating: db.recordRating,
          upsertSessionSummary: db.upsertSessionSummary,
          writeLessonsForSession: lessons.writeLessonsForSession,
        },
      });
      return res.json({ ok: true, ...result });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  return router;
};
