'use strict';
const fs   = require('fs');
const path = require('path');
const { OPENCLAW_HOME, OPENCLAW_WORKSPACE, AGENTS_DIR, readJsonSafe } = require('../config.cjs');
const { parseGatewaySessions } = require('../sessions/gateway.cjs');

/**
 * Normalize streaming value: openclaw.json may store it as
 * { mode: "partial" } (object) or just "partial" (string).
 * Always returns a plain string.
 */
function normalizeStreaming(val, fallback = 'off') {
  if (!val) return fallback;
  if (typeof val === 'string') return val;
  if (typeof val === 'object' && val.mode) return val.mode;
  return fallback;
}

function slugify(str) {
  return str.toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30) || 'agent';
}
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
      streaming: normalizeStreaming(telegramAccounts[accountKey].streaming),
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
    streaming: normalizeStreaming(acc.streaming),
    dmPolicy: acc.dmPolicy || 'none',
  }));

  // Resolve effective fs.workspaceOnly: agent-level overrides global
  const globalFsWorkspaceOnly = config.tools?.fs?.workspaceOnly ?? true;
  const agentFsWorkspaceOnly  = agentConfig.tools?.fs?.workspaceOnly;
  const fsWorkspaceOnly = agentFsWorkspaceOnly !== undefined ? agentFsWorkspaceOnly : globalFsWorkspaceOnly;

  return {
    id: agentId,
    config: agentConfig,
    model,
    fsWorkspaceOnly,
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

  if (updates.fsWorkspaceOnly !== undefined) {
    if (!agent.tools) agent.tools = {};
    if (!agent.tools.fs) agent.tools.fs = {};
    agent.tools.fs.workspaceOnly = updates.fsWorkspaceOnly === true;
    changed.push('fsWorkspaceOnly');
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

  // ── Rename agent id + directories when name changes ───────────────────────
  let finalAgentId = agentId;
  if (updates.name !== undefined && agentId !== 'main') {
    const newId = slugify(updates.name);
    if (newId && newId !== agentId) {
      // Ensure new ID isn't already taken
      const conflict = agentList.find((a, i) => i !== idx && a.id === newId);
      if (conflict) {
        console.warn(`[updateAgent] Rename skipped: agent id "${newId}" already exists`);
      } else {
        // Re-read config (already written above), now apply id rename
        const configNow = readJsonSafe(configPath);
        const agentNow = configNow.agents.list[idx];

        // Old paths
        const oldWorkspace = agentNow.workspace || path.join(OPENCLAW_HOME, 'workspaces', agentId);
        const oldAgentDir  = agentNow.agentDir  || path.join(AGENTS_DIR, agentId);
        const newWorkspace = path.join(OPENCLAW_HOME, 'workspaces', newId);
        const newAgentDir  = path.join(AGENTS_DIR, newId);

        // Update agent entry
        agentNow.id        = newId;
        agentNow.workspace = newWorkspace;
        agentNow.agentDir  = newAgentDir;
        configNow.agents.list[idx] = agentNow;

        // Rename telegram account key if it equals old agentId
        if (configNow.channels?.telegram?.accounts?.[agentId]) {
          configNow.channels.telegram.accounts[newId] = configNow.channels.telegram.accounts[agentId];
          delete configNow.channels.telegram.accounts[agentId];
        }
        // Rename whatsapp account key
        if (configNow.channels?.whatsapp?.accounts?.[agentId]) {
          configNow.channels.whatsapp.accounts[newId] = configNow.channels.whatsapp.accounts[agentId];
          delete configNow.channels.whatsapp.accounts[agentId];
        }
        // Rename discord account key
        if (configNow.channels?.discord?.accounts?.[agentId]) {
          configNow.channels.discord.accounts[newId] = configNow.channels.discord.accounts[agentId];
          delete configNow.channels.discord.accounts[agentId];
        }

        // Update bindings: agentId + accountId references
        if (configNow.bindings) {
          for (const b of configNow.bindings) {
            if (b.agentId === agentId) b.agentId = newId;
            if (b.match?.accountId === agentId) b.match.accountId = newId;
          }
        }

        fs.writeFileSync(configPath, JSON.stringify(configNow, null, 2), 'utf-8');

        // Rename directories on filesystem
        if (fs.existsSync(oldWorkspace) && !fs.existsSync(newWorkspace)) {
          fs.renameSync(oldWorkspace, newWorkspace);
          changed.push(`workspace:${agentId}→${newId}`);
        }
        if (fs.existsSync(oldAgentDir) && !fs.existsSync(newAgentDir)) {
          fs.renameSync(oldAgentDir, newAgentDir);
          changed.push(`agentDir:${agentId}→${newId}`);
        }

        finalAgentId = newId;
        changed.push(`id:${agentId}→${newId}`);
        console.log(`[updateAgent] Renamed agent "${agentId}" → "${newId}"`);
      }
    }
  }

  return { agentId: finalAgentId, changed };
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
      streaming: normalizeStreaming(acct.streaming, 'partial'),
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

  // ── Discord ──────────────────────────────────────────────────────────
  const discordAccounts = channels.discord?.accounts || {};

  const discordIds = new Set(
    bindings
      .filter(b => b.match?.channel === 'discord')
      .map(b => b.match.accountId || agentId)
  );
  for (const k of conventionKeys) {
    if (discordAccounts[k]) discordIds.add(k);
  }

  const discord = [...discordIds].map(acctId => {
    const acct = discordAccounts[acctId] || {};
    return {
      type: 'discord',
      accountId: acctId,
      hasToken: Boolean(acct.token || channels.discord?.token),
      dmPolicy: acct.dmPolicy || channels.discord?.dmPolicy || 'pairing',
      groupPolicy: acct.groupPolicy || channels.discord?.groupPolicy || 'open',
    };
  });

  return { telegram, whatsapp, discord };
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

  if (!opts.type || !['telegram', 'whatsapp', 'discord'].includes(opts.type)) {
    throw new Error('type must be "telegram", "whatsapp", or "discord"');
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
  } else if (opts.type === 'discord') {
    if (!opts.botToken || !String(opts.botToken).trim()) {
      throw new Error('botToken is required for Discord');
    }
    if (!config.channels.discord) config.channels.discord = {};
    if (!config.channels.discord.accounts) config.channels.discord.accounts = {};
    config.channels.discord.enabled = true;
    config.channels.discord.accounts[accountId] = {
      token: String(opts.botToken).trim(),
      dmPolicy: opts.dmPolicy || 'pairing',
      groupPolicy: opts.groupPolicy || 'open',
    };
  }

  // Add binding if not already present
  const alreadyBound = config.bindings.some(b => {
    if (b.agentId !== agentId || b.match?.channel !== opts.type) return false;
    const bindingAccountId = b.match?.accountId || (opts.type === 'discord' ? agentId : null);
    return bindingAccountId === accountId;
  });

  if (!alreadyBound) {
    config.bindings.push({ type: 'route', agentId, match: { channel: opts.type, accountId } });
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
  } else if (channelType === 'discord') {
    if (config.channels?.discord?.accounts?.[accountId]) {
      delete config.channels.discord.accounts[accountId];
    }
  }

  // Remove binding
  if (config.bindings) {
    config.bindings = config.bindings.filter(b => {
      if (b.agentId !== agentId || b.match?.channel !== channelType) return true;
      const bindingAccountId = b.match?.accountId || (channelType === 'discord' ? agentId : null);
      return bindingAccountId !== accountId;
    });
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
  } else if (channelType === 'discord') {
    if (!config.channels?.discord) throw new Error('Discord channel not configured');
    if (!config.channels.discord.accounts) config.channels.discord.accounts = {};
    let acct = config.channels.discord.accounts[accountId];
    if (!acct && config.channels.discord.token) {
      // Migrate legacy shared Discord config into a per-agent account on first edit.
      acct = config.channels.discord.accounts[accountId] = {
        token: config.channels.discord.token,
        dmPolicy: config.channels.discord.dmPolicy || 'pairing',
        groupPolicy: config.channels.discord.groupPolicy || 'open',
      };
    }
    if (!acct) throw new Error(`Discord account "${accountId}" not found for agent "${agentId}"`);
    if (updates.botToken !== undefined) {
      if (!String(updates.botToken).trim()) {
        throw new Error('Discord bot token cannot be empty');
      }
      acct.token = String(updates.botToken).trim();
    }
    if (updates.dmPolicy !== undefined) acct.dmPolicy = updates.dmPolicy;
    if (updates.groupPolicy !== undefined) acct.groupPolicy = updates.groupPolicy;
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
  if (config.channels?.discord?.accounts?.[agentId]) {
    delete config.channels.discord.accounts[agentId];
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
