'use strict';
const express = require('express');

module.exports = function masterRouter({ db, gatewayPool }) {
  const router = express.Router();

  // GET /api/master/team — list this user's sub-agents (excludes the master itself)
  router.get('/master/team', db.authMiddleware, (req, res) => {
    let userId = Number(req.user?.userId ?? req.user?.id);
    // DASHBOARD_TOKEN auth sets userId=0 — resolve the calling agent's owner
    // from X-Agent-Id header or ?agentId= query param.
    if (!userId && req.user?.role === 'agent') {
      const agentId = req.headers['x-agent-id'] || req.query.agentId;
      if (agentId) {
        const owner = db.getAgentOwner(agentId);
        if (owner) userId = Number(owner);
      }
    }
    if (!userId) return res.status(401).json({ error: 'Unauthenticated' });

    const masterId = db.getUserMasterAgentId(userId);
    if (!masterId) return res.status(403).json({ error: 'No Master Agent for this user' });

    const profiles = db.getAllAgentProfiles().filter(p =>
      Number(p.provisioned_by) === userId && p.agent_id !== masterId
    );

    const team = profiles.map(p => ({
      id: p.agent_id,
      name: p.display_name,
      role: p.role || null,
      isMaster: !!p.is_master,
      lastActiveAt: p.last_active_at || null,
    }));

    res.json({ team });
  });

  // POST /api/master/delegate — { targetAgentId, task }
  router.post('/master/delegate', db.authMiddleware, async (req, res) => {
    const userId = Number(req.user?.userId ?? req.user?.id);
    if (!userId) return res.status(401).json({ error: 'Unauthenticated' });

    const masterId = db.getUserMasterAgentId(userId);
    if (!masterId) return res.status(403).json({ error: 'You are not a Master Agent for this user' });

    const { targetAgentId, task } = req.body || {};
    if (!targetAgentId || typeof targetAgentId !== 'string') {
      return res.status(400).json({ error: 'targetAgentId is required' });
    }
    if (!task || typeof task !== 'string' || !task.trim()) {
      return res.status(400).json({ error: 'task is required' });
    }
    if (targetAgentId === masterId) {
      return res.status(400).json({ error: 'Cannot delegate to yourself' });
    }

    const target = db.getAgentProfile(targetAgentId);
    if (!target || Number(target.provisioned_by) !== userId) {
      return res.status(404).json({ error: 'Target agent not found in your team' });
    }

    // Ensure the user's gateway is connected. The pool may have a stale entry
    // from before a restart, or no entry at all (cold start since AOC reload).
    let gw;
    try {
      gw = gatewayPool.forUser(userId);
      if (!gw.isConnected) {
        const orchestrator = require('../lib/gateway-orchestrator.cjs');
        const dbState = orchestrator.getGatewayState(userId);
        const token = orchestrator.getRunningToken(userId);
        if (dbState?.state === 'running' && dbState?.port && token) {
          gw.connect({ port: dbState.port, token });
          const start = Date.now();
          while (!gw.isConnected && Date.now() - start < 4000) {
            await new Promise(r => setTimeout(r, 100));
          }
        }
        if (!gw.isConnected) {
          return res.status(503).json({ error: 'Gateway not connected. Try again in a moment.' });
        }
      }
    } catch (e) {
      return res.status(503).json({ error: 'Gateway unavailable: ' + e.message });
    }

    const sessionKey = `master-delegate-${masterId}-${targetAgentId}`;

    let createResult;
    try {
      createResult = await gw.sessionsCreate(targetAgentId, {
        key: sessionKey,
        label: `Delegation from ${masterId}`,
      });
    } catch (e) {
      return res.status(502).json({ error: 'sessions.create failed: ' + e.message });
    }

    const finalSessionKey = createResult?.sessionKey || sessionKey;
    const message =
      `[Delegation from Master Agent (${masterId})]\n\n` +
      task.trim() +
      `\n\n— end of delegation brief —`;

    try {
      await gw.chatSend(finalSessionKey, message);
    } catch (e) {
      console.warn(`[master/delegate] chat.send failed for ${finalSessionKey}: ${e.message}`);
      return res.status(207).json({
        sessionKey: finalSessionKey,
        targetAgentId,
        warning: 'Session created but initial message failed; retry chat.send manually.',
      });
    }

    console.log(`[master/delegate] uid=${userId} ${masterId} → ${targetAgentId} session=${finalSessionKey}`);

    // Broadcast delegation as system message into the user's HQ room.
    try {
      const hqRoom = require('../lib/hq-room.cjs');
      const targetName = target?.display_name || target?.displayName || targetAgentId;
      const taskSummary = String(task || '').trim().slice(0, 200) + (String(task || '').length > 200 ? '…' : '');
      hqRoom.postHqSystemMessage(db, userId, `🧭 ${masterId} → ${targetName}: ${taskSummary}`, {
        meta: { kind: 'delegation', sessionKey: finalSessionKey, masterId, targetAgentId },
      });
    } catch (e) {
      console.warn(`[master/delegate] HQ broadcast failed (non-fatal): ${e.message}`);
    }

    res.status(201).json({ sessionKey: finalSessionKey, targetAgentId, masterAgentId: masterId });
  });

  return router;
};
