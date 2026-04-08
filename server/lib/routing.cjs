'use strict';
/**
 * Routing — reads `openclaw.json` bindings and enriches them with
 * agent metadata and channel account details for the dashboard Routing page.
 */

/** openclaw.json may store streaming as { mode: "partial" } or as a plain string */
function normalizeStreaming(val) {
  if (!val) return null;
  if (typeof val === 'string') return val;
  if (typeof val === 'object' && val.mode) return val.mode;
  return null;
}

const path = require('path');
const { OPENCLAW_HOME, readJsonSafe } = require('./config.cjs');

function parseRoutes() {
  const config = readJsonSafe(path.join(OPENCLAW_HOME, 'openclaw.json')) || {};
  // agents is { defaults, list } — actual array is at agents.list
  const agentList = Array.isArray(config.agents) ? config.agents : (config.agents?.list || []);
  const bindings  = (config.bindings || []).filter(b => b.type === 'route');

  return bindings.map((binding) => {
    const agent       = agentList.find(a => a.id === binding.agentId) || {};
    const channelType = binding.match?.channel   || 'unknown';
    const accountId   = binding.match?.accountId || null;

    // Name and emoji can be at root level or nested under identity
    const agentName  = agent.name  || agent.identity?.name  || binding.agentId;
    const agentEmoji = agent.identity?.emoji || agent.emoji || '🤖';

    let dmPolicy    = null;
    let groupPolicy = null;
    let streaming   = null;
    let accountLabel = accountId;
    if (channelType === 'telegram') {
      const acc    = config.channels?.telegram?.accounts?.[accountId] || {};
      dmPolicy     = acc.dmPolicy  || null;
      streaming    = normalizeStreaming(acc.streaming);
      accountLabel = accountId;
    } else if (channelType === 'discord') {
      const discordAccountId = accountId || binding.agentId;
      const disc = config.channels?.discord || {};
      const acc = disc.accounts?.[discordAccountId] || {};
      dmPolicy = acc.dmPolicy || disc.dmPolicy || null;
      groupPolicy = acc.groupPolicy || disc.groupPolicy || null;
      accountLabel = discordAccountId;
    } else if (channelType === 'whatsapp') {
      const acc    = config.channels?.whatsapp?.accounts?.[accountId] || {};
      dmPolicy     = acc.dmPolicy || null;
      accountLabel = accountId;
    }

    return {
      id:           `${binding.agentId}:${channelType}:${accountId || 'shared'}`,
      agentId:      binding.agentId,
      agentName,
      agentEmoji,
      channelType,
      accountId,
      accountLabel,
      dmPolicy,
      groupPolicy,
      streaming,
    };
  });
}

/**
 * Returns sanitized global channel configuration (no bot tokens).
 * Used by GET /api/channels for the Routing management page.
 */
function getChannelsConfig() {
  const config   = readJsonSafe(path.join(OPENCLAW_HOME, 'openclaw.json')) || {};
  const channels = config.channels || {};

  const telegram = channels.telegram
    ? {
        enabled: channels.telegram.enabled ?? false,
        accounts: Object.entries(channels.telegram.accounts || {}).map(([id, acc]) => ({
          accountId: id,
          hasToken:  !!(acc.botToken || acc.token),
          dmPolicy:  acc.dmPolicy  || null,
          streaming: normalizeStreaming(acc.streaming),
          groupPolicy: acc.groupPolicy || null,
        })),
      }
    : null;

  const discord = channels.discord
    ? {
        enabled:     channels.discord.enabled ?? false,
        accounts: Object.entries(channels.discord.accounts || {}).map(([id, acc]) => ({
          accountId: id,
          hasToken: Boolean(acc.token),
          dmPolicy: acc.dmPolicy || null,
          groupPolicy: acc.groupPolicy || null,
        })),
      }
    : null;

  const whatsapp = channels.whatsapp
    ? {
        accounts: Object.entries(channels.whatsapp.accounts || {}).map(([id, acc]) => ({
          accountId: id,
          dmPolicy:  acc.dmPolicy || null,
        })),
      }
    : null;

  return { telegram, discord, whatsapp };
}

module.exports = { parseRoutes, getChannelsConfig };
