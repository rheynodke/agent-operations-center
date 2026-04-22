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
[ -f "$PWD/.aoc_agent_env" ] && source "$PWD/.aoc_agent_env"
[ -f "\${OPENCLAW_WORKSPACE:-.}/.aoc_agent_env" ] && source "\${OPENCLAW_WORKSPACE:-.}/.aoc_agent_env"

[ -z "\${AOC_AGENT_ID:-}" ] && exit 0   # no agent id configured, skip silently

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

  // Write per-agent .aoc_agent_env in each agent's workspace
  try {
    const cfg = readJsonSafe(path.join(OPENCLAW_HOME, 'openclaw.json')) || {};
    const agents = cfg.agents?.list || [];
    for (const agent of agents) {
      const workspace = agent.workspace || OPENCLAW_WORKSPACE;
      const agentEnvPath = path.join(workspace, '.aoc_agent_env');
      const agentContent = [
        `# AOC agent identity — auto-generated`,
        `export AOC_AGENT_ID="${agent.id}"`,
        '',
      ].join('\n');
      try {
        fs.writeFileSync(agentEnvPath, agentContent, { mode: 0o600, encoding: 'utf-8' });
      } catch {}
    }
    console.log(`[scripts] Updated .aoc_agent_env for ${agents.length} agents`);
  } catch (err) {
    console.warn('[scripts] Failed to write agent env files:', err.message);
  }
}

// ── check_connections.sh ────────────────────────────────────────────────────

const CHECK_CONNECTIONS_SCRIPT_NAME = 'check_connections.sh';
const CHECK_CONNECTIONS_SCRIPT_CONTENT = `#!/usr/bin/env bash
# check_connections — List available connections (NO credentials in output)
# Use aoc-connect.sh to actually USE a connection with credentials.

source "\${OPENCLAW_HOME:-$HOME/.openclaw}/.aoc_env"
# Source agent identity (written to workspace by AOC server)
[ -f "$PWD/.aoc_agent_env" ] && source "$PWD/.aoc_agent_env"
[ -f "\${OPENCLAW_WORKSPACE:-.}/.aoc_agent_env" ] && source "\${OPENCLAW_WORKSPACE:-.}/.aoc_agent_env"

[ -z "$AOC_TOKEN" ] && { echo "ERROR: AOC_TOKEN not configured"; exit 1; }
[ -z "\${AOC_AGENT_ID:-}" ] && { echo "ERROR: AOC_AGENT_ID not configured — run from agent workspace"; exit 1; }

export FILTER_TYPE="\${1:-}"  # optional: bigquery, postgres, ssh, website

export TMPFILE=$(mktemp /tmp/aoc-check-conn-XXXXXX.json)
trap "rm -f $TMPFILE" EXIT

_CONN_URL="$AOC_URL/api/agent/connections?agentId=$AOC_AGENT_ID"
HTTP_CODE=$(curl -s -o "$TMPFILE" -w "%{http_code}" "$_CONN_URL" \\
  -H "Authorization: Bearer $AOC_TOKEN" 2>/dev/null) || true

if [ "$HTTP_CODE" != "200" ]; then
  echo "No connections available or AOC unreachable (HTTP $HTTP_CODE)."
  exit 0
fi

python3 << 'PYEOF'
import json, sys, os

tmpfile = os.environ.get('TMPFILE', '')
if not tmpfile:
    print('ERROR: TMPFILE not set')
    sys.exit(1)

with open(tmpfile) as f:
    data = json.load(f)

conns = data.get('connections', [])
filter_type = os.environ.get('FILTER_TYPE', '')
if filter_type:
    conns = [c for c in conns if c.get('type') == filter_type]
if not conns:
    msg = 'No connections found.'
    if filter_type:
        msg += f' (filter: {filter_type})'
    print(msg)
    sys.exit(0)
SAFE_KEYS = {'name','type','hint','projectId','datasets','host','port','database','username',
             'url','loginUrl','authType','user','description','sslMode',
             'githubMode','repo','branch','localPath','repoOwner','repoName',
             'linkedEmail','preset','authState','scopes'}
for c in conns:
    t = c.get('type', '?').upper()
    name = c.get('name', '?')
    github_mode = c.get('githubMode', 'remote') if c.get('type') == 'github' else None
    mode_tag = f' [{github_mode}]' if github_mode else ''
    print(f'[{t}{mode_tag}] {name}')
    for k, v in c.items():
        if k not in SAFE_KEYS or k in ('name', 'type', 'hint', 'githubMode'):
            continue
        if v is None or v == '':
            continue
        print(f'  {k}: {v}')
    hint = c.get('hint')
    if hint:
        print(f'  hint: {hint}')
    if c.get('type') == 'google_workspace':
        print(f'  >>> To use: gws-call.sh "{name}" <service> <method> \\'<json-body>\\'')
        print(f'  >>> Services: drive, docs, sheets, slides, gmail, calendar')
    elif c.get('type') == 'github' and github_mode == 'local':
        local_path = c.get('localPath', '')
        branch = c.get('branch', 'main')
        print(f'  >>> Direct git: git -C "{local_path}" <command>')
        print(f'  >>> Or wrapper: aoc-connect.sh "{name}" <action> [args]')
        print(f'  >>> Actions: info, log [n], status, branch, files [path], diff [target]')
    else:
        print(f'  >>> To use: aoc-connect.sh "{name}" <action> [args]')
    print()
PYEOF
`;

function ensureCheckConnectionsScript() {
  ensureDir();
  const scriptPath = path.join(SCRIPTS_DIR, CHECK_CONNECTIONS_SCRIPT_NAME);

  // Always overwrite to keep script up to date
  fs.writeFileSync(scriptPath, CHECK_CONNECTIONS_SCRIPT_CONTENT, { mode: 0o755, encoding: 'utf-8' });

  const meta = readMeta(SCRIPTS_DIR);
  meta[CHECK_CONNECTIONS_SCRIPT_NAME] = {
    name: 'check_connections',
    emoji: '🔌',
    description: 'List available third-party connections (BigQuery, PostgreSQL, SSH, Website, GitHub, Odoo) assigned to this agent. Usage: check_connections.sh [type]',
    execHint: `${SCRIPTS_DIR}/check_connections.sh [bigquery|postgres|ssh|website|github|odoocli]`,
  };
  writeMeta(SCRIPTS_DIR, meta);
  console.log('[scripts] Ensured shared check_connections.sh script');
}

// ── gws-call.sh ─────────────────────────────────────────────────────────────

