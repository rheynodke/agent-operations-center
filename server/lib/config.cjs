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

module.exports = { OPENCLAW_HOME, OPENCLAW_WORKSPACE, AGENTS_DIR, readJsonSafe };
