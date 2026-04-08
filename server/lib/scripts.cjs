'use strict';
/**
 * server/lib/scripts.cjs
 *
 * Global workspace scripts — stored at ~/.openclaw/workspace/scripts/
 * These are reusable shell/python/js scripts that agents can execute
 * via cron jobs or direct invocation.
 */
const fs   = require('fs');
const path = require('path');
const { OPENCLAW_HOME, OPENCLAW_WORKSPACE, readJsonSafe } = require('./config.cjs');

const SCRIPTS_DIR = path.join(OPENCLAW_HOME, 'scripts');

const ALLOWED_EXT = ['.sh', '.py', '.js', '.ts', '.rb', '.bash', '.zsh', '.fish', '.lua'];
const MAX_SIZE    = 512 * 1024; // 512 KB
const SAFE_NAME   = /^[a-zA-Z0-9_.\-]+$/;

const EXT_EMOJI = {
  '.sh': '🟢', '.bash': '🟢', '.zsh': '🟢', '.fish': '🟢',
  '.py': '🐍', '.js': '🟡', '.ts': '🔷', '.rb': '💎', '.lua': '🌙',
};
const EXT_LANG = {
  '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash', '.fish': 'bash',
  '.py': 'python', '.js': 'javascript', '.ts': 'typescript', '.rb': 'ruby', '.lua': 'lua',
};

function ensureDir() {
  if (!fs.existsSync(SCRIPTS_DIR)) fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
}

// ─── Metadata helpers ─────────────────────────────────────────────────────────

function readMeta(dir) {
  const metaPath = path.join(dir, '.tools.json');
  return readJsonSafe(metaPath) || {};
}

function writeMeta(dir, data) {
  const metaPath = path.join(dir, '.tools.json');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(metaPath, JSON.stringify(data, null, 2), 'utf-8');
}

function getScriptMeta(dir, filename) {
  const all = readMeta(dir);
  return all[filename] || { name: '', description: '' };
}

function saveScriptMeta(dir, filename, meta) {
  const all = readMeta(dir);
  all[filename] = { name: meta.name || '', description: meta.description || '' };
  writeMeta(dir, all);
  return all[filename];
}

function deleteScriptMeta(dir, filename) {
  const all = readMeta(dir);
  delete all[filename];
  writeMeta(dir, all);
}

function renameScriptMeta(dir, oldName, newName) {
  const all = readMeta(dir);
  if (all[oldName]) {
    all[newName] = all[oldName];
    delete all[oldName];
    writeMeta(dir, all);
  }
}

function scriptMeta(filename) {
  const ext  = path.extname(filename).toLowerCase();
  const stat = fs.statSync(path.join(SCRIPTS_DIR, filename));
  const meta = getScriptMeta(SCRIPTS_DIR, filename);
  return {
    name:        filename,
    displayName: meta.name || '',
    description: meta.description || '',
    ext,
    emoji:       EXT_EMOJI[ext] || '📄',
    lang:        EXT_LANG[ext]  || 'text',
    size:        stat.size,
    mtime:       stat.mtime.toISOString(),
    executable:  !!(stat.mode & 0o111),
    path:        path.join(SCRIPTS_DIR, filename),
    relPath:     `~/.openclaw/scripts/${filename}`,
    execHint:    buildExecHint(filename, ext),
  };
}

function buildExecHint(filename, ext) {
  const abs = `~/.openclaw/scripts/${filename}`;
  if (['.sh', '.bash', '.zsh', '.fish'].includes(ext)) return `bash ${abs}`;
  if (ext === '.py')  return `python3 ${abs}`;
  if (ext === '.js')  return `node ${abs}`;
  if (ext === '.ts')  return `npx ts-node ${abs}`;
  if (ext === '.rb')  return `ruby ${abs}`;
  return abs;
}

// ─── Public API ───────────────────────────────────────────────────────────────

function listScripts() {
  ensureDir();
  return fs.readdirSync(SCRIPTS_DIR)
    .filter((f) => {
      const ext = path.extname(f).toLowerCase();
      return ALLOWED_EXT.includes(ext) && SAFE_NAME.test(f);
    })
    .map(scriptMeta)
    .sort((a, b) => b.mtime.localeCompare(a.mtime));
}

