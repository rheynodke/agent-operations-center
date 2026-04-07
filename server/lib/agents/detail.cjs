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

  // Capture old name before mutating, for file heading replacements
  const oldName = agent.name || agent.identity?.name || agentId;

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

  // Auto-sync IDENTITY.md when name/emoji/theme changes
  const identityFields = ['name', 'emoji', 'theme'];
  const identityChanged = identityFields.some(f => updates[f] !== undefined);
  if (identityChanged) {
    const name  = agent.name || agent.identity?.name || agentId;
    const emoji = agent.identity?.emoji || '🤖';
    const theme = agent.identity?.theme || agent.identity?.vibe || '';
    const description = agent.identity?.description || '';
    const lines = [
      `# IDENTITY.md - Who Am I?`,
      '',
      `- **Name:** ${name}`,
      `- **Emoji:** ${emoji}`,
      theme       ? `- **Vibe:** ${theme}` : null,
      description ? `- **Role:** ${description}` : null,
    ].filter(l => l !== null).join('\n') + '\n';
    const identityPath = path.join(agentWorkspace, 'IDENTITY.md');
    if (fs.existsSync(path.dirname(identityPath))) {
      fs.writeFileSync(identityPath, lines, 'utf-8');
      changed.push('IDENTITY.md');
    }
  }

  // Sync other workspace files when name changes
  if (updates.name !== undefined && updates.name !== oldName) {
    const newName = updates.name;

    // Helper: read file, apply replacements, write back only if changed
    function syncFileHeadings(filename, replacements) {
      const filePath = path.join(agentWorkspace, filename);
      if (!fs.existsSync(filePath)) return;
      let content = fs.readFileSync(filePath, 'utf-8');
      let modified = false;
      for (const [from, to] of replacements) {
        if (content.includes(from)) {
          content = content.split(from).join(to);
          modified = true;
        }
      }
      if (modified) {
        fs.writeFileSync(filePath, content, 'utf-8');
        changed.push(filename);
      }
    }

    // SOUL.md is entirely about this agent — replace all occurrences of the old name
    syncFileHeadings('SOUL.md', [
      [oldName, newName],
    ]);

    syncFileHeadings('TOOLS.md', [
      [`## Available to ${oldName}`, `## Available to ${newName}`],
    ]);

    syncFileHeadings('AGENTS.md', [
      [`# AGENTS.md - ${oldName}'s Workspace`, `# AGENTS.md - ${newName}'s Workspace`],
      [`This workspace belongs to **${oldName}**`, `This workspace belongs to **${newName}**`],
    ]);
  }

  if (updates.identityMd !== undefined) {
    fs.writeFileSync(path.join(agentWorkspace, 'IDENTITY.md'), updates.identityMd, 'utf-8');
    if (!changed.includes('IDENTITY.md')) changed.push('IDENTITY.md');
  }
  if (updates.soulMd !== undefined) {
    fs.writeFileSync(path.join(agentWorkspace, 'SOUL.md'), updates.soulMd, 'utf-8');
    if (!changed.includes('SOUL.md')) changed.push('SOUL.md');
  }

  return { agentId, changed };
}

// ── Channel management ────────────────────────────────────────────────────────

/**
 * Returns all channel bindings for an agent across all channel types.
 * Shape: { telegram: [...], whatsapp: [...] }
 *
 * Supports two discovery strategies:
 * 1. Explicit bindings in config.bindings[].agentId === agentId
 * 2. Convention-based: account key equals agentId (or "default" for main agent)
 *    — used by agents provisioned outside the dashboard or in legacy configs
 */
