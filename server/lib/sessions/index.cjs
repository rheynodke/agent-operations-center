'use strict';
const opencode  = require('./opencode.cjs');
const gateway   = require('./gateway.cjs');
const claudeCli = require('./claude-cli.cjs');

function getAllSessions() {
  const codeAgentSessions = opencode.parseCodeAgentSessions().map(s => ({
    ...s,
    source: 'code-agent',
    type: 'opencode',
  }));

  const gatewaySessions = gateway.parseGatewaySessions().map(s => ({
    ...s,
    source: 'gateway',
  }));

  const claudeCliSessions = claudeCli.parseClaudeCliSessions();

  // Index gateway sessions by sessionId for link augmentation.
  const gatewayById = new Map();
  for (const gs of gatewaySessions) gatewayById.set(gs.id, gs);

  // Index claude-cli sessions by linked gateway sessionId for gateway augmentation.
  const claudeCliByGatewayId = new Map();
  for (const cc of claudeCliSessions) {
    if (cc.linkedGatewaySessionId) claudeCliByGatewayId.set(cc.linkedGatewaySessionId, cc);
  }

  // Augment linked gateway sessions with claude-cli data. Claude CLI's jsonl is
  // the source of truth for turns delegated to it, so we always surface the link
  // (via claudeCliSessionId) and fold in counts/lastMessage when claude-cli has
  // more recent or richer data than the gateway's own jsonl.
  for (const gs of gatewaySessions) {
    const cc = claudeCliByGatewayId.get(gs.id);
    if (!cc) continue;
    gs.claudeCliSessionId = cc.claudeCliSessionId;
    gs.messageCount = Math.max(gs.messageCount || 0, cc.messageCount);
    gs.toolCalls    = Math.max(gs.toolCalls || 0, cc.toolCalls);
    gs.tokensIn     = Math.max(gs.tokensIn || 0, cc.tokensIn);
    gs.tokensOut    = Math.max(gs.tokensOut || 0, cc.tokensOut);
    if (cc.updatedAt >= (gs.updatedAt || 0) && cc.lastMessage) {
      gs.lastMessage = cc.lastMessage;
      gs.lastRole    = cc.lastRole || gs.lastRole;
    }
    gs.updatedAt    = Math.max(gs.updatedAt || 0, cc.updatedAt);
    gs.hasLog       = true;
    gs.fileSize     = Math.max(gs.fileSize || 0, cc.fileSize);
    if (cc.status === 'active') gs.status = 'active';
  }

  const merged = [...gatewaySessions];
  const gwIds = new Set(gatewaySessions.map(s => s.id));

  // Add claude-cli sessions that aren't already linked to a gateway session.
  for (const cc of claudeCliSessions) {
    if (cc.linkedGatewaySessionId && gwIds.has(cc.linkedGatewaySessionId)) continue;
    merged.push(cc);
  }

  for (const cas of codeAgentSessions) {
    if (!gwIds.has(cas.id)) merged.push(cas);
  }

  merged.sort((a, b) => {
    const ta = a.updatedAt || new Date(a.completedAt || a.startedAt || 0).getTime();
    const tb = b.updatedAt || new Date(b.completedAt || b.startedAt || 0).getTime();
    return tb - ta;
  });

  return merged;
}

function getDashboardStats() {
  const allSessions       = getAllSessions();
  const codeAgentSessions = opencode.parseCodeAgentSessions();
  const agents            = opencode.parseAgentRegistry();
  const progress          = opencode.parseDevProgress();
  const gatewaySessions   = gateway.parseGatewaySessions();

  const activeSessions = [
    ...codeAgentSessions.filter(s => s.status === 'running' || s.status === 'started'),
    ...gatewaySessions.filter(s => s.status === 'active'),
  ];
  const completedSessions = codeAgentSessions.filter(s => s.status === 'completed');
  const failedSessions     = codeAgentSessions.filter(s => s.status === 'failed' || s.status === 'killed');

  const codeCost  = codeAgentSessions.reduce((sum, s) => sum + (parseFloat(s.cost) || 0), 0);
  const gwCost    = gatewaySessions.reduce((sum, s) => sum + (parseFloat(s.cost) || 0), 0);
  const totalCost = codeCost + gwCost;

  return {
    gateway: { status: 'running', port: 18789 },
    sessions: {
      total: allSessions.length,
      active: activeSessions.length,
      completed: completedSessions.length,
      failed: failedSessions.length,
      gateway: gatewaySessions.length,
      codeAgent: codeAgentSessions.length,
    },
    agents: {
      total: agents.length,
      active: agents.filter(a => a.status === 'active').length,
    },
    cost: {
      total: Math.round(totalCost * 100) / 100,
    },
    progress: {
      total: progress.length,
      running: progress.filter(p => p.status === 'running').length,
    },
  };
}

module.exports = {
  getAllSessions,
  getDashboardStats,
  ...opencode,
  ...gateway,
  // Claude CLI bridge — used by session detail endpoint + live-feed watcher.
  parseClaudeCliSessions:                 claudeCli.parseClaudeCliSessions,
  parseClaudeCliSessionEvents:            claudeCli.parseClaudeCliSessionEvents,
  parseClaudeCliSessionEventsByFile:      claudeCli.parseClaudeCliSessionEventsByFile,
  parseSingleClaudeCliEntry:              claudeCli.parseSingleClaudeCliEntry,
  buildAgentClaudeCliMap:                 claudeCli.buildAgentClaudeCliMap,
  findClaudeCliForGatewaySessionId:       claudeCli.findClaudeCliForGatewaySessionId,
};