const GWS_CALL_SCRIPT_NAME = 'gws-call.sh';
const GWS_CALL_SCRIPT_CONTENT = `#!/usr/bin/env bash
# gws-call.sh — Google Workspace API wrapper backed by AOC connections.
#
# Usage:
#   gws-call.sh <connection-id> <service> <method> [json-body]
#   gws-call.sh <connection-id> --raw <HTTP_METHOD> <URL> [json-body]
#
# Services: drive, docs, sheets, slides, gmail, calendar
# Methods:  <resource>.list | .get | .create | .update | .patch | .delete | .batchUpdate
#           spreadsheets.values.get | .append | .update (sheets only)

set -euo pipefail

source "\${OPENCLAW_HOME:-$HOME/.openclaw}/.aoc_env"
[ -f "$PWD/.aoc_agent_env" ] && source "$PWD/.aoc_agent_env"
[ -f "\${OPENCLAW_WORKSPACE:-.}/.aoc_agent_env" ] && source "\${OPENCLAW_WORKSPACE:-.}/.aoc_agent_env"

[ -z "\${AOC_TOKEN:-}" ] && { echo "ERROR: AOC_TOKEN not configured" >&2; exit 1; }
[ $# -lt 2 ] && { echo "Usage: gws-call.sh <connection-id> <service> <method> [json-body]" >&2; exit 1; }

CONN_ID="$1"; shift

TMPTOK=$(mktemp /tmp/aoc-gws-tok-XXXXXX.json); trap 'rm -f "$TMPTOK"' EXIT
HTTP_CODE=$(curl -s -o "$TMPTOK" -w "%{http_code}" \\
  -H "Authorization: Bearer $AOC_TOKEN" \\
  -H "X-AOC-Agent-Id: \${AOC_AGENT_ID:-}" \\
  "$AOC_URL/api/connections/$CONN_ID/google-access-token")

if [ "$HTTP_CODE" != "200" ]; then
  echo "ERROR: failed to obtain token (HTTP $HTTP_CODE)" >&2
  cat "$TMPTOK" >&2; echo >&2
  exit 2
fi

ACCESS_TOKEN=$(python3 -c "import json,sys; print(json.load(open('$TMPTOK'))['accessToken'])")

if [ "$1" = "--raw" ]; then
  shift
  METHOD="$1"; URL="$2"; BODY="\${3:-}"
  if [ -n "$BODY" ]; then
    curl -sf -X "$METHOD" -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" --data-raw "$BODY" "$URL"
  else
    curl -sf -X "$METHOD" -H "Authorization: Bearer $ACCESS_TOKEN" "$URL"
  fi
  exit 0
fi

SERVICE="$1"; shift
METHOD_STR="$1"; shift
BODY="\${1:-}"

case "$SERVICE" in
  drive)     BASE="https://www.googleapis.com/drive/v3"     ; ID_FIELD="fileId"        ;;
  docs)      BASE="https://docs.googleapis.com/v1"          ; ID_FIELD="documentId"    ;;
  sheets)    BASE="https://sheets.googleapis.com/v4"        ; ID_FIELD="spreadsheetId" ;;
  slides)    BASE="https://slides.googleapis.com/v1"        ; ID_FIELD="presentationId";;
  gmail)     BASE="https://gmail.googleapis.com/gmail/v1/users/me"; ID_FIELD="id"      ;;
  calendar)  BASE="https://www.googleapis.com/calendar/v3"  ; ID_FIELD="eventId"       ;;
  *) echo "ERROR: unsupported service: $SERVICE" >&2; exit 1 ;;
esac

export SERVICE METHOD_STR BODY BASE ID_FIELD ACCESS_TOKEN

python3 << 'PYEOF'
import json, os, subprocess, sys, urllib.parse

service   = os.environ["SERVICE"]
method    = os.environ["METHOD_STR"]
body_raw  = os.environ.get("BODY", "")
base      = os.environ["BASE"]
id_field  = os.environ["ID_FIELD"]
token     = os.environ["ACCESS_TOKEN"]

body = None
if body_raw.strip():
    body = json.loads(body_raw)

parts = method.split(".")
if len(parts) < 2:
    sys.stderr.write(f"ERROR: method must be <resource>.<action>: {method}\\n"); sys.exit(1)

if service == "sheets" and len(parts) == 3 and parts[1] == "values":
    resource = parts[0]
    action   = "values." + parts[2]
else:
    resource = parts[0]
    action   = ".".join(parts[1:])

def req_id():
    if not body or id_field not in body:
        sys.stderr.write(f"ERROR: body must contain '{id_field}' for this action\\n"); sys.exit(1)
    v = body.pop(id_field)
    return v

path = None; http = None
if action == "list":                path, http = f"/{resource}", "GET"
elif action == "get":               path, http = f"/{resource}/{req_id()}", "GET"
elif action == "create":            path, http = f"/{resource}", "POST"
elif action == "update":            path, http = f"/{resource}/{req_id()}", "PUT"
elif action == "patch":             path, http = f"/{resource}/{req_id()}", "PATCH"
elif action == "delete":            path, http = f"/{resource}/{req_id()}", "DELETE"
elif action == "batchUpdate":       path, http = f"/{resource}/{req_id()}:batchUpdate", "POST"
elif action == "values.get":
    sid = req_id()
    rng = body.pop("range", "")
    path, http = f"/spreadsheets/{sid}/values/{urllib.parse.quote(rng)}", "GET"
elif action == "values.append":
    sid = req_id()
    rng = body.pop("range", "")
    vio = body.pop("valueInputOption", "USER_ENTERED")
    path, http = f"/spreadsheets/{sid}/values/{urllib.parse.quote(rng)}:append?valueInputOption={vio}", "POST"
elif action == "values.update":
    sid = req_id()
    rng = body.pop("range", "")
    vio = body.pop("valueInputOption", "USER_ENTERED")
    path, http = f"/spreadsheets/{sid}/values/{urllib.parse.quote(rng)}?valueInputOption={vio}", "PUT"
else:
    sys.stderr.write(f"ERROR: unsupported action: {action}. Use --raw for advanced endpoints.\\n"); sys.exit(1)

url = base + path
args = ["curl", "-sf", "-X", http, "-H", f"Authorization: Bearer {token}"]
if http in ("POST", "PUT", "PATCH") or body:
    args += ["-H", "Content-Type: application/json", "--data-raw", json.dumps(body or {})]
args.append(url)

r = subprocess.run(args)
sys.exit(r.returncode)
PYEOF
`;

function ensureGwsCallScript() {
  ensureDir();
  const scriptPath = path.join(SCRIPTS_DIR, GWS_CALL_SCRIPT_NAME);
  fs.writeFileSync(scriptPath, GWS_CALL_SCRIPT_CONTENT, { mode: 0o755, encoding: 'utf-8' });
  const meta = readMeta(SCRIPTS_DIR);
  meta[GWS_CALL_SCRIPT_NAME] = {
    name: 'gws-call',
    emoji: '📄',
    description: 'Call Google Workspace APIs via an assigned google_workspace connection. Usage: gws-call.sh <connection-id> <service> <method> [json-body]',
    execHint: `${SCRIPTS_DIR}/gws-call.sh <connection-id> <service> <method> [json-body]`,
  };
  writeMeta(SCRIPTS_DIR, meta);
  console.log('[scripts] Ensured shared gws-call.sh script');
}

// ── fetch_attachment.sh — Download task attachments for agent consumption ──

