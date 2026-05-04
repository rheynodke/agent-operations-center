'use strict';
const fs   = require('fs');
const path = require('path');
const { OPENCLAW_HOME, getUserHome, readJsonSafe } = require('../config.cjs');

function _ownerOf(agentId) {
  try {
    const owner = require('../db.cjs').getAgentOwner(agentId);
    return owner == null ? null : Number(owner);
  } catch { return null; }
}
function homeFor(agentId) {
  const o = _ownerOf(agentId);
  return o == null || o === 1 ? OPENCLAW_HOME : getUserHome(o);
}

/**
 * OpenClaw built-in tools catalog.
 * Source: https://docs.openclaw.ai/tools
 * Skills (SKILL.md) teach the agent WHEN and HOW to use these tools.
 * They are two separate systems — disabling a skill does NOT disable the tool.
 */
const BUILTIN_TOOLS = [
  // Runtime
  { name: 'exec',            group: 'runtime',    label: 'Execute Commands',   description: 'Run shell commands via exec tool' },
  { name: 'process',         group: 'runtime',    label: 'Process Management', description: 'Manage background processes' },
  // File System
  { name: 'read',            group: 'fs',         label: 'Read Files',         description: 'Read file contents' },
  { name: 'write',           group: 'fs',         label: 'Write Files',        description: 'Write or create files' },
  { name: 'edit',            group: 'fs',         label: 'Edit Files',         description: 'Edit existing files' },
  { name: 'apply_patch',     group: 'fs',         label: 'Apply Patch',        description: 'Apply unified diffs to files' },
  // Web
  { name: 'browser',         group: 'web',        label: 'Browser',            description: 'Built-in Playwright browser automation' },
  { name: 'web_search',      group: 'web',        label: 'Web Search',         description: 'Search the web' },
  { name: 'web_fetch',       group: 'web',        label: 'Web Fetch',          description: 'Fetch URL content' },
  { name: 'x_search',        group: 'web',        label: 'X/Twitter Search',   description: 'Search X/Twitter' },
  // Memory
  { name: 'memory_search',   group: 'memory',     label: 'Memory Search',      description: 'Search agent memory' },
  { name: 'memory_get',      group: 'memory',     label: 'Memory Get',         description: 'Retrieve memory entries' },
  // Messaging / Agent coordination
  { name: 'message',         group: 'messaging',  label: 'Agent Send',         description: 'Send messages to other agents' },
  { name: 'agents_list',     group: 'sessions',   label: 'List Agents',        description: 'List available agents' },
  { name: 'subagents',       group: 'sessions',   label: 'Sub-Agents',         description: 'Spawn and manage sub-agents' },
  { name: 'sessions_list',   group: 'sessions',   label: 'List Sessions',      description: 'List active sessions' },
  { name: 'sessions_spawn',  group: 'sessions',   label: 'Spawn Sessions',     description: 'Create new sessions' },
  { name: 'sessions_send',   group: 'sessions',   label: 'Send to Session',    description: 'Send messages to sessions' },
  { name: 'sessions_yield',  group: 'sessions',   label: 'Yield Session',      description: 'Yield control to session' },
  { name: 'sessions_history',group: 'sessions',   label: 'Session History',    description: 'Read session history' },
  { name: 'session_status',  group: 'sessions',   label: 'Session Status',     description: 'Get current session status' },
  // Media / UI
  { name: 'image',           group: 'ui',         label: 'Image',              description: 'View or process images' },
  { name: 'image_generate',  group: 'ui',         label: 'Image Generate',     description: 'AI image generation' },
  { name: 'tts',             group: 'ui',         label: 'Text-to-Speech',     description: 'Convert text to audio' },
  { name: 'pdf',             group: 'ui',         label: 'PDF Tool',           description: 'Read and process PDF files' },
  { name: 'canvas',          group: 'automation', label: 'Canvas',             description: 'Visual canvas operations' },
  // Automation
  { name: 'cron',            group: 'automation', label: 'Cron',               description: 'Schedule recurring tasks' },
  { name: 'gateway',         group: 'automation', label: 'Gateway',            description: 'Gateway management tool' },
  { name: 'nodes',           group: 'automation', label: 'Nodes',              description: 'Remote node execution' },
];

/**
 * Tool profiles define a preset allow/deny baseline.
 * Source: https://docs.openclaw.ai/tools#tool-profiles
 */
