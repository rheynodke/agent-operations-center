'use strict';
const fs   = require('fs');
const path = require('path');
const { OPENCLAW_HOME, OPENCLAW_WORKSPACE, AGENTS_DIR, readJsonSafe } = require('../config.cjs');

// ── Constants ─────────────────────────────────────────────────────────────────

const VALID_ID_RE = /^[a-z0-9][a-z0-9-]{0,29}$/;

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(str) {
  return str.toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30) || 'agent';
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf-8');
}

function readFileSafe(filePath) {
  try {
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf-8');
  } catch {}
  return null;
}

// ── Bootstrap file generators ─────────────────────────────────────────────────

function generateIdentityMd({ name, emoji, theme, description }) {
  return [
    `# ${name}`,
    '',
    `- **Name:** ${name}`,
    `- **Emoji:** ${emoji || '🤖'}`,
    theme ? `- **Vibe:** ${theme}` : null,
    description ? `- **Role:** ${description}` : null,
  ].filter(l => l !== null).join('\n') + '\n';
}

function generateSoulMd({ name, theme, soulContent }) {
  if (soulContent && soulContent.trim()) {
    return `# Soul of ${name}\n\n${soulContent.trim()}\n`;
  }
  return [
    `# Soul of ${name}`,
    '',
    `_${theme || 'A focused, reliable autonomous agent'}_`,
    '',
    `**Clear.** Gives precise, actionable responses without unnecessary filler.`,
    `**Reliable.** Follows through on tasks completely before reporting back.`,
    `**Adaptive.** Adjusts tone and depth to what the situation actually needs.`,
    '',
  ].join('\n');
}

function generateAgentsMd({ name }) {
  return [
    `# Agents`,
    '',
    `This workspace belongs to **${name}**.`,
    '',
    '## Coordination',
    '',
    '- Multi-agent tasks are coordinated through the main agent.',
    '- Spawn subagents for parallel workstreams when needed.',
    '',
  ].join('\n');
}

function generateToolsMd({ name }) {
  return [
    `# Tools`,
    '',
    `## Available to ${name}`,
    '',
    '### Core',
    '- exec (shell commands)',
    '- read / write / edit (filesystem)',
    '- web_search / web_fetch',
    '- memory_search / memory_get',
    '',
    '### Sessions',
    '- sessions_spawn / sessions_send / sessions_yield',
    '- agents_list / sessions_list',
    '',
  ].join('\n');
}

// ── Provider/id hints ─────────────────────────────────────────────────────────

function validateProvision(opts, agentList) {
  const { id, name, channels } = opts;

  if (!id) throw new Error('Agent ID is required');
  if (!VALID_ID_RE.test(id)) {
    throw new Error(`Agent ID "${id}" is invalid. Use lowercase letters, numbers, and hyphens (max 30 chars).`);
  }
  if (agentList.some(a => a.id === id)) {
    throw new Error(`Agent with ID "${id}" already exists`);
  }
  if (!name || !name.trim()) throw new Error('Agent name is required');
  if (!Array.isArray(channels) || channels.length === 0) {
    throw new Error('At least one channel binding is required');
  }

  const telegramChannels = channels.filter(c => c.type === 'telegram');
  for (const ch of telegramChannels) {
    if (!ch.botToken || !ch.botToken.trim()) {
      throw new Error('Telegram bot token is required');
    }
    if (!/^\d+:[A-Za-z0-9_-]+$/.test(ch.botToken.trim())) {
      throw new Error('Telegram bot token format is invalid (expected: 123456:ABC-DEF...)');
    }
  }
}

// ── Main provisioning function ────────────────────────────────────────────────

