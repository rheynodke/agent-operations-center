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

const UPDATE_TASK_SCRIPT_NAME = 'update_task.sh';
const OPENCLAW_HOME_PATH = require('./config.cjs').OPENCLAW_HOME;
const AOC_ENV_FILE = path.join(OPENCLAW_HOME_PATH, '.aoc_env');

const UPDATE_TASK_SCRIPT_CONTENT = `#!/usr/bin/env bash
# update_task — Report task progress to AOC Board
# Usage: update_task.sh <taskId> <status> [note] [sessionId] [inputTokens] [outputTokens]
#
# status: in_progress | in_review | blocked | todo | done
# inputTokens / outputTokens: optional token usage for monitoring

set -euo pipefail

# Load AOC config from shared env file (most reliable)
AOC_ENV_FILE="\${OPENCLAW_HOME:-$HOME/.openclaw}/.aoc_env"
if [ -f "$AOC_ENV_FILE" ]; then
  # shellcheck source=/dev/null
  source "$AOC_ENV_FILE"
fi

TASK_ID="\${1:?taskId required}"
STATUS="\${2:?status required}"
NOTE="\${3:-}"
SESSION_ID="\${4:-}"
INPUT_TOKENS="\${5:-}"
OUTPUT_TOKENS="\${6:-}"

AOC_URL="\${AOC_URL:-http://localhost:18800}"
AOC_TOKEN="\${AOC_TOKEN:?AOC_TOKEN not set. Check ~/.openclaw/.aoc_env}"
AGENT_ID="\${AOC_AGENT_ID:-}"

# Build JSON payload — only include token fields if provided
PAYLOAD="{\\"status\\": \\"$STATUS\\", \\"note\\": \\"$NOTE\\", \\"sessionId\\": \\"$SESSION_ID\\", \\"agentId\\": \\"$AGENT_ID\\""
[ -n "$INPUT_TOKENS"  ] && PAYLOAD="$PAYLOAD, \\"inputTokens\\": $INPUT_TOKENS"
[ -n "$OUTPUT_TOKENS" ] && PAYLOAD="$PAYLOAD, \\"outputTokens\\": $OUTPUT_TOKENS"
PAYLOAD="$PAYLOAD}"

curl -sf -X PATCH "$AOC_URL/api/tasks/$TASK_ID" \\
  -H "Authorization: Bearer $AOC_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d "$PAYLOAD"
`;

function ensureUpdateTaskScript() {
  ensureDir(); // ensures SCRIPTS_DIR exists
  const scriptPath = path.join(SCRIPTS_DIR, UPDATE_TASK_SCRIPT_NAME);
  if (fs.existsSync(scriptPath)) return; // idempotent

  fs.writeFileSync(scriptPath, UPDATE_TASK_SCRIPT_CONTENT, { mode: 0o755, encoding: 'utf-8' });

  // Write metadata to .tools.json
  const meta = readMeta(SCRIPTS_DIR);
  meta[UPDATE_TASK_SCRIPT_NAME] = {
    name: 'update_task',
    emoji: '📋',
    description: 'Report task progress to AOC Board. Usage: update_task.sh <taskId> <status> [note] [sessionId] [inputTokens] [outputTokens]',
    execHint: `${SCRIPTS_DIR}/update_task.sh <taskId> <status> [note] [sessionId] [inputTokens] [outputTokens]`,
  };
  writeMeta(SCRIPTS_DIR, meta);

  console.log('[scripts] Created shared update_task.sh script');
}

const CHECK_TASKS_SCRIPT_NAME = 'check_tasks.sh';
const CHECK_TASKS_SCRIPT_CONTENT = `#!/usr/bin/env bash
# check_tasks — List todo tasks assigned to this agent, sorted by priority
# Called automatically via HEARTBEAT.md

source "\${OPENCLAW_HOME:-$HOME/.openclaw}/.aoc_env"

[ -z "$AOC_AGENT_ID" ] && exit 0   # no agent id configured, skip silently

TASKS=$(curl -sf "$AOC_URL/api/tasks?agentId=$AOC_AGENT_ID&status=todo" \\
  -H "Authorization: Bearer $AOC_TOKEN" 2>/dev/null) || exit 0

echo "$TASKS" | python3 -c "
import json, sys
tasks = json.load(sys.stdin).get('tasks', [])
if not tasks:
    print('No pending tasks.')
    sys.exit(0)
order = {'urgent': 0, 'high': 1, 'medium': 2, 'low': 3}
for t in sorted(tasks, key=lambda t: order.get(t.get('priority', 'medium'), 2)):
    print(f\\"[{t.get('priority','medium').upper()}] {t['title']}\\")
    print(f\\"  ID: {t['id']}\\")
    print(f\\"  Description: {t.get('description', '(none)')[:120]}\\")
    print()
"
`;

function ensureCheckTasksScript() {
  ensureDir();
  const scriptPath = path.join(SCRIPTS_DIR, CHECK_TASKS_SCRIPT_NAME);
  if (fs.existsSync(scriptPath)) return; // idempotent

  fs.writeFileSync(scriptPath, CHECK_TASKS_SCRIPT_CONTENT, { mode: 0o755, encoding: 'utf-8' });

  const meta = readMeta(SCRIPTS_DIR);
  meta[CHECK_TASKS_SCRIPT_NAME] = {
    name: 'check_tasks',
    emoji: '🔍',
    description: 'List todo tasks assigned to this agent, sorted by priority. Called via HEARTBEAT.md.',
    execHint: `${SCRIPTS_DIR}/check_tasks.sh`,
  };
  writeMeta(SCRIPTS_DIR, meta);

  console.log('[scripts] Created shared check_tasks.sh script');
}