const TOOL_PROFILES = {
  full:      null,
  coding:    { allow: ['exec', 'process', 'read', 'write', 'edit', 'apply_patch', 'agents_list', 'sessions_list', 'sessions_spawn', 'sessions_send', 'sessions_yield', 'sessions_history', 'session_status', 'subagents', 'memory_search', 'memory_get'] },
  messaging: { allow: ['message', 'memory_search', 'memory_get', 'session_status'] },
  minimal:   { allow: ['session_status'] },
};

/**
 * Returns the built-in tools available to a specific agent, with enabled/disabled state.
 * Applies global tools.profile + tools.allow/deny, then per-agent overrides.
 */
function getAgentTools(agentId) {
  const config = readJsonSafe(path.join(homeFor(agentId), 'openclaw.json')) || {};

  const agentConfig = (config.agents?.list || []).find(a => a.id === agentId);
  if (!agentConfig) throw new Error(`Agent "${agentId}" not found`);

  const globalTools   = config.tools || {};
  const globalProfile = globalTools.profile || 'full';
  const globalAllow   = globalTools.allow || null;
  const globalDeny    = globalTools.deny || [];

  const agentToolsCfg = agentConfig.tools || {};
  const agentProfile  = agentToolsCfg.profile || globalProfile;
  const agentAllow    = agentToolsCfg.allow || globalAllow;
  const agentDenyList = agentToolsCfg.deny || [];

  return BUILTIN_TOOLS.map(tool => {
    let enabled = true;

    const profile = TOOL_PROFILES[agentProfile];
    if (profile && Array.isArray(profile.allow)) enabled = profile.allow.includes(tool.name);

    if (Array.isArray(agentAllow)) enabled = agentAllow.includes(tool.name);

    if (agentDenyList.includes(tool.name) || globalDeny.includes(tool.name)) enabled = false;

    return {
      ...tool,
      enabled,
      deniedLocally:  agentDenyList.includes(tool.name),
      deniedGlobally: globalDeny.includes(tool.name),
      profile: agentProfile,
    };
  });
}

/**
 * Toggle a built-in tool ON or OFF for a specific agent.
 *
 * Handles three enable/disable mechanisms in openclaw's tool resolver:
 *   1. `tools.profile` (global or agent-level) — e.g. "coding" allows only a
 *      curated subset of tools.
 *   2. `agents.list[].tools.allow` — explicit allow-list at the agent level.
 *      When set, it REPLACES the profile's allow-list entirely.
 *   3. `agents.list[].tools.deny` — explicit deny-list at the agent level.
 *      Always subtractive.
 *
 * Prior implementation only managed (3), so toggling ON a tool that was
 * excluded by the profile (1) had no effect — the tool stayed disabled
 * because the profile still excluded it. This function now correctly manages
 * both `allow` and `deny` so the dashboard toggle actually reflects reality.
 *
 * Strategy for ENABLE:
 *   - Remove from deny (if present).
 *   - If the profile already allows this tool, done — no allow entry needed.
 *   - Otherwise, materialize an agent-level allow list seeded from the
 *     current effective-enabled tools (to preserve the other enabled tools)
 *     and add the target tool. Subsequent enables append to this list.
 *
 * Strategy for DISABLE:
 *   - Remove from agent-level allow (if present).
 *   - Add to agent-level deny as a belt-and-suspenders backstop, since the
 *     global profile could re-enable the tool if the allow list is removed.
 */