const FETCH_ATTACHMENT_SCRIPT_NAME = 'fetch_attachment.sh';
const FETCH_ATTACHMENT_SCRIPT_CONTENT = `#!/usr/bin/env bash
# fetch_attachment — Download a task attachment (by URL) for agent use.
#
# Usage:
#   fetch_attachment.sh <url> [output_dir]
#
# - If <url> is an AOC-served path (/api/attachments/...), the AOC_TOKEN is
#   attached automatically as a Bearer header.
# - External URLs (e.g. from a synced Google Sheet) are fetched as-is.
# - Output file is saved under <output_dir> (default: ./inputs/) with a
#   sanitized filename derived from the URL basename.
# - For .zip files, the archive is also extracted into a sibling directory.
# - For .docx files, best-effort plain-text extraction is written next to it.
#
# Prints the saved absolute path(s) on stdout. Exit 0 on success.

set -euo pipefail

URL="\${1:?Usage: fetch_attachment.sh <url> [output_dir]}"
OUTDIR="\${2:-./inputs}"
mkdir -p "$OUTDIR"

# Resolve AOC base + token if present
AOC_URL="\${AOC_URL:-http://localhost:\${PORT:-18800}}"
AOC_TOKEN="\${AOC_TOKEN:-\${DASHBOARD_TOKEN:-}}"

# Build filename from URL path basename, stripping query string
BASENAME="\$(basename "\${URL%%\\?*}")"
if [ -z "\$BASENAME" ] || [ "\$BASENAME" = "/" ]; then
  BASENAME="attachment_\$(date +%s)"
fi
# Sanitize
BASENAME="\$(echo "\$BASENAME" | tr -c 'A-Za-z0-9._-' '_' | cut -c1-200)"
DEST="\$OUTDIR/\$BASENAME"

# Decide auth
CURL_ARGS=(-sSL --fail --max-time 120 -o "\$DEST")
case "\$URL" in
  /api/attachments/*|"\$AOC_URL"/api/attachments/*)
    FULL_URL="\$URL"
    case "\$URL" in /api/*) FULL_URL="\$AOC_URL\$URL" ;; esac
    if [ -n "\$AOC_TOKEN" ]; then
      CURL_ARGS+=(-H "Authorization: Bearer \$AOC_TOKEN")
    fi
    curl "\${CURL_ARGS[@]}" "\$FULL_URL"
    ;;
  *)
    curl "\${CURL_ARGS[@]}" "\$URL"
    ;;
esac

echo "\$DEST"

# Post-processing for common formats
LOWER="\$(echo "\$BASENAME" | tr '[:upper:]' '[:lower:]')"
case "\$LOWER" in
  *.zip)
    EXTRACT_DIR="\${DEST%.zip}_extracted"
    if command -v unzip >/dev/null 2>&1; then
      mkdir -p "\$EXTRACT_DIR"
      unzip -oq "\$DEST" -d "\$EXTRACT_DIR" && echo "\$EXTRACT_DIR"
    fi
    ;;
  *.docx)
    TXT="\${DEST%.docx}.txt"
    if command -v unzip >/dev/null 2>&1; then
      # docx is a zip of XML — extract word/document.xml and strip tags
      unzip -p "\$DEST" word/document.xml 2>/dev/null \\
        | sed -e 's/<[^>]*>/ /g' -e 's/  */ /g' \\
        > "\$TXT" 2>/dev/null || true
      [ -s "\$TXT" ] && echo "\$TXT"
    fi
    ;;
esac
`;

function ensureFetchAttachmentScript() {
  ensureDir();
  const scriptPath = path.join(SCRIPTS_DIR, FETCH_ATTACHMENT_SCRIPT_NAME);
  fs.writeFileSync(scriptPath, FETCH_ATTACHMENT_SCRIPT_CONTENT, { mode: 0o755, encoding: 'utf-8' });
  const meta = readMeta(SCRIPTS_DIR);
  meta[FETCH_ATTACHMENT_SCRIPT_NAME] = {
    name: 'fetch_attachment',
    emoji: '📎',
    description: 'Download a task attachment (AOC-served or external URL) into ./inputs/. Auto-extracts .zip and converts .docx to plain text. Usage: fetch_attachment.sh <url> [output_dir]',
    execHint: `${SCRIPTS_DIR}/fetch_attachment.sh <url> [output_dir]`,
  };
  writeMeta(SCRIPTS_DIR, meta);
  console.log('[scripts] Ensured shared fetch_attachment.sh script');
}

// ── save_output.sh — Register a deliverable for a task ──────────────────────

const SAVE_OUTPUT_SCRIPT_NAME = 'save_output.sh';
const SAVE_OUTPUT_SCRIPT_CONTENT = `#!/usr/bin/env bash
# save_output — Copy or stream a file into the task's output folder.
#
# Usage:
#   save_output.sh <task_id> <source_path|-> <target_filename> [--description "..."]
#
#   <source_path>   Path to an existing file, OR '-' to read stdin.
#   <target_filename>  Filename to write under the task output folder.
#                      (Must be a plain basename — no path separators.)
#   --description TEXT Optional human-readable note stored in MANIFEST.json.
#
# Outputs are written to:
#   \${OPENCLAW_WORKSPACE}/outputs/<task_id>/<target_filename>
# (or the agent's configured workspace if set via .aoc_agent_env)
#
# Prints the absolute path of the saved file on stdout.

set -euo pipefail

TASK_ID="\${1:?Usage: save_output.sh <task_id> <source|-> <target_filename> [--description \\"...\\"]}"
SOURCE="\${2:?source path (or '-' for stdin) required}"
TARGET="\${3:?target filename required}"
shift 3 || true

DESCRIPTION=""
while [ $# -gt 0 ]; do
  case "$1" in
    --description) DESCRIPTION="\${2:-}"; shift 2 ;;
    *) shift ;;
  esac
done

# Reject filename path components — security guard
case "$TARGET" in
  */*|\\\\*|..*|.*) echo "save_output: target filename must be a plain basename (no path separators, no leading dot)" >&2; exit 2 ;;
esac

# Sanitize task id (alphanumerics, underscore, hyphen only).
# Uses printf (no trailing newline) + tr so the id isn't suffixed with '_'.
SAFE_TASK="$(printf '%s' "$TASK_ID" | tr -c 'A-Za-z0-9_-' '_')"
if [ -z "$SAFE_TASK" ] || [ "$SAFE_TASK" = "_" ]; then
  echo "save_output: invalid task id" >&2; exit 2
fi

# Resolve workspace (prefer env from .aoc_agent_env, fallback to OPENCLAW_WORKSPACE)
[ -f "$PWD/.aoc_agent_env" ] && source "$PWD/.aoc_agent_env" 2>/dev/null || true
[ -f "\${OPENCLAW_WORKSPACE:-.}/.aoc_agent_env" ] && source "\${OPENCLAW_WORKSPACE:-.}/.aoc_agent_env" 2>/dev/null || true
WORKSPACE="\${AOC_WORKSPACE:-\${OPENCLAW_WORKSPACE:-$PWD}}"

OUT_DIR="$WORKSPACE/outputs/$SAFE_TASK"
mkdir -p "$OUT_DIR"
DEST="$OUT_DIR/$TARGET"

# Copy or stream content
if [ "$SOURCE" = "-" ]; then
  cat > "$DEST"
else
  if [ ! -f "$SOURCE" ]; then
    echo "save_output: source file not found: $SOURCE" >&2; exit 2
  fi
  cp -f "$SOURCE" "$DEST"
fi

# Update MANIFEST.json (append/update entry for this filename)
MANIFEST="$OUT_DIR/MANIFEST.json"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
SIZE="$(stat -f %z "$DEST" 2>/dev/null || stat -c %s "$DEST" 2>/dev/null || echo 0)"
if command -v python3 >/dev/null 2>&1; then
  python3 - "$MANIFEST" "$TARGET" "$DESCRIPTION" "$NOW" "$SIZE" <<'PY' || true
import json, os, sys
path, fname, desc, now, size = sys.argv[1:6]
data = {"outputs": []}
if os.path.exists(path):
    try:
        with open(path) as f: data = json.load(f)
        if not isinstance(data, dict) or not isinstance(data.get("outputs"), list):
            data = {"outputs": []}
    except Exception:
        data = {"outputs": []}
outs = [o for o in data["outputs"] if o.get("filename") != fname]
outs.append({"filename": fname, "description": desc or None, "size": int(size or 0), "updatedAt": now})
data["outputs"] = outs
with open(path, "w") as f: json.dump(data, f, indent=2)
PY
fi

echo "$DEST"
`;