function getAgentChannels(agentId) {
  const configPath = path.join(OPENCLAW_HOME, 'openclaw.json');
  const config = readJsonSafe(configPath);
  if (!config) throw new Error('Cannot read openclaw.json');

  const agentList = config.agents?.list || [];
  if (!agentList.find(a => a.id === agentId)) throw new Error(`Agent "${agentId}" not found`);

  const channels = config.channels || {};

  // Strategy 1: explicit binding entries
  const bindings = (config.bindings || []).filter(b => b.agentId === agentId);

  // Strategy 2: convention-based account keys (agentId itself, or "default" for main)
  const conventionKeys = new Set([agentId, ...(agentId === 'main' ? ['default'] : [])]);

  // ── Telegram ──────────────────────────────────────────────────────────
  const telegramAccounts = channels.telegram?.accounts || {};

  // Collect account IDs from explicit bindings
  const telegramIds = new Set(
    bindings.filter(b => b.match?.channel === 'telegram').map(b => b.match.accountId)
  );
  // Add convention-based keys that actually exist as accounts
  for (const k of conventionKeys) {
    if (telegramAccounts[k]) telegramIds.add(k);
  }

  const telegram = [...telegramIds].map(acctId => {
    const acct = telegramAccounts[acctId] || {};
    return {
      type: 'telegram',
      accountId: acctId,
      botToken: acct.botToken || '',
      dmPolicy: acct.dmPolicy || 'pairing',
      streaming: acct.streaming || 'partial',
    };
  });

  // ── WhatsApp ──────────────────────────────────────────────────────────
  const whatsappAccounts = channels.whatsapp?.accounts || {};

  const whatsappIds = new Set(
    bindings.filter(b => b.match?.channel === 'whatsapp').map(b => b.match.accountId)
  );
  for (const k of conventionKeys) {
    if (whatsappAccounts[k]) whatsappIds.add(k);
  }

  const whatsapp = [...whatsappIds].map(acctId => {
    const acct = whatsappAccounts[acctId] || {};
    return {
      type: 'whatsapp',
      accountId: acctId,
      dmPolicy: acct.dmPolicy || 'pairing',
      allowFrom: acct.allowFrom || [],
      pairingRequired: !acct.authenticated,
    };
  });

  return { telegram, whatsapp };
}

/**
 * Add a new channel binding for an agent.
 * opts: { type: 'telegram'|'whatsapp', botToken?, dmPolicy?, streaming?, allowFrom? }
 */
