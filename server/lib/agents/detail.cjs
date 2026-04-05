'use strict';
const fs   = require('fs');
const path = require('path');
const { OPENCLAW_HOME, OPENCLAW_WORKSPACE, AGENTS_DIR, readJsonSafe } = require('../config.cjs');
const { parseGatewaySessions } = require('../sessions/gateway.cjs');
// lazy require to avoid tight coupling (prevents circular dep risk)
const getAvailableModels = (...args) => require('../models.cjs').getAvailableModels(...args);

// ── MD helpers ───────────────────────────────────────────────────────────────

function readMdFile(filePath) {
  try {
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf-8');
  } catch {}
  return null;
}

function parseMdFields(content) {
  if (!content) return {};
  const fields = {};
  const lines = content.split('\n');
  for (const line of lines) {
    const match = line.match(/^-\s*\*\*(.+?):\*\*\s*(.+)/);
    if (match) {
      const key = match[1].trim().toLowerCase();
      fields[key] = match[2].trim();
    }
  }
  return fields;
}

function parseSoulTraits(content) {
  if (!content) return { description: '', traits: [] };
  const lines = content.split('\n');
  let description = '';
  const traits = [];

  for (const line of lines) {
    const italicMatch = line.match(/^_(.+)_$/);
    if (italicMatch && !description) { description = italicMatch[1]; continue; }
  }
  for (const line of lines) {
    const boldMatch = line.match(/^\*\*(.+?)\.\*\*/);
    if (boldMatch) traits.push(boldMatch[1].trim());
  }

  return { description, traits };
}

