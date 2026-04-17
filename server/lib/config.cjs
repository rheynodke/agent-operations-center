'use strict';
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const OPENCLAW_HOME      = process.env.OPENCLAW_HOME || path.join(os.homedir(), '.openclaw');
const OPENCLAW_WORKSPACE = process.env.OPENCLAW_WORKSPACE || path.join(OPENCLAW_HOME, 'workspace');
const AGENTS_DIR         = path.join(OPENCLAW_HOME, 'agents');

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
  OPENCLAW_HOME,
  OPENCLAW_WORKSPACE,
  AGENTS_DIR,
  readJsonSafe,
  GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_SECRET,
  GOOGLE_OAUTH_STATE_SECRET,
  PUBLIC_URL,
  GOOGLE_OAUTH_CONFIGURED,
};
