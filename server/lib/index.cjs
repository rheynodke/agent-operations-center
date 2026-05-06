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
const locksLib   = require('./locks.cjs');
const hooksLib   = require('./hooks.cjs');
const pairingLib = require('./pairing.cjs');
const discordGuildsLib = require('./discord-guilds.cjs');
const browserHarnessInstaller = require('./browser-harness/installer.cjs');
const browserHarnessLauncher = require('./browser-harness/launcher.cjs');
const browserHarnessPool = require('./browser-harness/pool.cjs');
const browserHarnessOdoo = require('./browser-harness/odoo-installer.cjs');
const aocTasksSkill       = require('./aoc-tasks/installer.cjs');
const aocConnectionsSkill = require('./aoc-connections/installer.cjs');
const missionOrchestratorSkill = require('./mission-orchestrator/installer.cjs');
const aocRoomSkill        = require('./aoc-room/installer.cjs');
const workspaceBrowser    = require('./workspace-browser.cjs');
const roleTemplates = require('./role-templates.cjs');
const skillCatalog  = require('./skill-catalog.cjs');
const oauthG = require('./oauth/google.cjs');
const googleConnections = require('./connections/google-workspace.cjs');
const googleHealthCron = require('./cron/google-health.cjs');
const roomArtifacts = require('./room-artifacts.cjs');
const roomContext = require('./room-context.cjs');

