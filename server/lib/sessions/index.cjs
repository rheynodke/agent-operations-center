'use strict';
const opencode      = require('./opencode.cjs');
const gateway       = require('./gateway.cjs');
const claudeCli     = require('./claude-cli.cjs');
const orchestrator  = require('../gateway-orchestrator.cjs');
const db            = require('../db.cjs');

function getAllSessions(userId) {
  const uid = userId == null ? 1 : Number(userId);
  const isAdmin = uid === 1;

  const codeAgentSessions = opencode.parseCodeAgentSessions(uid).map(s => ({
    ...s,
    source: 'code-agent',
    type: 'opencode',
  }));

  const gatewaySessions = gateway.parseGatewaySessions(uid).map(s => ({
    ...s,
    source: 'gateway',
  }));

  // Claude CLI sessions live at ~/.claude/projects/ — a host-wide single dir
  // shared by every user/agent on the machine. For non-admin tenants, only
  // include claude-cli entries that link to one of *their* gateway sessions
  // (so admin's bare main-agent claude-cli rows never leak through).
  let claudeCliSessions = claudeCli.parseClaudeCliSessions();
  if (!isAdmin) {
    const ownGatewayIds = new Set(gatewaySessions.map((s) => s.id));
    claudeCliSessions = claudeCliSessions.filter(
      (cc) => cc.linkedGatewaySessionId && ownGatewayIds.has(cc.linkedGatewaySessionId)
    );
  }

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

function getDashboardStats(userId) {
  const uid = userId == null ? 1 : Number(userId);

  const codeAgentSessions = opencode.parseCodeAgentSessions(uid);
  const agents            = opencode.parseAgentRegistry(uid);
  const progress          = opencode.parseDevProgress(uid);
  const gatewaySessions   = gateway.parseGatewaySessions(uid);

  const allSessionsCount = codeAgentSessions.length + gatewaySessions.length;

  const activeSessions = [
    ...codeAgentSessions.filter(s => s.status === 'running' || s.status === 'started'),
    ...gatewaySessions.filter(s => s.status === 'active'),
  ];
  const completedSessions = codeAgentSessions.filter(s => s.status === 'completed');
  const failedSessions    = codeAgentSessions.filter(s => s.status === 'failed' || s.status === 'killed');

  // Cost from DB tasks (project-scoped via JOIN). Filesystem session costs
  // remain admin-only — they are not user-scopable today.
  const sqlDb = db.getDb();
  let totalCost = 0;
  if (sqlDb) {
    try {
      const res = sqlDb.exec(
        `SELECT COALESCE(SUM(t.cost), 0) AS total
         FROM tasks t
         LEFT JOIN projects p ON p.id = t.project_id
         WHERE t.cost IS NOT NULL
           AND ((p.created_by = ?) OR (t.project_id IS NULL AND ? = 1))`,
        [uid, uid]
      );
      if (res.length) totalCost = Number(res[0].values[0][0]) || 0;
    } catch (_) { /* table missing in test envs — leave 0 */ }
  }

  // Gateway info: admin (uid=1) has external gateway; others use orchestrator state.
  let gw;
  if (uid === 1) {
    gw = { status: 'running', port: 18789, mode: 'external' };
  } else {
    const state = orchestrator.getGatewayState(uid) || {};
    gw = {
      status: state.state === 'running' ? 'running' : 'stopped',
      port:   state.port ?? null,
      pid:    state.pid ?? null,
      mode:   'managed',
    };
  }

  return {
    gateway: gw,
    sessions: {
      total: allSessionsCount,
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
  parseClaudeCliAsGatewayMessages:        claudeCli.parseClaudeCliAsGatewayMessages,
  parseSingleClaudeCliEntry:              claudeCli.parseSingleClaudeCliEntry,
  buildAgentClaudeCliMap:                 claudeCli.buildAgentClaudeCliMap,
  findClaudeCliForGatewaySessionId:       claudeCli.findClaudeCliForGatewaySessionId,
  findClaudeCliFileForGatewaySession:     claudeCli.findClaudeCliFileForGatewaySession,
};
