'use strict';
const fs   = require('fs');
const path = require('path');
const { OPENCLAW_HOME, OPENCLAW_WORKSPACE, readJsonSafe } = require('../config.cjs');

// ── Security constants ────────────────────────────────────────────────────────
const ALLOWED_EXTENSIONS = ['.sh', '.py', '.js', '.ts', '.rb', '.php', '.lua', '.bash', '.zsh', '.fish'];
const MAX_FILE_SIZE = 512 * 1024; // 512 KB
const SAFE_FILENAME  = /^[a-zA-Z0-9_.\-]+$/;

const EXECUTABLE_EXTENSIONS = ['.sh', '.py', '.js', '.ts', '.bash', '.zsh', '.fish', '.rb', '.lua'];

/** Ext → emoji hint */
const EXT_EMOJI = {
  '.sh': '🟢', '.bash': '🟢', '.zsh': '🟢', '.fish': '🟢',
  '.py': '🐍',
  '.js': '🟡',
  '.ts': '🔷',
  '.rb': '🔴',
  '.php': '🟣',
  '.lua': '🌙',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function validateFilename(filename) {
  if (!filename) throw new Error('Filename is required');
  if (!SAFE_FILENAME.test(filename)) throw new Error('Invalid filename — only letters, numbers, dash, underscore, dot are allowed');
  if (filename.includes('..')) throw new Error('Path traversal not allowed');
  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    throw new Error(`Extension "${ext}" not allowed. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`);
  }
  return ext;
}

function getAgentSkillPath(agentId, skillName) {
  const config = readJsonSafe(path.join(OPENCLAW_HOME, 'openclaw.json')) || {};
  const agentConfig = (config.agents?.list || []).find(a => a.id === agentId);
  if (!agentConfig) throw new Error(`Agent "${agentId}" not found`);

  const agentWorkspace = agentConfig.workspace || OPENCLAW_WORKSPACE;

  // Find the skill across all source levels (same as skills.cjs logic)
  const possibleDirs = [
    path.join(agentWorkspace, 'skills', skillName),
    path.join(agentWorkspace, '.agents', 'skills', skillName),
    path.join(process.env.HOME || '~', '.agents', 'skills', skillName),
    path.join(OPENCLAW_HOME, 'skills', skillName),
  ];

  for (const dir of possibleDirs) {
    if (fs.existsSync(path.join(dir, 'SKILL.md'))) {
      return { skillDir: dir, scriptsDir: path.join(dir, 'scripts'), agentWorkspace };
    }
  }
  throw new Error(`Skill "${skillName}" not found for agent "${agentId}"`);
}

/** Build copyable exec path hint (relative using ~) */
function buildExecHint(scriptsDir, filename) {
  const homeDir = process.env.HOME || '';
  const relPath = homeDir && scriptsDir.startsWith(homeDir)
    ? '~' + scriptsDir.slice(homeDir.length)
    : scriptsDir;
  const ext = path.extname(filename).toLowerCase();
  const runner = ext === '.py' ? 'python3' : ext === '.js' ? 'node' : ext === '.ts' ? 'ts-node' : 'bash';
  return `${runner} ${relPath}/${filename}`;
}

