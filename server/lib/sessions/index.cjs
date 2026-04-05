'use strict';
const opencode = require('./opencode.cjs');
const gateway  = require('./gateway.cjs');

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

  const merged = [...gatewaySessions];
  const gwIds = new Set(gatewaySessions.map(s => s.id));
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
};