function getScript(filename) {
  if (!SAFE_NAME.test(filename)) throw Object.assign(new Error('Invalid filename'), { status: 400 });
  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) throw Object.assign(new Error('File type not allowed'), { status: 400 });

  const filePath = path.join(SCRIPTS_DIR, filename);
  if (!fs.existsSync(filePath)) throw Object.assign(new Error(`Script not found: ${filename}`), { status: 404 });

  const content = fs.readFileSync(filePath, 'utf-8');
  return { ...scriptMeta(filename), content };
}

function updateScriptMeta(filename, meta) {
  if (!SAFE_NAME.test(filename)) throw Object.assign(new Error('Invalid filename'), { status: 400 });
  ensureDir();
  const saved = saveScriptMeta(SCRIPTS_DIR, filename, meta);
  return saved;
}

function saveScript(filename, content) {
  if (!SAFE_NAME.test(filename)) throw Object.assign(new Error('Invalid filename'), { status: 400 });
  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) throw Object.assign(new Error(`Allowed: ${ALLOWED_EXT.join(', ')}`), { status: 400 });
  if (typeof content !== 'string') throw Object.assign(new Error('Content must be a string'), { status: 400 });
  if (Buffer.byteLength(content) > MAX_SIZE) throw Object.assign(new Error('File too large (max 512KB)'), { status: 400 });

  ensureDir();
  const filePath = path.join(SCRIPTS_DIR, filename);
  const isNew = !fs.existsSync(filePath);

  fs.writeFileSync(filePath, content, 'utf-8');

  // Auto-chmod +x for shell/executable types
  if (['.sh', '.bash', '.zsh', '.fish', '.py'].includes(ext)) {
    try { fs.chmodSync(filePath, 0o755); } catch {}
  }

  return { ...scriptMeta(filename), content, isNew };
}

function deleteScript(filename) {
  if (!SAFE_NAME.test(filename)) throw Object.assign(new Error('Invalid filename'), { status: 400 });
  const filePath = path.join(SCRIPTS_DIR, filename);
  if (!fs.existsSync(filePath)) throw Object.assign(new Error(`Script not found: ${filename}`), { status: 404 });
  fs.unlinkSync(filePath);
  deleteScriptMeta(SCRIPTS_DIR, filename);
  return { ok: true, deleted: filename };
}

function renameScript(oldName, newName) {
  if (!SAFE_NAME.test(oldName) || !SAFE_NAME.test(newName)) throw Object.assign(new Error('Invalid filename'), { status: 400 });
  const oldPath = path.join(SCRIPTS_DIR, oldName);
  const newPath = path.join(SCRIPTS_DIR, newName);
  if (!fs.existsSync(oldPath)) throw Object.assign(new Error(`Script not found: ${oldName}`), { status: 404 });
  if (fs.existsSync(newPath)) throw Object.assign(new Error(`File already exists: ${newName}`), { status: 409 });
  fs.renameSync(oldPath, newPath);
  renameScriptMeta(SCRIPTS_DIR, oldName, newName);
  return scriptMeta(newName);
}

// ─── Agent workspace scripts (agentWorkspace/scripts/) ───────────────────────

function getAgentWorkspacePath(agentId) {
  const cfg = readJsonSafe(path.join(OPENCLAW_HOME, 'openclaw.json')) || {};
  const agent = (cfg.agents?.list || []).find(a => a.id === agentId);
  return agent?.workspace || OPENCLAW_WORKSPACE;
}

function agentScriptsDir(agentId) {
  return path.join(getAgentWorkspacePath(agentId), 'scripts');
}

function agentScriptMeta(agentId, filename) {
  const dir  = agentScriptsDir(agentId);
  const ext  = path.extname(filename).toLowerCase();
  const stat = fs.statSync(path.join(dir, filename));
  const workspace = getAgentWorkspacePath(agentId);
  const relBase   = workspace.replace(require('os').homedir(), '~');
  const relPath   = `${relBase}/scripts/${filename}`;
  const meta = getScriptMeta(dir, filename);
  return {
    name:        filename,
    displayName: meta.name || '',
    description: meta.description || '',
    ext,
    emoji:       EXT_EMOJI[ext] || '📄',
    lang:        EXT_LANG[ext]  || 'text',
    size:        stat.size,
    mtime:       stat.mtime.toISOString(),
    executable:  !!(stat.mode & 0o111),
    relPath,
    execHint:    buildExecHintForPath(filename, ext, relPath),
    scope:       'agent',
  };
}

