'use strict';
/**
 * server/lib/index.cjs — Master barrel
 *
 * Drop-in replacement for parsers.cjs.
 * server/index.cjs uses: const parsers = require('./lib')
 * All previously-exported symbols are re-exported here identically.
 */
const path       = require('path');
const config     = require('./config.cjs');
const sessions   = require('./sessions/index.cjs');
const agents     = require('./agents/index.cjs');
const { getAvailableModels } = require('./models.cjs');

const { readJsonSafe, OPENCLAW_HOME } = config;

module.exports = {
  // ── config constants ───────────────────────────────────────────────────────
  OPENCLAW_HOME:      config.OPENCLAW_HOME,
  OPENCLAW_WORKSPACE: config.OPENCLAW_WORKSPACE,

  // ── sessions ───────────────────────────────────────────────────────────────
  parseCodeAgentSessions:    sessions.parseCodeAgentSessions,
  parseDevProgress:          sessions.parseDevProgress,
  parseOpenCodeEvents:       sessions.parseOpenCodeEvents,
  parseOpenCodeResult:       sessions.parseOpenCodeResult,
  parseAgentRegistry:        sessions.parseAgentRegistry,
  parseCronJobs:             sessions.parseCronJobs,
  parseCommandLog:           sessions.parseCommandLog,
  parseSubagentRuns:         sessions.parseSubagentRuns,
  getAvailableOpenCodeSessions: sessions.getAvailableOpenCodeSessions,
  parseGatewaySessions:      sessions.parseGatewaySessions,
  parseGatewaySessionEvents: sessions.parseGatewaySessionEvents,
  parseSingleGatewayEntry:   sessions.parseSingleGatewayEntry,
  getAllSessions:             sessions.getAllSessions,
  getDashboardStats:         sessions.getDashboardStats,

  // ── agents ─────────────────────────────────────────────────────────────────
  getAgentDetail:    agents.getAgentDetail,
  updateAgent:       agents.updateAgent,
  getAgentFile:      agents.getAgentFile,
  saveAgentFile:     agents.saveAgentFile,
  getAgentSkills:       agents.getAgentSkills,
  getAllSkills:          agents.getAllSkills,
  getSkillFile:         agents.getSkillFile,
  getSkillFileBySlug:   agents.getSkillFileBySlug,
  saveSkillFile:        agents.saveSkillFile,
  saveSkillFileBySlug:  agents.saveSkillFileBySlug,
  createSkill:          agents.createSkill,
  createGlobalSkill:    agents.createGlobalSkill,
  toggleAgentSkill:     agents.toggleAgentSkill,
  BUILTIN_TOOLS:     agents.BUILTIN_TOOLS,
  getAgentTools:     agents.getAgentTools,
  getAllTools:        agents.getAllTools,
  toggleAgentTool:   agents.toggleAgentTool,
  provisionAgent:    agents.provisionAgent,
  slugify:           agents.slugify,

  // ── skill scripts ──────────────────────────────────────────────────────────
  listSkillScripts:    agents.listSkillScripts,
  getSkillScript:      agents.getSkillScript,
  saveSkillScript:     agents.saveSkillScript,
  deleteSkillScript:   agents.deleteSkillScript,
  getSkillScriptsPath: agents.getSkillScriptsPath,

  // ── models ─────────────────────────────────────────────────────────────────
  // Wrapper maintained for backward compat: parsers.getAvailableModels(cfg?)
  getAvailableModels: (cfg) =>
    getAvailableModels(cfg || readJsonSafe(path.join(OPENCLAW_HOME, 'openclaw.json')) || {}),
};