function ensureSaveOutputScript() {
  ensureDir();
  const scriptPath = path.join(SCRIPTS_DIR, SAVE_OUTPUT_SCRIPT_NAME);
  fs.writeFileSync(scriptPath, SAVE_OUTPUT_SCRIPT_CONTENT, { mode: 0o755, encoding: 'utf-8' });
  const meta = readMeta(SCRIPTS_DIR);
  meta[SAVE_OUTPUT_SCRIPT_NAME] = {
    name: 'save_output',
    emoji: '📤',
    description: 'Save an agent deliverable into the task output folder ({workspace}/outputs/{taskId}/). Updates MANIFEST.json. Usage: save_output.sh <task_id> <source|-> <filename> [--description "..."]',
    execHint: `${SCRIPTS_DIR}/save_output.sh <task_id> <source|-> <filename> [--description "..."]`,
  };
  writeMeta(SCRIPTS_DIR, meta);
  console.log('[scripts] Ensured shared save_output.sh script');
}

// ── post_comment.sh — Post a message to a task's comment thread ─────────────

const POST_COMMENT_SCRIPT_NAME = 'post_comment.sh';
const POST_COMMENT_SCRIPT_CONTENT = `#!/usr/bin/env bash
# post_comment — Post a free-form message to a task's discussion thread.
# Use this for in-flight progress updates, questions, or milestone reports
# without changing the task status (which would trigger a re-dispatch).
#
# Usage:
#   post_comment.sh <task_id> "message text"
#   echo "message text" | post_comment.sh <task_id> -
#
# Env required:
#   AOC_URL        e.g. http://localhost:18800 (defaults so)
#   AOC_TOKEN      dashboard token (set by .aoc_agent_env)
#   AOC_AGENT_ID   this agent's id (set by .aoc_agent_env)
#
# Prints the created comment id on stdout. Exit 0 on success, non-zero otherwise.

set -euo pipefail

TASK_ID="\${1:?Usage: post_comment.sh <task_id> <message|->}"
BODY_ARG="\${2:?message text (or '-' to read stdin) required}"

source "\${OPENCLAW_HOME:-$HOME/.openclaw}/.aoc_env" 2>/dev/null || true
[ -f "$PWD/.aoc_agent_env" ] && source "$PWD/.aoc_agent_env" 2>/dev/null || true
[ -f "\${OPENCLAW_WORKSPACE:-.}/.aoc_agent_env" ] && source "\${OPENCLAW_WORKSPACE:-.}/.aoc_agent_env" 2>/dev/null || true

AOC_URL="\${AOC_URL:-http://localhost:\${PORT:-18800}}"
if [ -z "\${AOC_TOKEN:-}" ]; then echo "post_comment: AOC_TOKEN not set" >&2; exit 2; fi
if [ -z "\${AOC_AGENT_ID:-}" ]; then echo "post_comment: AOC_AGENT_ID not set" >&2; exit 2; fi

# Resolve body — support stdin when arg is '-'
if [ "$BODY_ARG" = "-" ]; then
  BODY="$(cat)"
else
  BODY="$BODY_ARG"
fi
if [ -z "\${BODY// }" ]; then echo "post_comment: empty body" >&2; exit 2; fi

# JSON-escape body using python3 (handles quotes/newlines/unicode safely)
# Export BODY first so the Python subshell inherits it.
export BODY
PAYLOAD="$(python3 - <<PY
import json, os
print(json.dumps({"body": os.environ["BODY"], "agentId": os.environ["AOC_AGENT_ID"]}))
PY
)"

RES="$(curl -sf -X POST "$AOC_URL/api/tasks/$TASK_ID/comments" \\
  -H "Authorization: Bearer $AOC_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d "$PAYLOAD")" || { echo "post_comment: request failed" >&2; exit 1; }

echo "$RES" | python3 -c "import json,sys; print(json.load(sys.stdin)['comment']['id'])"
`;

function ensurePostCommentScript() {
  ensureDir();
  const scriptPath = path.join(SCRIPTS_DIR, POST_COMMENT_SCRIPT_NAME);
  fs.writeFileSync(scriptPath, POST_COMMENT_SCRIPT_CONTENT, { mode: 0o755, encoding: 'utf-8' });
  const meta = readMeta(SCRIPTS_DIR);
  meta[POST_COMMENT_SCRIPT_NAME] = {
    name: 'post_comment',
    emoji: '💬',
    description: 'Post a free-form comment to a task thread without changing status. Usage: post_comment.sh <task_id> <message|->',
    execHint: `${SCRIPTS_DIR}/post_comment.sh <task_id> <message|->`,
  };
  writeMeta(SCRIPTS_DIR, meta);
  console.log('[scripts] Ensured shared post_comment.sh script');
}

// ── aoc-connect.sh — Generic connection wrapper ─────────────────────────────