function updateAgentScriptMeta(agentId, filename, meta) {
  if (!SAFE_NAME.test(filename)) throw Object.assign(new Error('Invalid filename'), { status: 400 });
  const dir = agentScriptsDir(agentId);
  return saveScriptMeta(dir, filename, meta);
}

function buildExecHintForPath(filename, ext, relPath) {
  if (['.sh', '.bash', '.zsh', '.fish'].includes(ext)) return `bash ${relPath}`;
  if (ext === '.py')  return `python3 ${relPath}`;
  if (ext === '.js')  return `node ${relPath}`;
  if (ext === '.ts')  return `npx ts-node ${relPath}`;
  if (ext === '.rb')  return `ruby ${relPath}`;
  return relPath;
}

function listAgentScripts(agentId) {
  const dir = agentScriptsDir(agentId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => ALLOWED_EXT.includes(path.extname(f).toLowerCase()) && SAFE_NAME.test(f))
    .map(f => agentScriptMeta(agentId, f))
    .sort((a, b) => b.mtime.localeCompare(a.mtime));
}

function getAgentScript(agentId, filename) {
  if (!SAFE_NAME.test(filename)) throw Object.assign(new Error('Invalid filename'), { status: 400 });
  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) throw Object.assign(new Error('File type not allowed'), { status: 400 });
  const filePath = path.join(agentScriptsDir(agentId), filename);
  if (!fs.existsSync(filePath)) throw Object.assign(new Error(`Script not found: ${filename}`), { status: 404 });
  return { ...agentScriptMeta(agentId, filename), content: fs.readFileSync(filePath, 'utf-8') };
}

function saveAgentScript(agentId, filename, content) {
  if (!SAFE_NAME.test(filename)) throw Object.assign(new Error('Invalid filename'), { status: 400 });
  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) throw Object.assign(new Error(`Allowed: ${ALLOWED_EXT.join(', ')}`), { status: 400 });
  if (typeof content !== 'string') throw Object.assign(new Error('Content must be string'), { status: 400 });
  if (Buffer.byteLength(content) > MAX_SIZE) throw Object.assign(new Error('File too large (max 512KB)'), { status: 400 });
  const dir = agentScriptsDir(agentId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  const isNew = !fs.existsSync(filePath);
  fs.writeFileSync(filePath, content, 'utf-8');
  if (['.sh', '.bash', '.zsh', '.fish', '.py'].includes(ext)) {
    try { fs.chmodSync(filePath, 0o755); } catch {}
  }
  return { ...agentScriptMeta(agentId, filename), content, isNew };
}

function deleteAgentScript(agentId, filename) {
  if (!SAFE_NAME.test(filename)) throw Object.assign(new Error('Invalid filename'), { status: 400 });
  const dir = agentScriptsDir(agentId);
  const filePath = path.join(dir, filename);
  if (!fs.existsSync(filePath)) throw Object.assign(new Error(`Script not found: ${filename}`), { status: 404 });
  fs.unlinkSync(filePath);
  deleteScriptMeta(dir, filename);
  return { ok: true, deleted: filename };
}

function renameAgentScript(agentId, oldName, newName) {
  if (!SAFE_NAME.test(oldName) || !SAFE_NAME.test(newName)) throw Object.assign(new Error('Invalid filename'), { status: 400 });
  const dir = agentScriptsDir(agentId);
  const oldPath = path.join(dir, oldName);
  const newPath = path.join(dir, newName);
  if (!fs.existsSync(oldPath)) throw Object.assign(new Error(`Script not found: ${oldName}`), { status: 404 });
  if (fs.existsSync(newPath)) throw Object.assign(new Error(`Already exists: ${newName}`), { status: 409 });
  fs.renameSync(oldPath, newPath);
  renameScriptMeta(dir, oldName, newName);
  return agentScriptMeta(agentId, newName);
}