function toggleAgentTool(agentId, toolName, enabled) {
  const configPath = path.join(homeFor(agentId), 'openclaw.json');
  const config = readJsonSafe(configPath);
  if (!config) throw new Error('Cannot read openclaw.json');

  if (!config.agents) config.agents = {};
  if (!config.agents.list) config.agents.list = [];

  const agentIdx = config.agents.list.findIndex(a => a.id === agentId);
  if (agentIdx === -1) throw new Error(`Agent "${agentId}" not found`);

  const agentConfig = config.agents.list[agentIdx];
  const currentDeny  = [...(agentConfig.tools?.deny  || [])];
  const currentAllow = Array.isArray(agentConfig.tools?.allow)
    ? [...agentConfig.tools.allow]
    : null;

  // Compute the current effective-enabled tool list based on profile + agent overrides.
  // Used when we need to materialize an allow-list on first enable-through-profile.
  const globalTools   = config.tools || {};
  const agentProfile  = agentConfig.tools?.profile || globalTools.profile || 'full';
  const profileSpec   = TOOL_PROFILES[agentProfile];
  const profileAllow  = profileSpec?.allow || null;
  const computeCurrentEnabled = () =>
    BUILTIN_TOOLS
      .map((t) => t.name)
      .filter((name) => {
        if (currentAllow) return currentAllow.includes(name);
        if (profileAllow) return profileAllow.includes(name);
        return true;  // profile=full, no allow restriction
      })
      .filter((name) => !currentDeny.includes(name));

  const knownBuiltinNames = new Set(BUILTIN_TOOLS.map((t) => t.name));

  if (enabled) {
    // 1. Remove from deny if present.
    const nextDeny = currentDeny.filter((t) => t !== toolName);

    // 2. Ensure the tool is allowed.
    //    - If profile already allows it and no explicit allow list exists,
    //      we don't need an allow list.
    //    - Otherwise, materialize/extend the agent-level allow list.
    const profileCoversIt = profileAllow ? profileAllow.includes(toolName) : true;
    let nextAllow = currentAllow;
    if (!profileCoversIt) {
      if (!nextAllow) {
        // Snapshot what's currently enabled so we don't accidentally disable
        // tools that the profile was allowing. Only include known builtins.
        nextAllow = computeCurrentEnabled().filter((n) => knownBuiltinNames.has(n));
      }
      if (!nextAllow.includes(toolName)) nextAllow.push(toolName);
    }

    // Write the new tools block (pruning empty keys to keep the config tidy).
    const nextTools = { ...(agentConfig.tools || {}) };
    if (nextDeny.length) nextTools.deny = nextDeny; else delete nextTools.deny;
    if (nextAllow) nextTools.allow = nextAllow; else delete nextTools.allow;
    if (Object.keys(nextTools).length === 0) delete agentConfig.tools;
    else agentConfig.tools = nextTools;
  } else {
    // Remove from allow (if present), add to deny.
    let nextAllow = currentAllow ? currentAllow.filter((t) => t !== toolName) : null;
    // If the allow list becomes exactly the profile baseline, drop it to keep
    // the config clean — deny alone will do the job.
    if (nextAllow && profileAllow) {
      const sameAsProfile =
        nextAllow.length === profileAllow.length &&
        nextAllow.every((n) => profileAllow.includes(n));
      if (sameAsProfile) nextAllow = null;
    }
    const nextDeny = [...new Set([...currentDeny, toolName])];

    const nextTools = { ...(agentConfig.tools || {}) };
    nextTools.deny = nextDeny;
    if (nextAllow) nextTools.allow = nextAllow; else delete nextTools.allow;
    agentConfig.tools = nextTools;
  }

  config.agents.list[agentIdx] = agentConfig;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

  return {
    agentId,
    toolName,
    enabled,
    toolsAllow: agentConfig.tools?.allow || null,
    toolsDeny:  agentConfig.tools?.deny  || [],
  };
}

/**
 * Get all built-in tools with their status across all agents.
 * Used by the global Skills Library tools tab.
 */
function getAllTools() {
  const config = readJsonSafe(path.join(OPENCLAW_HOME, 'openclaw.json')) || {};
  const agentList = config.agents?.list || [];

  const agents = agentList.map(a => ({
    id: a.id,
    name: a.identity?.name || a.name || a.id,
    emoji: a.identity?.emoji || (a.id === 'main' ? '🤡' : '🤖'),
  }));

  // Get tools status for each agent
  const agentToolsMap = {};
  for (const agent of agentList) {
    try {
      const tools = getAgentTools(agent.id);
      agentToolsMap[agent.id] = tools.reduce((acc, t) => {
        acc[t.name] = { enabled: t.enabled, deniedLocally: t.deniedLocally, deniedGlobally: t.deniedGlobally };
        return acc;
      }, {});
    } catch {}
  }

  // Build tools with agent assignments
  const tools = BUILTIN_TOOLS.map(tool => {
    const agentAssignments = agents.map(agent => ({
      agentId: agent.id,
      agentName: agent.name,
      agentEmoji: agent.emoji,
      enabled: agentToolsMap[agent.id]?.[tool.name]?.enabled ?? true,
      deniedLocally: agentToolsMap[agent.id]?.[tool.name]?.deniedLocally ?? false,
    }));
    const enabledCount = agentAssignments.filter(a => a.enabled).length;
    return { ...tool, agentAssignments, enabledCount, totalAgents: agents.length };
  });

  return { tools, agents };
}

module.exports = { BUILTIN_TOOLS, TOOL_PROFILES, getAgentTools, getAllTools, toggleAgentTool };