const AOC_CONNECT_SCRIPT_NAME = 'aoc-connect.sh';
const AOC_CONNECT_SCRIPT_CONTENT = `#!/usr/bin/env bash
# aoc-connect — Generic connection wrapper for AI agents
# Credentials never appear in stdout — only results.
#
# Usage:
#   aoc-connect.sh <connection-name> <action> [args...]
#
# Actions per type:
#   bigquery  query  "SELECT ..."
#   postgres  query  "SELECT ..."
#   ssh       exec   "command"
#   website   browse [path]      — open browser, prepare credentials for agent login
#   website   api    [path]      — curl with auth headers

set -euo pipefail

source "\${OPENCLAW_HOME:-$HOME/.openclaw}/.aoc_env"
# Source agent identity (written to workspace by AOC server)
[ -f "$PWD/.aoc_agent_env" ] && source "$PWD/.aoc_agent_env"
[ -f "\${OPENCLAW_WORKSPACE:-.}/.aoc_agent_env" ] && source "\${OPENCLAW_WORKSPACE:-.}/.aoc_agent_env"

CONN_NAME="\${1:?Usage: aoc-connect.sh <connection-name> <action> [args...]}"
ACTION="\${2:?Usage: aoc-connect.sh <connection-name> <action> [args...]}"
shift 2
ARGS="$*"
ARGS_ARRAY=()
[ $# -gt 0 ] && ARGS_ARRAY=("$@")  # preserve quoting for passthrough commands

[ -z "$AOC_TOKEN" ] && { echo "ERROR: AOC_TOKEN not configured"; exit 1; }
[ -z "\${AOC_AGENT_ID:-}" ] && { echo "ERROR: AOC_AGENT_ID not configured"; exit 1; }

# ── Temp file cleanup trap ─────────────────────────────────────────────────
TMPFILES=()
cleanup() { [ \${#TMPFILES[@]} -gt 0 ] && for f in "\${TMPFILES[@]}"; do rm -rf "$f" 2>/dev/null; done; true; }
trap cleanup EXIT

mktmp() {
  local f=$(mktemp /tmp/aoc-conn-XXXXXXXX)
  TMPFILES+=("$f")
  echo "$f"
}

# ── Fetch agent-assigned connections to a temp file ────────────────────────
_CONNS_FILE=$(mktmp ".json")
_CONN_URL="$AOC_URL/api/agent/connections?agentId=$AOC_AGENT_ID"
HTTP_CODE=$(curl -s -o "$_CONNS_FILE" -w "%{http_code}" "$_CONN_URL" \\
  -H "Authorization: Bearer $AOC_TOKEN" 2>/dev/null) || true

if [ "$HTTP_CODE" != "200" ]; then
  echo "ERROR: Cannot reach AOC Dashboard at $AOC_URL (HTTP $HTTP_CODE)"
  exit 1
fi

# ── Extract matching connection + write type-specific temp files via single python call ──
export _AOC_CONN_NAME="$CONN_NAME"
export _AOC_ACTION="$ACTION"
export _AOC_CONNS_FILE="$_CONNS_FILE"
export _AOC_SA_FILE=$(mktmp ".sa.json")
export _AOC_KEY_FILE=$(mktmp ".key")
export _AOC_CRED_ENV=$(mktmp ".env")

eval "$(python3 << 'PYEOF'
import json, os, sys, shlex, base64

conn_name = os.environ.get('_AOC_CONN_NAME', '')
action = os.environ.get('_AOC_ACTION', '')
conns_file = os.environ.get('_AOC_CONNS_FILE', '')
sa_file = os.environ.get('_AOC_SA_FILE', '')
key_file = os.environ.get('_AOC_KEY_FILE', '')
cred_env = os.environ.get('_AOC_CRED_ENV', '')

with open(conns_file) as f:
    data = json.load(f)

conn = None
available = []
for c in data.get('connections', []):
    available.append(c.get('name', '?'))
    if c.get('name') == conn_name:
        conn = c

if not conn:
    avail_str = ', '.join(available) if available else '(none)'
    print(f'echo "ERROR: Connection not found: {shlex.quote(conn_name)}"')
    print(f'echo "Available: {avail_str}"')
    print('exit 1')
    sys.exit(0)

def emit(k, v):
    print(f'_C_{k}={shlex.quote(str(v) if v is not None else "")}')

emit('TYPE', conn.get('type', ''))
emit('PROJECT_ID', conn.get('projectId', ''))
emit('HOST', conn.get('host', 'localhost'))
emit('PORT', conn.get('port', 5432))
emit('DATABASE', conn.get('database', 'postgres'))
emit('USERNAME', conn.get('username', ''))
emit('PASSWORD', conn.get('password', ''))
emit('SSH_HOST', conn.get('host', ''))
emit('SSH_PORT', conn.get('port', 22))
emit('SSH_USER', conn.get('user', 'root'))
emit('URL', conn.get('url', ''))
emit('LOGIN_URL', conn.get('loginUrl', ''))
emit('AUTH_TYPE', conn.get('authType', 'none'))
# github
emit('GITHUB_MODE', conn.get('githubMode', 'remote'))
emit('REPO_OWNER', conn.get('repoOwner', ''))
emit('REPO_NAME', conn.get('repoName', ''))
emit('BRANCH', conn.get('branch', 'main'))
emit('LOCAL_PATH', conn.get('localPath', ''))
emit('TOKEN', conn.get('token', ''))
# odoocli
emit('ODOO_URL', conn.get('odooUrl', ''))
emit('ODOO_DB', conn.get('odooDb', ''))
emit('ODOO_USERNAME', conn.get('odooUsername', ''))
emit('ODOO_AUTH_TYPE', conn.get('odooAuthType', 'password'))
emit('ODOO_CREDENTIAL', conn.get('credential', ''))

# Write service account JSON directly to file (not through bash variable)
sa_json = conn.get('serviceAccountJson', '')
if sa_json and sa_file:
    with open(sa_file, 'w') as f:
        f.write(sa_json)

# Write SSH private key directly to file
pk = conn.get('privateKey', '')
if pk and key_file:
    with open(key_file, 'w') as f:
        f.write(pk)

# Write web credentials to env file
if conn.get('type') == 'website' and cred_env:
    u = conn.get('username', '')
    p = conn.get('password', '')
    at = conn.get('authType', 'none')
    base_url = conn.get('url', '')
    login_url = conn.get('loginUrl', '')
    with open(cred_env, 'w') as f:
        f.write('AOC_WEB_USERNAME=' + shlex.quote(u) + chr(10))
        f.write('AOC_WEB_PASSWORD=' + shlex.quote(p) + chr(10))
        f.write('AOC_WEB_AUTH_TYPE=' + shlex.quote(at) + chr(10))
        f.write('AOC_WEB_BASE_URL=' + shlex.quote(base_url) + chr(10))
        f.write('AOC_WEB_LOGIN_URL=' + shlex.quote(login_url) + chr(10))

# Build auth header for API mode
if conn.get('type') == 'website' and action == 'api':
    at = conn.get('authType', 'none')
    u = conn.get('username', '')
    p = conn.get('password', '')
    hdr = ''
    if at == 'basic':
        cred = base64.b64encode((u + ':' + p).encode()).decode()
        hdr = 'Authorization: Basic ' + cred
    elif at == 'token':
        hdr = 'Authorization: Bearer ' + p
    elif at == 'api_key':
        hdr = (u or 'X-API-Key') + ': ' + p
    elif at == 'cookie':
        hdr = 'Cookie: ' + (u or 'session') + '=' + p
    emit('AUTH_HEADER', hdr)
PYEOF
)"

TYPE="$_C_TYPE"

# ── BigQuery ───────────────────────────────────────────────────────────────
if [ "$TYPE" = "bigquery" ] && [ "$ACTION" = "query" ]; then
  # Isolate gcloud config per execution to avoid credential race conditions
  export CLOUDSDK_CONFIG=$(mktemp -d /tmp/aoc-gcloud-XXXXXXXX)
  TMPFILES+=("$CLOUDSDK_CONFIG")
  export GOOGLE_APPLICATION_CREDENTIALS="$_AOC_SA_FILE"
  GCLOUD_BIN="\${GCLOUD_BIN:-gcloud}"
  BQ_BIN="\${BQ_BIN:-bq}"

  $GCLOUD_BIN auth activate-service-account --key-file="$_AOC_SA_FILE" >/dev/null 2>&1 || true

  # Query and pipe directly to markdown converter (avoid bash variable for large output)
  _BQ_OUT=$(mktmp ".csv")
  $BQ_BIN query --project_id="$_C_PROJECT_ID" --use_legacy_sql=false --format=csv --max_rows=999999 "$ARGS" > "$_BQ_OUT" 2>&1
  BQ_EXIT=$?
  if [ $BQ_EXIT -ne 0 ]; then
    echo "ERROR: BigQuery query failed"
    cat "$_BQ_OUT"
    exit 1
  fi

  # Convert CSV to markdown table
  export _AOC_CSV_FILE="$_BQ_OUT"
  python3 << 'PYEOF'
import sys, csv, os
csvfile = os.environ.get('_AOC_CSV_FILE', '')
with open(csvfile) as f:
    text = f.read().strip()
if not text:
    print("(empty result)")
    sys.exit(0)
import io
reader = csv.reader(io.StringIO(text))
rows = list(reader)
if not rows:
    print("(empty result)")
    sys.exit(0)
header = rows[0]
data = rows[1:]
print("| " + " | ".join(header) + " |")
print("| " + " | ".join(["---"] * len(header)) + " |")
for row in data:
    while len(row) < len(header):
        row.append("")
    print("| " + " | ".join(r.replace("|", "\\\\|") for r in row) + " |")
print()
print(f"_{len(data)} rows returned_")
PYEOF
  exit 0
fi

# ── PostgreSQL ─────────────────────────────────────────────────────────────
if [ "$TYPE" = "postgres" ] && [ "$ACTION" = "query" ]; then
  export PGHOST="$_C_HOST"
  export PGPORT="$_C_PORT"
  export PGDATABASE="$_C_DATABASE"
  export PGUSER="$_C_USERNAME"
  export PGPASSWORD="$_C_PASSWORD"

  # Query and pipe directly to markdown converter
  _PG_OUT=$(mktmp ".csv")
  psql --csv -c "$ARGS" > "$_PG_OUT" 2>&1
  PG_EXIT=$?
  if [ $PG_EXIT -ne 0 ]; then
    echo "ERROR: PostgreSQL query failed"
    cat "$_PG_OUT"
    exit 1
  fi

  export _AOC_CSV_FILE="$_PG_OUT"
  python3 << 'PYEOF'
import sys, csv, os, io
csvfile = os.environ.get('_AOC_CSV_FILE', '')
with open(csvfile) as f:
    text = f.read().strip()
if not text:
    print("(empty result)")
    sys.exit(0)
reader = csv.reader(io.StringIO(text))
rows = list(reader)
if not rows:
    print("(empty result)")
    sys.exit(0)
header = rows[0]
data = rows[1:]
print("| " + " | ".join(header) + " |")
print("| " + " | ".join(["---"] * len(header)) + " |")
for row in data:
    while len(row) < len(header):
        row.append("")
    print("| " + " | ".join(r.replace("|", "\\\\|") for r in row) + " |")
print()
print(f"_{len(data)} rows returned_")
PYEOF
  exit 0
fi

# ── SSH ────────────────────────────────────────────────────────────────────
if [ "$TYPE" = "ssh" ] && [ "$ACTION" = "exec" ]; then
  chmod 600 "$_AOC_KEY_FILE"
  ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 -i "$_AOC_KEY_FILE" -p "$_C_SSH_PORT" "$_C_SSH_USER@$_C_SSH_HOST" "$ARGS"
  exit 0
fi

# ── Website: browse ────────────────────────────────────────────────────────
if [ "$TYPE" = "website" ] && [ "$ACTION" = "browse" ]; then
  TARGET_PATH="\${ARGS:-}"
  chmod 600 "$_AOC_CRED_ENV"

  OPEN_URL="\${_C_LOGIN_URL:-$_C_URL}"
  agent-browser open "$OPEN_URL" >/dev/null 2>&1

  echo "=== Browser opened: $OPEN_URL ==="
  echo ""
  if [ "$_C_AUTH_TYPE" != "none" ] && [ -n "$_C_LOGIN_URL" ]; then
    echo "Login required. Credentials available at: $_AOC_CRED_ENV"
    echo "To login, run these commands:"
    echo "  source $_AOC_CRED_ENV"
    echo '  agent-browser fill <username-field-ref> "$AOC_WEB_USERNAME"'
    echo '  agent-browser fill <password-field-ref> "$AOC_WEB_PASSWORD"'
    echo '  agent-browser click <login-button-ref>'
    echo ""
    echo "Use 'agent-browser snapshot -i' to identify the correct field refs."
  fi
  if [ -n "$TARGET_PATH" ]; then
    echo ""
    echo "After login, navigate to: \${_C_URL%/}/$TARGET_PATH"
    echo "  agent-browser open \\"\${_C_URL%/}/$TARGET_PATH\\""
  fi
  echo ""
  echo "--- Current page snapshot ---"
  agent-browser snapshot 2>/dev/null || echo "(snapshot unavailable)"
  exit 0
fi

# ── Website: api ───────────────────────────────────────────────────────────
if [ "$TYPE" = "website" ] && [ "$ACTION" = "api" ]; then
  API_PATH="\${ARGS:-/}"
  BASE="\${_C_URL%/}"
  FULL_URL="$BASE/$API_PATH"

  if [ -n "\${_C_AUTH_HEADER:-}" ]; then
    curl -sf -H "$_C_AUTH_HEADER" "$FULL_URL"
  else
    curl -sf "$FULL_URL"
  fi
  exit 0
fi

# ── OdooCLI ────────────────────────────────────────────────────────────────
if [ "$TYPE" = "odoocli" ]; then
  # Set env vars for odoocli — credentials never in stdout
  export ODOOCLI_URL="$_C_ODOO_URL"
  export ODOOCLI_DB="$_C_ODOO_DB"
  export ODOOCLI_USERNAME="$_C_ODOO_USERNAME"
  if [ "$_C_ODOO_AUTH_TYPE" = "api_key" ]; then
    export ODOOCLI_API_KEY="$_C_ODOO_CREDENTIAL"
  else
    export ODOOCLI_PASSWORD="$_C_ODOO_CREDENTIAL"
  fi

  # Pass through all remaining args as odoocli subcommand (preserve quoting)
  # e.g.: aoc-connect.sh "My Odoo" record search sale.order --domain "[('state','=','draft')]"
  ODOOCLI_BIN="\${ODOOCLI_BIN:-$(command -v odoocli 2>/dev/null || echo "$HOME/miniforge3/bin/odoocli")}"
  [ ! -x "$ODOOCLI_BIN" ] && { echo "ERROR: odoocli not found. Install: pip install -e /path/to/odoocli"; exit 1; }
  if [ \${#ARGS_ARRAY[@]} -gt 0 ]; then
    "$ODOOCLI_BIN" "$ACTION" "\${ARGS_ARRAY[@]}"
  else
    "$ODOOCLI_BIN" "$ACTION"
  fi
  exit 0
fi

# ── GitHub ─────────────────────────────────────────────────────────────────
if [ "$TYPE" = "github" ]; then
  GITHUB_MODE="\${_C_GITHUB_MODE:-remote}"
  BRANCH="\${_C_BRANCH:-main}"

  if [ "$GITHUB_MODE" = "local" ]; then
    # ── Local mode: git CLI on local filesystem ──────────────────────────
    LOCAL_PATH="$_C_LOCAL_PATH"
    if [ -z "$LOCAL_PATH" ]; then
      echo "ERROR: localPath not configured for connection '$CONN_NAME'."
      exit 1
    fi
    if [ ! -d "$LOCAL_PATH/.git" ] && ! git -C "$LOCAL_PATH" rev-parse --git-dir > /dev/null 2>&1; then
      echo "ERROR: '$LOCAL_PATH' is not a git repository."
      exit 1
    fi

    case "$ACTION" in
      info)
        echo "=== Repository: $LOCAL_PATH ==="
        echo "Current branch: \$(git -C "$LOCAL_PATH" branch --show-current 2>/dev/null || echo unknown)"
        echo "Configured branch: $BRANCH"
        echo ""
        echo "=== Last 3 commits ==="
        git -C "$LOCAL_PATH" log -3 --format="%h %s (%an, %ar)" 2>&1
        echo ""
        echo "=== Working tree status ==="
        git -C "$LOCAL_PATH" status --short 2>&1 | head -20
        ;;
      log)
        N="\${ARGS:-20}"
        git -C "$LOCAL_PATH" log -"$N" --format="%h %s (%an, %ar)" 2>&1
        ;;
      status)
        git -C "$LOCAL_PATH" status 2>&1
        ;;
      branch)
        echo "=== Local branches ==="
        git -C "$LOCAL_PATH" branch -v 2>&1
        echo ""
        echo "=== Remote branches ==="
        git -C "$LOCAL_PATH" branch -rv 2>&1 | head -20
        ;;
      files)
        FILE_PATH="\${ARGS:-}"
        TARGET_PATH="$LOCAL_PATH\${FILE_PATH:+/$FILE_PATH}"
        if [ -f "$TARGET_PATH" ]; then
          cat "$TARGET_PATH"
        elif [ -d "$TARGET_PATH" ]; then
          ls -la "$TARGET_PATH" | head -50
        else
          echo "ERROR: '$TARGET_PATH' not found"
          exit 1
        fi
        ;;
      diff)
        TARGET="\${ARGS:-}"
        if [ -n "$TARGET" ]; then
          git -C "$LOCAL_PATH" diff "$TARGET" 2>&1 | head -200
        else
          git -C "$LOCAL_PATH" diff 2>&1 | head -200
        fi
        ;;
      *)
        echo "ERROR: Unknown GitHub local action '$ACTION'"
        echo "Supported (local mode): info, log [n], status, branch, files [path], diff [target]"
        exit 1
        ;;
    esac
  else
    # ── Remote mode: gh CLI against GitHub API ───────────────────────────
    REPO="\${_C_REPO_OWNER}/\${_C_REPO_NAME}"
    if [ -z "$_C_TOKEN" ]; then
      echo "WARNING: No PAT configured for connection '$CONN_NAME'. Only public repos are accessible without a token."
      echo "         Set a Personal Access Token in AOC Dashboard → Connections → Edit → PAT field."
      unset GH_TOKEN
    else
      export GH_TOKEN="$_C_TOKEN"
    fi

    case "$ACTION" in
      info)
        gh repo view "$REPO" --json name,description,defaultBranchRef,visibility,languages,pushedAt 2>&1 | \\
          python3 -c "import json,sys; d=json.load(sys.stdin); d['defaultBranchRef']={'name':'$BRANCH'}; print(json.dumps(d,indent=2))" 2>/dev/null || \\
          gh repo view "$REPO" --json name,description,visibility,languages,pushedAt 2>&1
        ;;
      prs)
        gh pr list --repo "$REPO" --base "$BRANCH" --json number,title,state,author,createdAt --limit 20 2>&1 | python3 << 'PYEOF'
import json, sys
data = json.load(sys.stdin)
if not data:
    print("No open PRs targeting branch.")
    sys.exit(0)
print(f"| # | Title | Author | State | Created |")
print(f"| --- | --- | --- | --- | --- |")
for pr in data:
    n = pr.get("number", "")
    t = pr.get("title", "").replace("|", "\\\\|")[:60]
    a = (pr.get("author") or {}).get("login", "?")
    s = pr.get("state", "?")
    d = (pr.get("createdAt") or "")[:10]
    print(f"| {n} | {t} | {a} | {s} | {d} |")
print()
print(f"_{len(data)} PRs_")
PYEOF
        ;;
      issues)
        gh issue list --repo "$REPO" --json number,title,state,author,createdAt --limit 20 2>&1 | python3 << 'PYEOF'
import json, sys
data = json.load(sys.stdin)
if not data:
    print("No open issues.")
    sys.exit(0)
print(f"| # | Title | Author | State | Created |")
print(f"| --- | --- | --- | --- | --- |")
for i in data:
    n = i.get("number", "")
    t = i.get("title", "").replace("|", "\\\\|")[:60]
    a = (i.get("author") or {}).get("login", "?")
    s = i.get("state", "?")
    d = (i.get("createdAt") or "")[:10]
    print(f"| {n} | {t} | {a} | {s} | {d} |")
print()
print(f"_{len(data)} issues_")
PYEOF
        ;;
      files)
        FILE_PATH="\${ARGS:-}"
        if [ -n "$FILE_PATH" ]; then
          gh api "repos/$REPO/contents/$FILE_PATH?ref=$BRANCH" --jq '.content' 2>/dev/null | base64 -d 2>/dev/null || \\
            gh api "repos/$REPO/contents/$FILE_PATH?ref=$BRANCH" 2>&1
        else
          gh api "repos/$REPO/contents/?ref=$BRANCH" --jq '.[].name' 2>&1
        fi
        ;;
      diff)
        TARGET="\${ARGS:-main}"
        gh api "repos/$REPO/compare/\${TARGET}...$BRANCH" --jq '.files[] | "\\(.status) \\(.filename) (+\\(.additions)/-\\(.deletions))"' 2>&1 | head -50
        ;;
      clone)
        CLONE_DIR=$(mktemp -d /tmp/aoc-repo-XXXXXXXX)
        TMPFILES+=("$CLONE_DIR")
        gh repo clone "$REPO" "$CLONE_DIR" -- --branch "$BRANCH" --single-branch --depth 50 2>&1
        echo ""
        echo "Cloned to: $CLONE_DIR"
        echo "Branch: $BRANCH"
        echo "Files:"
        ls -la "$CLONE_DIR" | head -20
        ;;
      *)
        echo "ERROR: Unknown GitHub action '$ACTION'"
        echo "Supported (remote mode): info, prs, issues, files [path], diff [target-branch], clone"
        exit 1
        ;;
    esac
  fi
  exit 0
fi

echo "ERROR: Unsupported action '$ACTION' for connection type '$TYPE'"
echo "Supported actions:"
echo "  bigquery: query"
echo "  postgres: query"
echo "  ssh:      exec"
echo "  website:  browse, api"
echo "  github (remote): info, prs, issues, files, diff, clone
  github (local):  info, log, status, branch, files, diff"
echo "  odoocli:  <odoocli subcommand> (auth, record, model, method, debug, module)"
exit 1
`;