// ─── Agent custom-tool assignment via TOOLS.md ───────────────────────────────

const MARKER_START = (name) => `<!-- custom-tool: ${name} -->`;
const MARKER_END   = (name) => `<!-- /custom-tool: ${name} -->`;

function buildToolBlock(s) {
  const exec  = s.execHint || buildExecHint(s.name, path.extname(s.name).toLowerCase());
  const title = s.displayName ? `${s.name} — ${s.displayName}` : s.name;
  const lines = [
    MARKER_START(s.name),
    `### ${s.emoji || '📄'} ${title}`,
  ];
  if (s.description) lines.push(`Description: ${s.description}`);
  lines.push(`Execute: \`${exec}\``);
  lines.push(MARKER_END(s.name));
  return lines.join('\n');
}

/** Returns both shared (~/.openclaw/scripts) and agent-specific scripts with enabled status */
function listAgentCustomTools(agentId, getAgentFileFn) {
  let toolsMd = '';
  try { toolsMd = getAgentFileFn(agentId, 'TOOLS.md').content || ''; } catch {}

  // Shared scripts — read-only preview, toggle to assign
  const shared = listScripts().map((s) => ({
    ...s,
    scope: 'shared',
    enabled: toolsMd.includes(MARKER_START(s.name)),
  }));

  // Agent-specific scripts — full CRUD, always shown, toggle to enable
  const agentSpecific = listAgentScripts(agentId).map((s) => ({
    ...s,
    scope: 'agent',
    enabled: toolsMd.includes(MARKER_START(s.name)),
  }));

  return { shared, agent: agentSpecific };
}

/** Toggle a custom tool on/off for an agent — writes TOOLS.md.
 *  scope: 'shared' (from ~/.openclaw/scripts) | 'agent' (from agentWorkspace/scripts) */
function toggleAgentCustomTool(agentId, filename, enabled, scope, getAgentFileFn, saveAgentFileFn) {
  if (!SAFE_NAME.test(filename)) throw Object.assign(new Error('Invalid filename'), { status: 400 });

  let current = '';
  try { current = getAgentFileFn(agentId, 'TOOLS.md').content || ''; } catch {}

  const start = MARKER_START(filename);
  const end   = MARKER_END(filename);

  if (enabled) {
    if (current.includes(start)) return { ok: true, enabled: true };

    // Find meta for the script (try agent scope first, then shared)
    let meta;
    if (scope === 'agent') {
      try { meta = agentScriptMeta(agentId, filename); } catch {}
    }
    if (!meta) {
      meta = listScripts().find(s => s.name === filename);
    }
    if (!meta) throw Object.assign(new Error(`Script not found: ${filename}`), { status: 404 });

    const block = buildToolBlock(meta);
    const hasSectionHeader = current.includes('## Custom Tools');
    const newContent = hasSectionHeader
      ? current.trimEnd() + '\n\n' + block + '\n'
      : current.trimEnd() + '\n\n## Custom Tools\n\n' + block + '\n';
    saveAgentFileFn(agentId, 'TOOLS.md', newContent);
    return { ok: true, enabled: true };
  } else {
    const startIdx = current.indexOf(start);
    if (startIdx === -1) return { ok: true, enabled: false };
    const endIdx = current.indexOf(end, startIdx);
    const before = current.slice(0, startIdx);
    const after  = endIdx !== -1 ? current.slice(endIdx + end.length) : current.slice(startIdx + start.length);
    const newContent = (before + after).replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
    saveAgentFileFn(agentId, 'TOOLS.md', newContent);
    return { ok: true, enabled: false };
  }
}

module.exports = {
  // Shared scripts (~/.openclaw/scripts)
  listScripts, getScript, saveScript, deleteScript, renameScript, updateScriptMeta,
  // Agent workspace scripts ({workspace}/scripts)
  listAgentScripts, getAgentScript, saveAgentScript, deleteAgentScript, renameAgentScript, updateAgentScriptMeta,
  // Custom tool assignment via TOOLS.md
  listAgentCustomTools, toggleAgentCustomTool,
  SCRIPTS_DIR, ALLOWED_EXT,
};