function parseToolsSections(content) {
  if (!content) return [];
  const tools = [];
  const lines = content.split('\n');
  let currentSection = null;

  for (const line of lines) {
    const h3 = line.match(/^###\s+(.+)/);
    if (h3) { currentSection = h3[1].trim(); tools.push({ name: currentSection, items: [] }); continue; }
    if (currentSection && tools.length > 0) {
      const item = line.match(/^-\s+(.+)/);
      if (item) tools[tools.length - 1].items.push(item[1].trim());
    }
  }
  return tools;
}

// ── Main functions ────────────────────────────────────────────────────────────

function getAgentDetail(agentId) {
  const configPath = path.join(OPENCLAW_HOME, 'openclaw.json');
  const config = readJsonSafe(configPath);
  if (!config) return null;

  const agentList = config.agents?.list || [];
  const agentConfig = agentList.find(a => a.id === agentId);
  if (!agentConfig) return null;

  const defaultModel = config.agents?.defaults?.model?.primary || '';

  const agentWorkspace = agentConfig.workspace || OPENCLAW_WORKSPACE;
  const agentDir = path.join(AGENTS_DIR, agentId);

  const identityContent = readMdFile(path.join(agentWorkspace, 'IDENTITY.md'))
    || readMdFile(path.join(OPENCLAW_WORKSPACE, 'IDENTITY.md'));
  const soulContent = readMdFile(path.join(agentWorkspace, 'SOUL.md'))
    || readMdFile(path.join(OPENCLAW_WORKSPACE, 'SOUL.md'));
  const toolsContent = readMdFile(path.join(agentWorkspace, 'TOOLS.md'))
    || readMdFile(path.join(OPENCLAW_WORKSPACE, 'TOOLS.md'));
  const agentsContent = readMdFile(path.join(agentWorkspace, 'AGENTS.md'));
  const userContent = readMdFile(path.join(agentWorkspace, 'USER.md'))
    || readMdFile(path.join(OPENCLAW_WORKSPACE, 'USER.md'));

  const identityFields = parseMdFields(identityContent);
  const soulData = parseSoulTraits(soulContent);
  const toolsSections = parseToolsSections(toolsContent);

  let model = typeof agentConfig.model === 'string' ? agentConfig.model :
    (agentConfig.model ? `${agentConfig.model.provider || ''}/${agentConfig.model.name || ''}` : '');
  if (!model) model = defaultModel;

  const identity = {
    name: agentConfig.identity?.name || agentConfig.name || identityFields.name || agentId,
    emoji: agentConfig.identity?.emoji || identityFields.emoji || (agentId === 'main' ? '🤡' : '🤖'),
    creature: identityFields.creature || '',
    vibe: identityFields.vibe || agentConfig.identity?.theme || '',
  };

  const allSessions = parseGatewaySessions().filter(s => s.agent === agentId);
  const activeSessions = allSessions.filter(s => s.status === 'active');
  const totalCost = allSessions.reduce((sum, s) => sum + (parseFloat(s.cost) || 0), 0);
  const totalTokens = allSessions.reduce((sum, s) => sum + (s.tokensIn || 0) + (s.tokensOut || 0), 0);
  const totalMessages = allSessions.reduce((sum, s) => sum + (s.messageCount || 0), 0);
  const totalToolCalls = allSessions.reduce((sum, s) => sum + (s.toolCalls || 0), 0);

  const channels = config.channels || {};
  const telegramAccounts = channels.telegram?.accounts || {};
  let channelInfo = null;
  const accountKey = agentId === 'main' ? 'default' : agentId;
  if (telegramAccounts[accountKey]) {
    channelInfo = {
      type: 'telegram',
      accountId: accountKey,
      streaming: telegramAccounts[accountKey].streaming || 'off',
      dmPolicy: telegramAccounts[accountKey].dmPolicy || 'none',
    };
  }

  const recentActivity = allSessions.slice(0, 10).map(s => ({
    id: s.id,
    name: s.name,
    type: s.type,
    status: s.status,
    lastMessage: s.lastMessage,
    updatedAt: s.updatedAt,
    messageCount: s.messageCount,
  }));

  const availableModels = getAvailableModels(config);

  const allTelegramAccounts = channels.telegram?.accounts || {};
  const availableChannels = Object.entries(allTelegramAccounts).map(([key, acc]) => ({
    accountId: key,
    streaming: acc.streaming || 'off',
    dmPolicy: acc.dmPolicy || 'none',
  }));

  return {
    id: agentId,
    config: agentConfig,
    model,
    identity,
    soul: { description: soulData.description, traits: soulData.traits, raw: soulContent || '' },
    tools: { sections: toolsSections, raw: toolsContent || '' },
    workspace: {
      path: agentWorkspace,
      agentDir,
      hasCustomWorkspace: agentWorkspace !== OPENCLAW_WORKSPACE,
      files: {
        identity: identityContent ? true : false,
        soul: soulContent ? true : false,
        tools: toolsContent ? true : false,
        agents: agentsContent ? true : false,
        user: userContent ? true : false,
      },
    },
    channel: channelInfo,
    availableModels,
    availableChannels,
    stats: {
      totalSessions: allSessions.length,
      activeSessions: activeSessions.length,
      totalCost: Math.round(totalCost * 10000) / 10000,
      totalTokens,
      totalMessages,
      totalToolCalls,
    },
    sessions: recentActivity,
    status: activeSessions.length > 0 ? 'active' : 'idle',
  };
}

function updateAgent(agentId, updates) {
  const configPath = path.join(OPENCLAW_HOME, 'openclaw.json');
  const config = readJsonSafe(configPath);
  if (!config) throw new Error('Cannot read openclaw.json');

  const agentList = config.agents?.list || [];
  const idx = agentList.findIndex(a => a.id === agentId);
  if (idx === -1) throw new Error(`Agent "${agentId}" not found`);

  const agent = agentList[idx];
  const agentWorkspace = agent.workspace || OPENCLAW_WORKSPACE;
  const changed = [];

  if (updates.name !== undefined) {
    agent.name = updates.name;
    if (!agent.identity) agent.identity = {};
    agent.identity.name = updates.name;
    changed.push('name');
  }
  if (updates.emoji !== undefined) {
    if (!agent.identity) agent.identity = {};
    agent.identity.emoji = updates.emoji;
    changed.push('emoji');
  }
  if (updates.model !== undefined) { agent.model = updates.model; changed.push('model'); }
  if (updates.theme !== undefined) {
    if (!agent.identity) agent.identity = {};
    agent.identity.theme = updates.theme;
    changed.push('theme');
  }

  if (updates.channel !== undefined) {
    const ch = updates.channel;
    if (!config.channels) config.channels = {};
    if (!config.channels.telegram) config.channels.telegram = { enabled: true, accounts: {} };
    if (!config.channels.telegram.accounts) config.channels.telegram.accounts = {};

    const oldKey = agentId === 'main' ? 'default' : agentId;
    let targetKey = ch.accountId !== undefined ? ch.accountId : oldKey;

    const existingAccount = config.channels.telegram.accounts[oldKey] || {};
    if (!config.channels.telegram.accounts[targetKey]) {
      config.channels.telegram.accounts[targetKey] = { ...existingAccount };
    }

    const acct = config.channels.telegram.accounts[targetKey];
    if (ch.streaming !== undefined) acct.streaming = ch.streaming;
    if (ch.dmPolicy !== undefined)  acct.dmPolicy  = ch.dmPolicy;
    config.channels.telegram.accounts[targetKey] = acct;
    changed.push('channel');

    if (targetKey !== oldKey) { agent.channelAccount = targetKey; changed.push('channelAccount'); }
  }

  if (changed.length > 0) {
    agentList[idx] = agent;
    config.agents.list = agentList;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  }

  if (updates.identityMd !== undefined) {
    fs.writeFileSync(path.join(agentWorkspace, 'IDENTITY.md'), updates.identityMd, 'utf-8');
    changed.push('IDENTITY.md');
  }
  if (updates.soulMd !== undefined) {
    fs.writeFileSync(path.join(agentWorkspace, 'SOUL.md'), updates.soulMd, 'utf-8');
    changed.push('SOUL.md');
  }

  return { agentId, changed };
}

module.exports = { readMdFile, parseMdFields, parseSoulTraits, parseToolsSections, getAgentDetail, updateAgent };