function addAgentChannel(agentId, opts) {
  const configPath = path.join(OPENCLAW_HOME, 'openclaw.json');
  const config = readJsonSafe(configPath);
  if (!config) throw new Error('Cannot read openclaw.json');

  const agentList = config.agents?.list || [];
  if (!agentList.find(a => a.id === agentId)) throw new Error(`Agent "${agentId}" not found`);

  if (!opts.type || !['telegram', 'whatsapp'].includes(opts.type)) {
    throw new Error('type must be "telegram" or "whatsapp"');
  }

  if (!config.channels) config.channels = {};
  if (!config.bindings) config.bindings = [];

  // Use agentId as accountId (one account per agent per channel type)
  const accountId = agentId;

  if (opts.type === 'telegram') {
    if (!opts.botToken || !opts.botToken.trim()) throw new Error('botToken is required for Telegram');
    if (!/^\d+:[A-Za-z0-9_-]+$/.test(opts.botToken.trim())) {
      throw new Error('Telegram bot token format is invalid (expected: 123456:ABC-DEF...)');
    }
    if (!config.channels.telegram) config.channels.telegram = { enabled: true, accounts: {} };
    if (!config.channels.telegram.accounts) config.channels.telegram.accounts = {};
    config.channels.telegram.accounts[accountId] = {
      botToken: opts.botToken.trim(),
      dmPolicy: opts.dmPolicy || 'pairing',
      streaming: opts.streaming || 'partial',
    };
  } else if (opts.type === 'whatsapp') {
    if (!config.channels.whatsapp) config.channels.whatsapp = { accounts: {} };
    if (!config.channels.whatsapp.accounts) config.channels.whatsapp.accounts = {};
    config.channels.whatsapp.accounts[accountId] = {
      dmPolicy: opts.dmPolicy || 'pairing',
      ...(opts.allowFrom && opts.allowFrom.length > 0 ? { allowFrom: opts.allowFrom } : {}),
    };
  }

  // Add binding if not already present
  const alreadyBound = config.bindings.some(
    b => b.agentId === agentId && b.match?.channel === opts.type && b.match?.accountId === accountId
  );
  if (!alreadyBound) {
    config.bindings.push({
      type: 'route',
      agentId,
      match: { channel: opts.type, accountId },
    });
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

  return {
    ok: true,
    channel: opts.type,
    accountId,
    whatsappPairingRequired: opts.type === 'whatsapp',
  };
}

/**
 * Remove a channel binding for an agent.
 * type: 'telegram' | 'whatsapp', accountId: string
 */
function removeAgentChannel(agentId, channelType, accountId) {
  const configPath = path.join(OPENCLAW_HOME, 'openclaw.json');
  const config = readJsonSafe(configPath);
  if (!config) throw new Error('Cannot read openclaw.json');

  const agentList = config.agents?.list || [];
  if (!agentList.find(a => a.id === agentId)) throw new Error(`Agent "${agentId}" not found`);

  // Remove account entry
  if (channelType === 'telegram') {
    if (config.channels?.telegram?.accounts?.[accountId]) {
      delete config.channels.telegram.accounts[accountId];
    }
  } else if (channelType === 'whatsapp') {
    if (config.channels?.whatsapp?.accounts?.[accountId]) {
      delete config.channels.whatsapp.accounts[accountId];
    }
  }

  // Remove binding
  if (config.bindings) {
    config.bindings = config.bindings.filter(
      b => !(b.agentId === agentId && b.match?.channel === channelType && b.match?.accountId === accountId)
    );
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

  return { ok: true, removed: { channel: channelType, accountId } };
}

/**
 * Update an existing channel account settings (dmPolicy, streaming, botToken, allowFrom).
 */
function updateAgentChannel(agentId, channelType, accountId, updates) {
  const configPath = path.join(OPENCLAW_HOME, 'openclaw.json');
  const config = readJsonSafe(configPath);
  if (!config) throw new Error('Cannot read openclaw.json');

  const agentList = config.agents?.list || [];
  if (!agentList.find(a => a.id === agentId)) throw new Error(`Agent "${agentId}" not found`);

  if (channelType === 'telegram') {
    const acct = config.channels?.telegram?.accounts?.[accountId];
    if (!acct) throw new Error(`Telegram account "${accountId}" not found for agent "${agentId}"`);
    if (updates.botToken !== undefined) {
      if (!/^\d+:[A-Za-z0-9_-]+$/.test(updates.botToken.trim())) {
        throw new Error('Telegram bot token format is invalid');
      }
      acct.botToken = updates.botToken.trim();
    }
    if (updates.dmPolicy !== undefined) acct.dmPolicy = updates.dmPolicy;
    if (updates.streaming !== undefined) acct.streaming = updates.streaming;
  } else if (channelType === 'whatsapp') {
    const acct = config.channels?.whatsapp?.accounts?.[accountId];
    if (!acct) throw new Error(`WhatsApp account "${accountId}" not found for agent "${agentId}"`);
    if (updates.dmPolicy !== undefined) acct.dmPolicy = updates.dmPolicy;
    if (updates.allowFrom !== undefined) acct.allowFrom = updates.allowFrom;
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  return { ok: true, channel: channelType, accountId };
}

function deleteAgent(agentId) {
  const configPath = path.join(OPENCLAW_HOME, 'openclaw.json');
  const config = readJsonSafe(configPath);
  if (!config) throw new Error('openclaw.json not found');

  // Remove from agents.list
  if (config.agents?.list) {
    config.agents.list = config.agents.list.filter(a => a.id !== agentId);
  }

  // Remove channel accounts
  if (config.channels?.telegram?.accounts?.[agentId]) {
    delete config.channels.telegram.accounts[agentId];
  }
  if (config.channels?.whatsapp?.accounts?.[agentId]) {
    delete config.channels.whatsapp.accounts[agentId];
  }

  // Remove bindings for this agent
  if (config.bindings) {
    config.bindings = config.bindings.filter(b => b.agentId !== agentId);
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

  // Remove workspace directory
  const workspacePath = path.join(OPENCLAW_HOME, 'workspaces', agentId);
  if (fs.existsSync(workspacePath)) {
    fs.rmSync(workspacePath, { recursive: true, force: true });
  }

  // Remove agent state directory
  const agentStatePath = path.join(AGENTS_DIR, agentId);
  if (fs.existsSync(agentStatePath)) {
    fs.rmSync(agentStatePath, { recursive: true, force: true });
  }

  return { ok: true };
}

module.exports = { readMdFile, parseMdFields, parseSoulTraits, parseToolsSections, getAgentDetail, updateAgent, getAgentChannels, addAgentChannel, removeAgentChannel, updateAgentChannel, deleteAgent };