const HEARTBEAT_BLOCK_START = '<!-- aoc-task-check -->';
const HEARTBEAT_BLOCK_END   = '<!-- /aoc-task-check -->';
const HEARTBEAT_BLOCK_CONTENT = `${HEARTBEAT_BLOCK_START}
## Autonomous Task Check

Check if you have tasks assigned to you:

1. Run: \`bash ~/.openclaw/scripts/check_tasks.sh\`
2. If tasks are listed, pick the **highest priority** task (shown first) and start working on it immediately
3. You may work on **multiple tasks in parallel** — do not wait for current tasks to finish
4. For each task you start, immediately run:
   \`update_task.sh <taskId> in_progress "Starting work"\`
5. When done: \`update_task.sh <taskId> done "Summary of what was done"\`
6. If blocked: \`update_task.sh <taskId> blocked "Specific reason"\`
${HEARTBEAT_BLOCK_END}`;

function injectHeartbeatTaskCheck(agentId, workspacePath) {
  const heartbeatPath = path.join(workspacePath, 'HEARTBEAT.md');

  if (!fs.existsSync(heartbeatPath)) {
    fs.writeFileSync(heartbeatPath, HEARTBEAT_BLOCK_CONTENT + '\n', 'utf-8');
    console.log(`[scripts] Created HEARTBEAT.md for agent: ${agentId}`);
    return;
  }

  let content = fs.readFileSync(heartbeatPath, 'utf-8');
  const startIdx = content.indexOf(HEARTBEAT_BLOCK_START);
  const endIdx   = content.indexOf(HEARTBEAT_BLOCK_END);

  if (startIdx !== -1 && endIdx !== -1) {
    content = content.slice(0, startIdx) + HEARTBEAT_BLOCK_CONTENT + content.slice(endIdx + HEARTBEAT_BLOCK_END.length);
  } else {
    content = content.trimEnd() + '\n\n' + HEARTBEAT_BLOCK_CONTENT + '\n';
  }

  fs.writeFileSync(heartbeatPath, content, 'utf-8');
  console.log(`[scripts] Injected HEARTBEAT task check for agent: ${agentId}`);
}

/**
 * Write (or overwrite) ~/.openclaw/.aoc_env with current AOC_TOKEN + AOC_URL.
 * Called at server startup so the file is always up-to-date.
 * The update_task.sh script sources this file, so agents don't need env vars
 * injected into their shell by the gateway.
 */
function ensureAocEnvFile() {
  const token = process.env.DASHBOARD_TOKEN || '';
  const port  = process.env.PORT || '18800';
  const url   = `http://localhost:${port}`;

  const content = [
    '# AOC Dashboard connection config — auto-generated by AOC server at startup',
    `# Generated: ${new Date().toISOString()}`,
    `export AOC_TOKEN="${token}"`,
    `export AOC_URL="${url}"`,
    '',
  ].join('\n');

  try {
    if (!fs.existsSync(OPENCLAW_HOME_PATH)) fs.mkdirSync(OPENCLAW_HOME_PATH, { recursive: true });
    fs.writeFileSync(AOC_ENV_FILE, content, { mode: 0o600, encoding: 'utf-8' });
    console.log('[scripts] Updated ~/.openclaw/.aoc_env');
  } catch (err) {
    console.warn('[scripts] Failed to write .aoc_env:', err.message);
  }
}

// ── Shared ADLC Scripts ──────────────────────────────────────────────────────

// Scripts that appear in multiple ADLC templates and should also be installed
// to the global ~/.openclaw/scripts/ directory for human operator access.
const SHARED_ADLC_SCRIPT_NAMES = ['gdocs-export.sh', 'notify.sh', 'email-notif.sh'];

/**
 * Write shared ADLC scripts to ~/.openclaw/scripts/ if not already present.
 * Called during ADLC agent provisioning.
 * @param {Array<{filename: string, content: string}>} scriptTemplates
 */
function ensureSharedAdlcScripts(scriptTemplates) {
  ensureDir();
  const meta = readMeta(SCRIPTS_DIR);
  let changed = false;

  for (const { filename, content } of scriptTemplates) {
    if (!SHARED_ADLC_SCRIPT_NAMES.includes(filename)) continue;

    const targetPath = path.join(SCRIPTS_DIR, filename);
    if (fs.existsSync(targetPath)) continue; // already installed, skip

    fs.writeFileSync(targetPath, content, 'utf-8');
    const ext = path.extname(filename).toLowerCase();
    if (['.sh', '.bash', '.zsh', '.fish'].includes(ext)) {
      try { fs.chmodSync(targetPath, 0o755); } catch {}
    }

    const baseName = path.basename(filename, ext);
    if (!meta[filename]) {
      meta[filename] = { name: baseName, description: 'ADLC shared script' };
    }
    changed = true;
    console.log(`[scripts] Installed shared ADLC script: ${filename}`);
  }

  if (changed) writeMeta(SCRIPTS_DIR, meta);
}

module.exports = {
  // Shared scripts (~/.openclaw/scripts)
  listScripts, getScript, saveScript, deleteScript, renameScript, updateScriptMeta,
  // Agent workspace scripts ({workspace}/scripts)
  listAgentScripts, getAgentScript, saveAgentScript, deleteAgentScript, renameAgentScript, updateAgentScriptMeta,
  // Custom tool assignment via TOOLS.md
  listAgentCustomTools, toggleAgentCustomTool,
  // Bootstrap helpers
  ensureUpdateTaskScript,
  ensureAocEnvFile,
  ensureCheckTasksScript,
  injectHeartbeatTaskCheck,
  // ADLC shared scripts installer
  ensureSharedAdlcScripts,
  SCRIPTS_DIR, ALLOWED_EXT,
};
