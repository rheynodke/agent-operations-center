/**
 * helpers/agent-context.cjs
 *
 * Enrichment / context helpers for agents. Used by REST responses, WS init,
 * room agent lists, and mention resolution.
 */
'use strict';

const path = require('path');
const fs = require('fs');

/** Read a single **Field:** value from markdown content */
function readMdField(content, fieldName) {
  if (!content) return '';
  const re = new RegExp(`\\*\\*${fieldName}:\\*\\*\\s*(.+)`, 'i');
  const m = content.match(re);
  return m ? m[1].trim() : '';
}

/** Read IDENTITY.md vibe for an agent */
function readAgentVibe(agent, config) {
  const { OPENCLAW_HOME, OPENCLAW_WORKSPACE, AGENTS_DIR } = config;

  // Agent-specific workspace first, then agents dir, then global workspace
  const candidatePaths = [
    agent.workspace && path.join(agent.workspace, 'IDENTITY.md'),
    path.join(AGENTS_DIR, agent.id, 'IDENTITY.md'),
    agent.id === 'main' ? path.join(OPENCLAW_WORKSPACE, 'IDENTITY.md') : null,
  ].filter(Boolean);

  for (const p of candidatePaths) {
    try {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf-8');
        const vibe = readMdField(content, 'Vibe') || readMdField(content, 'Theme');
        if (vibe) return vibe;
      }
    } catch {}
  }
  return '';
}

/**
 * Build enriched agent list with profile data, session stats, and channel info.
 *
 * @param {{ parsers: object, db: object, config: object }} deps
 * @returns {object[]}
 */
function getEnrichedAgents(deps) {
  const { parsers, db, config } = deps;
  const agents = parsers.parseAgentRegistry();

  // SQLite profiles
  const profiles = db.getAllAgentProfiles();
  const profileMap = Object.fromEntries(profiles.map(p => [p.agent_id, p]));

  // Per-agent session stats (single pass over gateway sessions)
  const allSessions = parsers.parseGatewaySessions();
  const statsMap = {};
  for (const s of allSessions) {
    const id = s.agent;
    if (!id) continue;
    if (!statsMap[id]) statsMap[id] = { sessionCount: 0, totalCost: 0, totalTokens: 0 };
    statsMap[id].sessionCount++;
    statsMap[id].totalCost   += parseFloat(s.cost) || 0;
    statsMap[id].totalTokens += (s.tokensIn || 0) + (s.tokensOut || 0);
  }

  // Channel type detection (single openclaw.json read)
  const oclawPath = path.join(config.OPENCLAW_HOME, 'openclaw.json');
  const oclaw = (() => { try { return JSON.parse(fs.readFileSync(oclawPath, 'utf8')); } catch { return {}; } })();
  const bindings = oclaw.bindings  || [];
  const chCfg    = oclaw.channels  || {};
  const tgAccts  = chCfg.telegram?.accounts || {};
  const waAccts  = chCfg.whatsapp?.accounts || {};
  const dcAccts  = chCfg.discord?.accounts  || {};

  function agentChannelTypes(agentId) {
    const types = new Set();
    const keys = new Set([agentId, ...(agentId === 'main' ? ['default'] : [])]);
    if (bindings.some(b => b.agentId === agentId && b.match?.channel === 'telegram')) types.add('telegram');
    for (const k of keys) if (tgAccts[k]) types.add('telegram');
    if (bindings.some(b => b.agentId === agentId && b.match?.channel === 'whatsapp')) types.add('whatsapp');
    for (const k of keys) if (waAccts[k]) types.add('whatsapp');
    if (bindings.some(b => b.agentId === agentId && b.match?.channel === 'discord')) types.add('discord');
    for (const k of keys) if (dcAccts[k]) types.add('discord');
    if (chCfg.discord?.token && bindings.some(b => b.agentId === agentId && b.match?.channel === 'discord')) types.add('discord');
    return [...types];
  }

  return agents.map(a => {
    const st = statsMap[a.id] || {};
    return {
      ...a,
      color:          profileMap[a.id]?.color || null,
      description:    profileMap[a.id]?.description || null,
      hasAvatar:      !!profileMap[a.id]?.avatar_data,
      avatarPresetId: profileMap[a.id]?.avatar_preset_id || null,
      role:           profileMap[a.id]?.role || null,
      provisionedBy:  profileMap[a.id]?.provisioned_by ?? null,
      vibe:           readAgentVibe(a, config) || null,
      sessionCount:   st.sessionCount  || 0,
      totalCost:      st.totalCost  ? Math.round(st.totalCost  * 10000) / 10000 : null,
      totalTokens:    st.totalTokens || null,
      channels:       agentChannelTypes(a.id),
    };
  });
}

/**
 * Get display name for an agent.
 *
 * @param {string} agentId
 * @param {{ parsers: object, db: object, config: object }} deps
 * @returns {string|null}
 */
function getAgentDisplayName(agentId, deps) {
  if (!agentId) return null;
  try {
    const agent = getEnrichedAgents(deps).find(a => a.id === agentId);
    return agent?.name || agent?.displayName || agentId;
  } catch (_) {
    return agentId;
  }
}

/**
 * Get enriched agent objects for room members.
 *
 * @param {object} room
 * @param {{ parsers: object, db: object, config: object }} deps
 * @returns {object[]}
 */
function roomAgents(room, deps) {
  const agents = getEnrichedAgents(deps);
  return (room.memberAgentIds || []).map((id) => {
    const agent = agents.find(a => a.id === id);
    return agent || { id, name: id === 'main' ? 'Main' : id, emoji: id === 'main' ? '🧭' : '🤖', status: 'idle', type: 'gateway' };
  });
}

/**
 * Resolve @mentions in message body to agent IDs.
 *
 * @param {object} req
 * @param {object} room
 * @param {string} body
 * @param {string[]} explicitMentions
 * @param {{ parsers: object, db: object, config: object }} deps
 * @param {{ validateAccessibleAgentIds: Function }} accessControl
 * @returns {string[]}
 */
function resolveMentions(req, room, body, explicitMentions, deps, accessControl) {
  const agents = roomAgents(room, deps);
  const requested = new Set((Array.isArray(explicitMentions) ? explicitMentions : []).map(String).filter(Boolean));
  const lowerBody = String(body || '').toLowerCase();
  for (const agent of agents) {
    const labels = [agent.id, agent.name, agent.displayName].filter(Boolean).map(v => String(v).toLowerCase());
    if (labels.some(label => lowerBody.includes(`@${label}`))) requested.add(agent.id);
  }
  return accessControl.validateAccessibleAgentIds(req, [...requested], deps.db).filter(id => room.memberAgentIds.includes(id));
}

module.exports = {
  readMdField,
  readAgentVibe,
  getEnrichedAgents,
  getAgentDisplayName,
  roomAgents,
  resolveMentions,
};
