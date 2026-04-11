'use strict';
const fs   = require('fs');
const path = require('path');
const { OPENCLAW_HOME, OPENCLAW_WORKSPACE, readJsonSafe } = require('../config.cjs');
const { readMdFile } = require('./detail.cjs');

const ALLOWED_FILES = ['IDENTITY.md', 'SOUL.md', 'TOOLS.md', 'AGENTS.md', 'USER.md', 'HEARTBEAT.md', 'MEMORY.md'];

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

// ── Research Output Standard injection ───────────────────────────────────────

const SOUL_STANDARD_MARKER = '<!-- aoc:research-standard:start -->';

const RESEARCH_STANDARD_BLOCK = `

<!-- aoc:research-standard:start -->
## Output Standard: Research & Web Search

Whenever you perform web searches, browse URLs, or gather information from external sources, **always include a Sources section at the end of your response**.

**Format:**

**Sources:**
- https://example.com/article-you-read
- https://another-source.com/reference

**Rules:**
- List every URL you actually accessed, read, or referenced
- Only include URLs you genuinely visited — never fabricate sources
- If no web search or URL retrieval was performed in this response, omit the Sources section entirely
- Sources allow humans to verify your findings and build trust in your work
<!-- aoc:research-standard:end -->`;

/**
 * Idempotently inject the AOC research output standard into an agent's SOUL.md.
 * Returns { agentId, status: 'injected' | 'already_applied' | 'error', error? }.
 */
function injectSoulStandard(agentId) {
  try {
    const fileInfo = getAgentFile(agentId, 'SOUL.md');
    const content = fileInfo.content || '';

    if (content.includes(SOUL_STANDARD_MARKER)) {
      return { agentId, status: 'already_applied' };
    }

    const updated = content.trimEnd() + RESEARCH_STANDARD_BLOCK + '\n';
    fs.writeFileSync(fileInfo.path, updated, 'utf-8');
    return { agentId, status: 'injected' };
  } catch (err) {
    return { agentId, status: 'error', error: err.message };
  }
}

module.exports = { ALLOWED_FILES, normalizeFilename, getAgentFile, saveAgentFile, injectSoulStandard, SOUL_STANDARD_MARKER };