function ensureAocConnectScript() {
  ensureDir();
  const scriptPath = path.join(SCRIPTS_DIR, AOC_CONNECT_SCRIPT_NAME);

  // Always overwrite to keep script up to date
  fs.writeFileSync(scriptPath, AOC_CONNECT_SCRIPT_CONTENT, { mode: 0o755, encoding: 'utf-8' });

  const meta = readMeta(SCRIPTS_DIR);
  meta[AOC_CONNECT_SCRIPT_NAME] = {
    name: 'aoc_connect',
    emoji: '🔗',
    description: 'Generic connection wrapper — query databases, execute SSH commands, browse websites, access GitHub repos. Credentials never appear in stdout. Usage: aoc-connect.sh <connection-name> <action> [args]',
    execHint: `${SCRIPTS_DIR}/aoc-connect.sh <connection-name> <action> [args...]`,
  };
  writeMeta(SCRIPTS_DIR, meta);
  console.log('[scripts] Ensured shared aoc-connect.sh script');
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
  ensureGwsCallScript();
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

const CONNECTIONS_CONTEXT_START = '<!-- aoc:connections:start -->';
const CONNECTIONS_CONTEXT_END = '<!-- aoc:connections:end -->';

/**
 * Write (or clear) the connections context block in an agent's TOOLS.md.
 * Called whenever an agent's connection assignments change.
 *
 * @param {string} agentId
 * @param {Array}  connections  — raw connection objects (from db.getAllConnections filtered by assigned ids)
 * @param {Function} getAgentFileFn   — parsers.getAgentFile
 * @param {Function} saveAgentFileFn  — parsers.saveAgentFile
 */
// Usage guide per connection type (generic, no credentials/URLs)
const CONN_TYPE_GUIDE = {
  bigquery: {
    label: 'BigQuery',
    actions: [
      '`aoc-connect.sh "<name>" query "SELECT * FROM dataset.table LIMIT 10"`',
      '`aoc-connect.sh "<name>" query "SELECT COUNT(*) FROM dataset.table"`',
    ],
  },
  postgres: {
    label: 'PostgreSQL',
    actions: [
      '`aoc-connect.sh "<name>" query "SELECT * FROM table LIMIT 10"`',
      '`aoc-connect.sh "<name>" query "SHOW TABLES"`',
    ],
  },
  ssh: {
    label: 'SSH/VPS',
    actions: [
      '`aoc-connect.sh "<name>" exec "ls -la"`',
      '`aoc-connect.sh "<name>" exec "systemctl status <service>"`',
    ],
  },
  website: {
    label: 'Website',
    actions: [
      '`aoc-connect.sh "<name>" browse "/path"`',
      '`aoc-connect.sh "<name>" api "/api/endpoint"`',
    ],
  },
  github: {
    label: 'GitHub Repo',
    // Actions are generated per-connection based on githubMode — see _buildGithubSection()
    actions: [],
  },
  odoocli: {
    label: 'Odoo',
    actions: [
      '`aoc-connect.sh "<name>" record search <model> --domain "[...]" --fields name,state`',
      '`aoc-connect.sh "<name>" record read <model> <id> --fields name,state`',
      '`aoc-connect.sh "<name>" record create <model> --values "{...}"`',
    ],
  },
};

/**
 * Build per-connection GitHub section with mode-specific context and actions.
 */
function _buildGithubSection(conn) {
  const meta = conn.metadata || {};
  const mode = meta.githubMode || 'remote';
  const branch = meta.branch || 'main';
  const name = conn.name;
  const lines = [];

  if (mode === 'local') {
    const lp = meta.localPath || '/path/to/repo';
    lines.push(`**"${name}"** — local repo at \`${lp}\` (branch: \`${branch}\`)`);
    lines.push('');
    lines.push(`  You can use git directly: \`git -C "${lp}" <command>\``);
    lines.push(`  Or use the wrapper: \`aoc-connect.sh "${name}" <action>\``);
    lines.push('');
    lines.push(`  \`aoc-connect.sh "${name}" info\`            — commits + working tree status`);
    lines.push(`  \`aoc-connect.sh "${name}" log [n]\`          — recent git log`);
    lines.push(`  \`aoc-connect.sh "${name}" status\`           — git status`);
    lines.push(`  \`aoc-connect.sh "${name}" branch\`           — list branches`);
    lines.push(`  \`aoc-connect.sh "${name}" files [path]\`     — cat file or ls directory`);
    lines.push(`  \`aoc-connect.sh "${name}" diff [target]\`    — git diff`);
  } else {
    const repo = `${meta.repoOwner || '?'}/${meta.repoName || '?'}`;
    lines.push(`**"${name}"** — remote \`${repo}\` (branch: \`${branch}\`)`);
    lines.push('');
    lines.push(`  \`aoc-connect.sh "${name}" info\`                — repo metadata`);
    lines.push(`  \`aoc-connect.sh "${name}" prs\`                 — list open PRs`);
    lines.push(`  \`aoc-connect.sh "${name}" issues\`              — list open issues`);
    lines.push(`  \`aoc-connect.sh "${name}" files [path]\`        — browse or read a file`);
    lines.push(`  \`aoc-connect.sh "${name}" diff [base-branch]\`  — compare branch diff`);
    lines.push(`  \`aoc-connect.sh "${name}" clone\`               — clone to /tmp`);
  }

  return lines;
}

function syncAgentConnectionsContext(agentId, connections, getAgentFileFn, saveAgentFileFn) {
  const enabled = (connections || []).filter(c => c.enabled !== false);
  let toolsContent = '';
  try { toolsContent = getAgentFileFn(agentId, 'TOOLS.md').content || ''; } catch {}

  // Build the replacement block
  let block = '';
  if (enabled.length > 0) {
    // Group connections by type
    const byType = {};
    for (const c of enabled) {
      if (!byType[c.type]) byType[c.type] = [];
      byType[c.type].push(c);
    }

    const sections = [];
    for (const [type, conns] of Object.entries(byType)) {
      const guide = CONN_TYPE_GUIDE[type];
      const label = guide ? guide.label : type;

      // GitHub gets per-connection sections with mode-specific context
      if (type === 'github') {
        sections.push(`### ${label}`);
        sections.push('');
        for (const c of conns) {
          sections.push(..._buildGithubSection(c));
          sections.push('');
        }
        continue;
      }

      const nameList = conns.map(c => `"${c.name}"`).join(', ');
      sections.push(`### ${label}`);
      sections.push(`Available: ${nameList}`);
      if (guide && guide.actions.length) {
        sections.push('');
        for (const action of guide.actions) {
          sections.push(`  ${action}`);
        }
      }
      sections.push('');
    }

    block = [
      CONNECTIONS_CONTEXT_START,
      '## Connections',
      '',
      `You have ${enabled.length} connection(s) assigned. Run \`check_connections.sh\` to see full details.`,
      'Use `aoc-connect.sh "<connection-name>" <action> [args]` — credentials are handled automatically.',
      '',
      ...sections,
      CONNECTIONS_CONTEXT_END,
    ].join('\n');
  } else {
    // No connections — write empty marker so we can remove stale content
    block = `${CONNECTIONS_CONTEXT_START}\n${CONNECTIONS_CONTEXT_END}`;
  }

  // Replace or append the block
  let updated;
  if (toolsContent.includes(CONNECTIONS_CONTEXT_START)) {
    const startIdx = toolsContent.indexOf(CONNECTIONS_CONTEXT_START);
    const endIdx = toolsContent.indexOf(CONNECTIONS_CONTEXT_END);
    if (endIdx === -1) {
      updated = toolsContent.slice(0, startIdx) + block;
    } else {
      updated = toolsContent.slice(0, startIdx) + block + toolsContent.slice(endIdx + CONNECTIONS_CONTEXT_END.length);
    }
  } else {
    updated = toolsContent.trimEnd() + '\n\n' + block + '\n';
  }

  saveAgentFileFn(agentId, 'TOOLS.md', updated);
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
  ensureCheckConnectionsScript,
  ensureGwsCallScript,
  ensureAocConnectScript,
  ensureFetchAttachmentScript,
  ensureSaveOutputScript,
  ensurePostCommentScript,
  injectHeartbeatTaskCheck,
  // ADLC shared scripts installer
  ensureSharedAdlcScripts,
  // Connection context injector
  syncAgentConnectionsContext,
  SCRIPTS_DIR, ALLOWED_EXT,
};
