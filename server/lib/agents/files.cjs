'use strict';
const fs   = require('fs');
const path = require('path');
const { OPENCLAW_HOME, OPENCLAW_WORKSPACE, readJsonSafe } = require('../config.cjs');
const { readMdFile } = require('./detail.cjs');

const ALLOWED_FILES = ['IDENTITY.md', 'SOUL.md', 'TOOLS.md', 'AGENTS.md', 'USER.md', 'HEARTBEAT.md'];

function normalizeFilename(filename) {
  const upper = filename.toUpperCase();
  const base  = upper.endsWith('.MD') ? upper.slice(0, -3) : upper;
  return base + '.md';
}

function getAgentFile(agentId, filename) {
  const normalizedFilename = normalizeFilename(filename);
  if (!ALLOWED_FILES.includes(normalizedFilename)) throw new Error(`File "${filename}" is not allowed`);

  const config = readJsonSafe(path.join(OPENCLAW_HOME, 'openclaw.json'));
  if (!config) throw new Error('Cannot read openclaw.json');

  const agentConfig = (config.agents?.list || []).find(a => a.id === agentId);
  if (!agentConfig) throw new Error(`Agent "${agentId}" not found`);

  const agentWorkspace = agentConfig.workspace || OPENCLAW_WORKSPACE;

  let filePath = path.join(agentWorkspace, normalizedFilename);
  let content  = readMdFile(filePath);
  let resolvedPath = filePath;

  if (content === null && agentWorkspace !== OPENCLAW_WORKSPACE) {
    filePath     = path.join(OPENCLAW_WORKSPACE, normalizedFilename);
    content      = readMdFile(filePath);
    resolvedPath = filePath;
  }

  return {
    filename: normalizedFilename,
    content: content || '',
    path: resolvedPath,
    exists: content !== null,
    isGlobal: resolvedPath.startsWith(OPENCLAW_WORKSPACE) && agentWorkspace !== OPENCLAW_WORKSPACE,
    agentWorkspace,
  };
}

function saveAgentFile(agentId, filename, content) {
  const normalizedFilename = normalizeFilename(filename);
  if (!ALLOWED_FILES.includes(normalizedFilename)) throw new Error(`File "${filename}" is not allowed`);

  const config = readJsonSafe(path.join(OPENCLAW_HOME, 'openclaw.json'));
  if (!config) throw new Error('Cannot read openclaw.json');

  const agentConfig = (config.agents?.list || []).find(a => a.id === agentId);
  if (!agentConfig) throw new Error(`Agent "${agentId}" not found`);

  const agentWorkspace = agentConfig.workspace || OPENCLAW_WORKSPACE;
  const filePath = path.join(agentWorkspace, normalizedFilename);

  fs.mkdirSync(agentWorkspace, { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');

  return { agentId, filename: normalizedFilename, path: filePath };
}

module.exports = { ALLOWED_FILES, normalizeFilename, getAgentFile, saveAgentFile };
