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
const cronLib    = require('./automation/cron.cjs');
const scriptsLib = require('./scripts.cjs');
const hooksLib   = require('./hooks.cjs');

const { readJsonSafe, OPENCLAW_HOME } = config;
const { parseRoutes, getChannelsConfig } = require('./routing.cjs');

module.exports = {
  // ── config constants ───────────────────────────────────────────────────────
  OPENCLAW_HOME:      config.OPENCLAW_HOME,
  OPENCLAW_WORKSPACE: config.OPENCLAW_WORKSPACE,

  // ── sessions ───────────────────────────────────────────────────────────────
  parseCodeAgentSessions:    sessions.parseCodeAgentSessions,
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
  deleteAgentSkill:     agents.deleteAgentSkill,
  deleteSkillBySlug:    agents.deleteSkillBySlug,
  BUILTIN_TOOLS:     agents.BUILTIN_TOOLS,
  getAgentTools:     agents.getAgentTools,
  getAllTools:        agents.getAllTools,
  toggleAgentTool:   agents.toggleAgentTool,
  provisionAgent:    agents.provisionAgent,
  slugify:           agents.slugify,

  // ── agent channels ─────────────────────────────────────────────────────────
  getAgentChannels:    agents.getAgentChannels,
  addAgentChannel:     agents.addAgentChannel,
  updateAgentChannel:  agents.updateAgentChannel,
  removeAgentChannel:  agents.removeAgentChannel,
  deleteAgent:         agents.deleteAgent,

  // ── skill scripts ──────────────────────────────────────────────────────────
  listSkillScripts:    agents.listSkillScripts,
  getSkillScript:      agents.getSkillScript,
  saveSkillScript:     agents.saveSkillScript,
  deleteSkillScript:   agents.deleteSkillScript,
  getSkillScriptsPath: agents.getSkillScriptsPath,

  // ── routing ────────────────────────────────────────────────────────────────
  parseRoutes,
  getChannelsConfig,

  // ── models ─────────────────────────────────────────────────────────────────
  // Wrapper maintained for backward compat: parsers.getAvailableModels(cfg?)
  getAvailableModels: (cfg) =>
    getAvailableModels(cfg || readJsonSafe(path.join(OPENCLAW_HOME, 'openclaw.json')) || {}),

  // ── cron CRUD (file-based; gateway reads jobs.json on startup) ─────────────
  cronCreateJob:       cronLib.cronCreateJob,
  cronUpdateJob:       cronLib.cronUpdateJob,
  cronDeleteJob:       cronLib.cronDeleteJob,
  cronRunJob:          cronLib.cronRunJob,
  cronGetRuns:         cronLib.cronGetRuns,
  cronToggleJob:       cronLib.cronToggleJob,
  getDeliveryTargets:  cronLib.getDeliveryTargets,

  // ── workspace scripts ──────────────────────────────────────────────────────
  listScripts:             scriptsLib.listScripts,
  getScript:               scriptsLib.getScript,
  saveScript:              scriptsLib.saveScript,
  deleteScript:            scriptsLib.deleteScript,
  renameScript:            scriptsLib.renameScript,
  updateScriptMeta:        scriptsLib.updateScriptMeta,
  listAgentScripts:        scriptsLib.listAgentScripts,
  getAgentScript:          scriptsLib.getAgentScript,
  saveAgentScript:         scriptsLib.saveAgentScript,
  deleteAgentScript:       scriptsLib.deleteAgentScript,
  renameAgentScript:       scriptsLib.renameAgentScript,
  updateAgentScriptMeta:   scriptsLib.updateAgentScriptMeta,
  listAgentCustomTools:    scriptsLib.listAgentCustomTools,
  toggleAgentCustomTool:   scriptsLib.toggleAgentCustomTool,
  ensureUpdateTaskScript:  scriptsLib.ensureUpdateTaskScript,
  ensureAocEnvFile:        scriptsLib.ensureAocEnvFile,

  // ── hooks / inbound webhooks ───────────────────────────────────────────────
  getHooksConfig:   hooksLib.getHooksConfig,
  saveHooksConfig:  hooksLib.saveHooksConfig,
  getHookSessions:  hooksLib.getHookSessions,
  generateToken:    hooksLib.generateToken,
};