/** Build SKILL.md exec snippet to auto-append */
function buildSkillMdSnippet(scriptsDir, filename) {
  const execHint = buildExecHint(scriptsDir, filename);
  const scriptName = path.basename(filename, path.extname(filename));
  return `\n## Script: ${filename}\n\nTo run **${scriptName}**:\n\`\`\`\n${execHint}\n\`\`\`\n`;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * List all scripts inside a skill's scripts/ folder.
 */
function listSkillScripts(agentId, skillName) {
  const { scriptsDir } = getAgentSkillPath(agentId, skillName);

  if (!fs.existsSync(scriptsDir)) return [];

  let entries;
  try { entries = fs.readdirSync(scriptsDir, { withFileTypes: true }); } catch { return []; }

  return entries
    .filter(e => e.isFile())
    .map(e => {
      const ext  = path.extname(e.name).toLowerCase();
      const stat = fs.statSync(path.join(scriptsDir, e.name));
      const executable = !!(stat.mode & 0o111);
      return {
        name: e.name,
        ext,
        emoji: EXT_EMOJI[ext] || '📄',
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        executable,
        allowed: ALLOWED_EXTENSIONS.includes(ext),
      };
    })
    .filter(f => f.allowed)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Read a single script's content.
 */
function getSkillScript(agentId, skillName, filename) {
  const ext = validateFilename(filename);
  const { scriptsDir } = getAgentSkillPath(agentId, skillName);

  const filePath = path.join(scriptsDir, filename);
  if (!fs.existsSync(filePath)) throw new Error(`Script "${filename}" not found`);

  const content = fs.readFileSync(filePath, 'utf-8');
  const stat = fs.statSync(filePath);
  const executable = !!(stat.mode & 0o111);

  return {
    name: filename,
    ext,
    emoji: EXT_EMOJI[ext] || '📄',
    content,
    path: filePath,
    executable,
    size: stat.size,
    execHint: buildExecHint(scriptsDir, filename),
  };
}

/**
 * Save (create or overwrite) a script file.
 * Auto-chmod +x for executable extensions.
 * Auto-appends exec snippet to SKILL.md if it's a new file.
 */
function saveSkillScript(agentId, skillName, filename, content, options = {}) {
  const ext = validateFilename(filename);

  if (Buffer.byteLength(content, 'utf-8') > MAX_FILE_SIZE) {
    throw new Error(`File too large (max 512KB)`);
  }

  const { skillDir, scriptsDir } = getAgentSkillPath(agentId, skillName);
  fs.mkdirSync(scriptsDir, { recursive: true });

  const filePath = path.join(scriptsDir, filename);
  const isNew    = !fs.existsSync(filePath);

  fs.writeFileSync(filePath, content, 'utf-8');

  // chmod +x for executable extensions
  if (EXECUTABLE_EXTENSIONS.includes(ext)) {
    try {
      const stat = fs.statSync(filePath);
      fs.chmodSync(filePath, stat.mode | 0o111);
    } catch { /* non-fatal */ }
  }

  // Auto-append exec snippet to SKILL.md if new file and option not disabled
  let skillMdUpdated = false;
  if (isNew && options.appendToSkillMd !== false) {
    const skillMdPath = path.join(skillDir, 'SKILL.md');
    if (fs.existsSync(skillMdPath)) {
      const snippet = buildSkillMdSnippet(scriptsDir, filename);
      const existing = fs.readFileSync(skillMdPath, 'utf-8');
      // Only append if not already mentioned
      if (!existing.includes(filename)) {
        fs.appendFileSync(skillMdPath, snippet, 'utf-8');
        skillMdUpdated = true;
      }
    }
  }

  const stat = fs.statSync(filePath);
  return {
    name: filename,
    path: filePath,
    size: stat.size,
    executable: !!(stat.mode & 0o111),
    execHint: buildExecHint(scriptsDir, filename),
    skillMdUpdated,
    isNew,
  };
}

/**
 * Delete a script file.
 */
function deleteSkillScript(agentId, skillName, filename) {
  validateFilename(filename);
  const { scriptsDir } = getAgentSkillPath(agentId, skillName);

  const filePath = path.join(scriptsDir, filename);
  if (!fs.existsSync(filePath)) throw new Error(`Script "${filename}" not found`);

  fs.unlinkSync(filePath);
  return { deleted: true, name: filename };
}

/**
 * Get scripts directory path info (for frontend path hint).
 */
function getSkillScriptsPath(agentId, skillName) {
  const { skillDir, scriptsDir } = getAgentSkillPath(agentId, skillName);
  const homeDir = process.env.HOME || '';
  const relPath  = homeDir && scriptsDir.startsWith(homeDir)
    ? '~' + scriptsDir.slice(homeDir.length)
    : scriptsDir;

  return {
    scriptsDir,
    relPath,
    skillDir,
    scriptsDirExists: fs.existsSync(scriptsDir),
    scriptCount: fs.existsSync(scriptsDir)
      ? fs.readdirSync(scriptsDir).filter(f => ALLOWED_EXTENSIONS.includes(path.extname(f).toLowerCase())).length
      : 0,
  };
}

module.exports = {
  listSkillScripts,
  getSkillScript,
  saveSkillScript,
  deleteSkillScript,
  getSkillScriptsPath,
  ALLOWED_EXTENSIONS,
  EXT_EMOJI,
};