const { readJsonSafe, OPENCLAW_HOME } = config;
const { parseRoutes, getChannelsConfig } = require('./routing.cjs');
const db = require('./db.cjs');

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
  parseClaudeCliSessions:            sessions.parseClaudeCliSessions,
  parseClaudeCliSessionEvents:       sessions.parseClaudeCliSessionEvents,
  parseClaudeCliSessionEventsByFile: sessions.parseClaudeCliSessionEventsByFile,
  parseClaudeCliAsGatewayMessages:   sessions.parseClaudeCliAsGatewayMessages,
  parseSingleClaudeCliEntry:         sessions.parseSingleClaudeCliEntry,
  buildAgentClaudeCliMap:            sessions.buildAgentClaudeCliMap,
  findClaudeCliForGatewaySessionId:  sessions.findClaudeCliForGatewaySessionId,
  findClaudeCliFileForGatewaySession: sessions.findClaudeCliFileForGatewaySession,
  getAllSessions:             sessions.getAllSessions,
  getDashboardStats:         sessions.getDashboardStats,

  // ── agents ─────────────────────────────────────────────────────────────────
  getAgentDetail:    agents.getAgentDetail,
  updateAgent:       agents.updateAgent,
  getAgentFile:      agents.getAgentFile,
  saveAgentFile:     agents.saveAgentFile,
  injectSoulStandard: agents.injectSoulStandard,
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
  getSkillDirTree:      agents.getSkillDirTree,
  getSkillAnyFile:      agents.getSkillAnyFile,
  saveSkillAnyFile:     agents.saveSkillAnyFile,
  BUILTIN_TOOLS:     agents.BUILTIN_TOOLS,
  getAgentTools:     agents.getAgentTools,
  getAllTools:        agents.getAllTools,
  toggleAgentTool:   agents.toggleAgentTool,
  provisionAgent:    agents.provisionAgent,
  slugify:           agents.slugify,
  ensureAgentSkillsFields: agents.ensureAgentSkillsFields,

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
  getAgentSkillDirTree:  agents.getAgentSkillDirTree,
  getAgentSkillAnyFile:  agents.getAgentSkillAnyFile,
  saveAgentSkillAnyFile: agents.saveAgentSkillAnyFile,

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
  ensureUpdateTaskScript:   scriptsLib.ensureUpdateTaskScript,
  ensureAocEnvFile:         scriptsLib.ensureAocEnvFile,
  ensureCheckTasksScript:   scriptsLib.ensureCheckTasksScript,
  ensureCheckConnectionsScript: scriptsLib.ensureCheckConnectionsScript,
  ensureGwsCallScript:          scriptsLib.ensureGwsCallScript,
  ensureAocConnectScript:       scriptsLib.ensureAocConnectScript,
  ensureMcpCallScript:          scriptsLib.ensureMcpCallScript,
  ensureFetchAttachmentScript:  scriptsLib.ensureFetchAttachmentScript,
  ensureSaveOutputScript:       scriptsLib.ensureSaveOutputScript,
  ensurePostCommentScript:      scriptsLib.ensurePostCommentScript,
  injectHeartbeatTaskCheck: scriptsLib.injectHeartbeatTaskCheck,
  ensureSharedAdlcScripts:  scriptsLib.ensureSharedAdlcScripts,
  syncAgentConnectionsContext: scriptsLib.syncAgentConnectionsContext,
  stampBuiltinSharedMeta:   scriptsLib.stampBuiltinSharedMeta,
  syncAgentBuiltins:        scriptsLib.syncAgentBuiltins,
  // Concurrency primitives
  withKeyLock:              locksLib.withKeyLock,
  withFileLock:             locksLib.withFileLock,
  withUserLock:             locksLib.withUserLock,
  isBuiltinShared:          scriptsLib.isBuiltinShared,
  purgeLegacyFlatScripts:   scriptsLib.purgeLegacyFlatScripts,

  // ── hooks / inbound webhooks ───────────────────────────────────────────────
  getHooksConfig:   hooksLib.getHooksConfig,
  saveHooksConfig:  hooksLib.saveHooksConfig,
  getHookSessions:  hooksLib.getHookSessions,
  generateToken:    hooksLib.generateToken,

  // ── pairing (DM pairing approval) ─────────────────────────────────────────
  listPairingRequests:     pairingLib.listPairingRequests,
  listAllPairingRequests:  pairingLib.listAllPairingRequests,
  approvePairingCode:      pairingLib.approvePairingCode,
  rejectPairingCode:       pairingLib.rejectPairingCode,
  listAllowFromEntries:    pairingLib.listAllowFromEntries,
  addAllowFromEntry:       pairingLib.addAllowFromEntry,
  removeAllowFromEntry:    pairingLib.removeAllowFromEntry,

  // ── discord guilds ────────────────────────────────────────────────────────
  listAgentDiscordGuilds:   discordGuildsLib.listAgentDiscordGuilds,
  upsertAgentDiscordGuild:  discordGuildsLib.upsertAgentDiscordGuild,
  removeAgentDiscordGuild:  discordGuildsLib.removeAgentDiscordGuild,

  // ── browser-harness (Layer 1 core) ────────────────────────────────────────
  browserHarnessInstaller,
  browserHarnessLauncher,
  browserHarnessPool,
  browserHarnessOdoo,
  aocTasksSkill,
  aocConnectionsSkill,
  missionOrchestratorSkill,
  aocRoomSkill,
  workspaceBrowser,

  // ── role templates (Phase 1: read-only + seed) ────────────────────────────
  listRoleTemplates:       roleTemplates.listTemplates,
  getRoleTemplate:         roleTemplates.getTemplate,
  seedRoleTemplatesIfEmpty: roleTemplates.seedIfEmpty,
  refreshBuiltInRoleTemplates: roleTemplates.refreshBuiltInsFromSeed,
  // ── role templates (Phase 2: CRUD) ────────────────────────────────────────
  createRoleTemplate:       roleTemplates.createTemplate,
  updateRoleTemplate:       roleTemplates.updateTemplate,
  deleteRoleTemplate:       roleTemplates.deleteTemplate,
  forkRoleTemplate:         roleTemplates.forkTemplate,
  listRoleTemplateUsage:    roleTemplates.listTemplateUsage,
  // ── role templates (Phase 5: apply to agent) ──────────────────────────────
  previewRoleTemplateApply: roleTemplates.previewApply,
  applyRoleTemplateToAgent: roleTemplates.applyToAgent,
  unassignAgentRole:        roleTemplates.unassignRole,

  // ── skill catalog (internal marketplace) ──────────────────────────────────
  listCatalogSkills:        skillCatalog.listSkills,
  getCatalogSkill:          skillCatalog.getSkill,
  countCatalogSkills:       skillCatalog.countSkills,
  isCatalogSkillInstalled:  skillCatalog.isInstalled,
  catalogInstalledMap:      skillCatalog.installedMap,
  seedSkillCatalogIfEmpty:  skillCatalog.seedIfEmpty,
  refreshSkillCatalogSeed:  skillCatalog.refreshSeed,
  createCatalogSkill:       skillCatalog.createSkill,
  updateCatalogSkill:       skillCatalog.updateSkill,
  deleteCatalogSkill:       skillCatalog.deleteSkill,
  installCatalogSkill:      skillCatalog.installSkill,
  installCatalogSkills:     skillCatalog.installMany,

  // ── google workspace oauth helpers ─────────────────────────────────────────
  googleBuildScopes:        oauthG.buildScopes,
  googleSignStateJwt:       oauthG.signStateJwt,
  googleVerifyStateJwt:     oauthG.verifyStateJwt,
  googleGenerateAuthUrl:    oauthG.generateAuthUrl,
  googleGeneratePkce:       oauthG.generatePkce,
  googleExchangeCode:       oauthG.exchangeCode,
  googleRefreshAccessToken: oauthG.refreshAccessToken,
  googleRevokeToken:        oauthG.revokeToken,
  googleScopePresets:       oauthG.SCOPE_PRESETS,
  // ── google workspace connection handler ────────────────────────────────────
  googleBeginAuth:          googleConnections.beginAuth,
  googleCompleteAuth:       googleConnections.completeAuth,
  googleDispenseToken:      googleConnections.dispenseToken,
  googleDisconnect:         googleConnections.disconnect,
  googleTestConnection:     googleConnections.testConnection,
  googleRunHealthCheckAll:  googleConnections.runHealthCheckAll,
  googleRedirectUri:        googleConnections.redirectUri,
  // ── google workspace cron ──────────────────────────────────────────────────
  googleHealthCronStart:    googleHealthCron.start,
  googleHealthCronStop:     googleHealthCron.stop,

  // ── db helpers (HQ room) ───────────────────────────────────────────────────
  getHqRoomForUser:         db.getHqRoomForUser,
  getMissionRoomById:       db.getMissionRoomById,
  deleteMissionRoom:        db.deleteMissionRoom,

  // ── room artifacts ─────────────────────────────────────────────────────────
  createArtifact:           roomArtifacts.createArtifact,
  addArtifactVersion:       roomArtifacts.addArtifactVersion,
  listArtifacts:            roomArtifacts.listArtifacts,
  getArtifact:              roomArtifacts.getArtifact,
  getArtifactContent:       roomArtifacts.getArtifactContent,
  pinArtifact:              roomArtifacts.pinArtifact,
  archiveArtifact:          roomArtifacts.archiveArtifact,
  deleteArtifact:           roomArtifacts.deleteArtifact,

  // ── room context ───────────────────────────────────────────────────────────
  getRoomContext:           roomContext.getRoomContext,
  appendToContext:          roomContext.appendToContext,
  clearContext:             roomContext.clearContext,
  getAgentRoomState:        roomContext.getAgentRoomState,
  setAgentRoomState:        roomContext.setAgentRoomState,
};