function provisionAgent(opts, userId) {
  const configPath = path.join(OPENCLAW_HOME, 'openclaw.json');
  const config = readJsonSafe(configPath);
  if (!config) throw new Error('Cannot read openclaw.json');

  const agentList = config.agents?.list || [];
  const defaultModel = config.agents?.defaults?.model?.primary || '';

  // 1. Validate
  validateProvision(opts, agentList);

  const {
    id,
    name,
    emoji    = '🤖',
    model    = defaultModel,
    theme    = '',
    description = '',
    color    = '',
    soulContent = '',
    channels = [],
  } = opts;

  // 2. Resolve paths
  const workspacePath = path.join(OPENCLAW_HOME, 'workspaces', id);
  const agentStatePath = path.join(AGENTS_DIR, id, 'agent');

  // 3. Mutate openclaw.json ──────────────────────────────────────────────────

  // 3a. Add to agents.list
  const agentEntry = {
    id,
    name,
    workspace: workspacePath,
    agentDir: agentStatePath,
    identity: {
      name,
      emoji,
      ...(theme ? { theme } : {}),
    },
    ...(model ? { model } : {}),
  };

  if (!config.agents) config.agents = {};
  if (!config.agents.list) config.agents.list = [];
  config.agents.list.push(agentEntry);

  // 3b. Add channel accounts + bindings
  const addedBindings = [];
  let whatsappPairingRequired = false;

  if (!config.bindings) config.bindings = [];
  if (!config.channels) config.channels = {};

  for (const ch of channels) {
    if (ch.type === 'telegram') {
      // Add telegram account
      if (!config.channels.telegram) config.channels.telegram = { enabled: true, accounts: {} };
      if (!config.channels.telegram.accounts) config.channels.telegram.accounts = {};
      config.channels.telegram.accounts[id] = {
        botToken: ch.botToken.trim(),
        dmPolicy: ch.dmPolicy || 'pairing',
        ...(ch.streaming ? { streaming: ch.streaming } : { streaming: 'partial' }),
      };

      // Add binding
      config.bindings.push({
        type: 'route',
        agentId: id,
        match: { channel: 'telegram', accountId: id },
      });
      addedBindings.push({ channel: 'telegram', accountId: id });
    }

    if (ch.type === 'whatsapp') {
      // Add whatsapp account (no token — QR pairing required separately)
      if (!config.channels.whatsapp) config.channels.whatsapp = { accounts: {} };
      if (!config.channels.whatsapp.accounts) config.channels.whatsapp.accounts = {};
      config.channels.whatsapp.accounts[id] = {
        dmPolicy: ch.dmPolicy || 'pairing',
        ...(ch.allowFrom && ch.allowFrom.length > 0 ? { allowFrom: ch.allowFrom } : {}),
      };

      // Add binding
      config.bindings.push({
        type: 'route',
        agentId: id,
        match: { channel: 'whatsapp', accountId: id },
      });
      addedBindings.push({ channel: 'whatsapp', accountId: id });
      whatsappPairingRequired = true;
    }
  }

  // Write openclaw.json
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

  // 4. Scaffold workspace directory ─────────────────────────────────────────

  ensureDir(workspacePath);
  ensureDir(path.join(workspacePath, 'memory'));

  // IDENTITY.md
  writeFile(
    path.join(workspacePath, 'IDENTITY.md'),
    generateIdentityMd({ name, emoji, theme, description })
  );

  // SOUL.md
  writeFile(
    path.join(workspacePath, 'SOUL.md'),
    generateSoulMd({ name, theme, soulContent })
  );

  // AGENTS.md
  writeFile(
    path.join(workspacePath, 'AGENTS.md'),
    generateAgentsMd({ name })
  );

  // TOOLS.md
  writeFile(
    path.join(workspacePath, 'TOOLS.md'),
    generateToolsMd({ name })
  );

  // USER.md — copy from main workspace if available
  const mainUserMd = readFileSafe(path.join(OPENCLAW_WORKSPACE, 'USER.md'));
  if (mainUserMd) {
    writeFile(path.join(workspacePath, 'USER.md'), mainUserMd);
  }

  // 5. Create agent state directory
  ensureDir(agentStatePath);

  console.log(`[provision] Agent "${id}" ("${name}") provisioned successfully`);
  console.log(`[provision]   Workspace: ${workspacePath}`);
  console.log(`[provision]   Bindings: ${addedBindings.map(b => `${b.channel}/${b.accountId}`).join(', ')}`);

  return {
    ok: true,
    agentId: id,
    agentName: name,
    workspacePath,
    agentStatePath,
    bindings: addedBindings,
    whatsappPairingRequired,
    filesCreated: ['IDENTITY.md', 'SOUL.md', 'AGENTS.md', 'TOOLS.md', ...(mainUserMd ? ['USER.md'] : [])],
    profileSaved: false, // Will be updated by caller after SQLite save
  };
}

module.exports = { provisionAgent, slugify, validateProvision };
