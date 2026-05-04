'use strict';
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const OPENCLAW_BASE      = process.env.OPENCLAW_HOME || path.join(os.homedir(), '.openclaw');
const OPENCLAW_WORKSPACE = process.env.OPENCLAW_WORKSPACE || path.join(OPENCLAW_BASE, 'workspace');

// Shared resource paths (admin-managed, accessible by all per-user gateways via symlink)
const SHARED_SKILLS    = path.join(OPENCLAW_BASE, 'skills');
const SHARED_SCRIPTS   = path.join(OPENCLAW_BASE, 'scripts');
const SHARED_PROVIDERS = path.join(OPENCLAW_BASE, 'shared', 'providers.json5');

/**
 * Resolve a user's OPENCLAW_HOME directory.
 * Admin (user 1) maps to the root OPENCLAW_BASE for back-compat with OpenClaw CLI/extensions.
 * All other users live under <OPENCLAW_BASE>/users/<id>/.openclaw/.
 *
 * @param {number|string} userId
 * @returns {string} absolute path
 */
function getUserHome(userId) {
  if (Number(userId) === 1) return OPENCLAW_BASE;
  return path.join(OPENCLAW_BASE, 'users', String(userId), '.openclaw');
}

function getUserAgentsDir(userId) {
  return path.join(getUserHome(userId), 'agents');
}

function getUserCronFile(userId) {
  return path.join(getUserHome(userId), 'cron', 'jobs.json');
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

// ── Google Workspace OAuth ───────────────────────────────────────────────────
const GOOGLE_OAUTH_CLIENT_ID     = process.env.GOOGLE_OAUTH_CLIENT_ID     || '';
const GOOGLE_OAUTH_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || '';
const GOOGLE_OAUTH_STATE_SECRET  = process.env.GOOGLE_OAUTH_STATE_SECRET  || process.env.DASHBOARD_TOKEN || '';
const PUBLIC_URL                 = process.env.PUBLIC_URL                 || `http://localhost:${process.env.PORT || 18800}`;
const GOOGLE_OAUTH_CONFIGURED    = !!(GOOGLE_OAUTH_CLIENT_ID && GOOGLE_OAUTH_CLIENT_SECRET && GOOGLE_OAUTH_STATE_SECRET);

module.exports = {
  // Multi-tenant primitives (preferred for new code)
  OPENCLAW_BASE,
  SHARED_SKILLS,
  SHARED_SCRIPTS,
  SHARED_PROVIDERS,
  getUserHome,
  getUserAgentsDir,
  getUserCronFile,

  // Back-compat aliases (admin context — existing 193 touchpoints continue to work)
  OPENCLAW_HOME: OPENCLAW_BASE,
  AGENTS_DIR: path.join(OPENCLAW_BASE, 'agents'),
  OPENCLAW_WORKSPACE,

  readJsonSafe,
  GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_SECRET,
  GOOGLE_OAUTH_STATE_SECRET,
  PUBLIC_URL,
  GOOGLE_OAUTH_CONFIGURED,
};
