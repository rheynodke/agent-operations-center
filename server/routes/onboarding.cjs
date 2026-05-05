'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');

module.exports = function onboardingRouter(deps) {
  const { db, restartGateway } = deps || {};
  const router = express.Router();
  const provision = require('../lib/agents/provision.cjs');
  const config = require('../lib/config.cjs');

  // Atomic: provision agent with isMaster=true, link to user.
  router.post('/onboarding/master', db.authMiddleware, async (req, res) => {
    const userId = Number(req.user?.userId ?? req.user?.id);
    if (!userId) return res.status(401).json({ error: 'Unauthenticated' });

    if (db.getUserMasterAgentId(userId)) {
      return res.status(409).json({ error: 'User already has a Master Agent' });
    }

    const {
      name, emoji, color, description, templateId,
      avatarPresetId, soulContent,
      channels, channelBinding,
    } = req.body || {};
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name is required' });
    }

    const slug = String(name).toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || `master-${userId}`;

    // Resolve channel bindings: prefer the new `channels` array
    // (ChannelBinding[] shape — `{type, botToken, ...}`).
    // Legacy `channelBinding` (`{channel, accountId, token}`) is mapped onto
    // the modern shape so `provisionAgent` can consume it uniformly.
    let channelArr = [];
    if (Array.isArray(channels) && channels.length > 0) {
      channelArr = channels.filter(c => c && typeof c === 'object' && c.type);
    } else if (channelBinding && channelBinding.channel) {
      const type = channelBinding.channel;
      if (type === 'telegram' || type === 'discord') {
        channelArr = [{ type, botToken: channelBinding.token || '', dmPolicy: 'pairing' }];
      } else if (type === 'whatsapp') {
        channelArr = [{ type: 'whatsapp', dmPolicy: 'pairing', allowFrom: [] }];
      }
    }

    let result;
    try {
      result = provision.provisionAgent({
        id: slug,
        name,
        emoji: emoji || '🧭',
        color: color || '',
        description: description || '',
        soulContent: typeof soulContent === 'string' ? soulContent : '',
        adlcRole: templateId || '',
        isMaster: true,
        channels: channelArr,
      }, userId);
    } catch (err) {
      console.error('[onboarding/master] provision failed', err);
      const code = err.message?.includes('already exists') ? 409 : 500;
      return res.status(code).json({ error: err.message });
    }

    try {
      db.upsertAgentProfile({
        agentId: result.agentId,
        displayName: result.agentName,
        emoji: emoji || '🧭',
        color: color || null,
        description: description || null,
        avatarPresetId: avatarPresetId || null,
        provisionedBy: userId,
      });
      db.markAgentProfileMaster(result.agentId);
      db.setUserMasterAgent(userId, result.agentId);
      // Belt-and-suspenders: enrol the new master into aoc-master in openclaw.json
      // even if provisionAgent's allowlist write was skipped (e.g. legacy path).
      try {
        const aocMaster = require('../lib/aoc-master/installer.cjs');
        aocMaster.ensureSkillEnabledForUserMasters({ masterAgentIds: [result.agentId] });
      } catch (e) {
        console.warn(`[onboarding/master] failed to enrol ${result.agentId} in aoc-master: ${e.message}`);
      }
      // Auto-create a per-user "General" project so the new user's task board /
      // chat / mission rooms have a default home. Done HERE (not at register
      // time) so the project's default room can correctly use the just-created
      // master agent as the always-on member instead of falling back to 'main'.
      try {
        const existing = db.getAllProjects().find(p =>
          Number(p.createdBy) === userId && p.name === 'General'
        );
        if (!existing) {
          db.createProject({
            name: 'General',
            color: '#6366f1',
            description: 'Default project — drop tasks and quick chats here.',
            createdBy: userId,
          });
        }
      } catch (e) {
        console.warn(`[onboarding/master] auto-create General project failed for uid ${userId}: ${e.message}`);
      }
    } catch (err) {
      console.error('[onboarding/master] DB link failed, rolling back', err);
      try { fs.rmSync(result.workspacePath, { recursive: true, force: true }); } catch {}
      return res.status(500).json({ error: 'Failed to link master agent: ' + err.message });
    }

    // Restart the user's gateway so the new agent + channel bindings load.
    // Without this, RPCs like web.login.start fail with "web login provider is
    // not available" because the gateway didn't see the new whatsapp account.
    let gatewayRestarted = false;
    try {
      if (userId === 1) {
        if (typeof restartGateway === 'function') {
          restartGateway(`onboarding master provisioned: ${result.agentId}`);
          gatewayRestarted = true;
        }
      } else {
        const orchestrator = require('../lib/gateway-orchestrator.cjs');
        await orchestrator.restartGateway(userId);
        gatewayRestarted = true;
      }
    } catch (e) {
      console.warn(`[onboarding/master] gateway restart failed (non-fatal): ${e.message}`);
    }

    // NOTE(slice 1.5.f): create HQ Room here when sub-project 3 lands.
    res.status(201).json({ ...result, profileSaved: true, masterLinked: true, gatewayRestarted });
  });

  // One-shot backfill: ensure admin uid=1 has a master assigned if their
  // openclaw.json contains a 'main' agent. Idempotent.
  function runMasterBackfill() {
    try {
      const adminId = 1;
      if (db.getUserMasterAgentId(adminId)) return;
      const cfgPath = path.join(config.OPENCLAW_HOME, 'openclaw.json');
      if (!fs.existsSync(cfgPath)) return;
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      const list = cfg?.agents?.list || [];
      const main = list.find(a => a.id === 'main') || list[0];
      if (!main) return;
      try {
        db.upsertAgentProfile({ agentId: main.id, displayName: main.name || main.id, provisionedBy: adminId });
      } catch {}
      db.markAgentProfileMaster(main.id);
      db.setUserMasterAgent(adminId, main.id);
      console.log(`[onboarding] backfilled master_agent_id=${main.id} for admin user 1`);
    } catch (e) {
      console.warn('[onboarding] runMasterBackfill failed:', e.message);
    }
  }

  router.runMasterBackfill = runMasterBackfill;
  return router;
};
