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
  const prev = all[filename] || {};
  // Preserve provenance fields (source/capability) when callers only update user-facing fields.
  const next = {
    ...prev,
    name: meta.name !== undefined ? meta.name : (prev.name || ''),
    description: meta.description !== undefined ? meta.description : (prev.description || ''),
  };
  if (meta.source !== undefined) next.source = meta.source;
  if (meta.capability !== undefined) next.capability = meta.capability;
  all[filename] = next;
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
    source:      meta.source || 'user',
    capability:  meta.capability || null,
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

// ─── AOC built-in shared scripts manifest ────────────────────────────────────
// These scripts are owned by AOC dashboard and auto-installed via ensure*Script
// helpers. They should NOT appear in the user-facing Custom Tools list — they
// activate automatically based on agent state (connections / tasks / skills).
//
// trigger:
//   'always'           → injected for every agent
//   'connection-type'  → injected when agent has a connection of `types`
//   'skill'            → injected when agent has `skill` installed (enabled)
const BUILTIN_SCRIPT_MANIFEST = {
  // All AOC built-in capabilities are now packaged as skill bundles:
  //   - aoc-connections     → ~/.openclaw/skills/aoc-connections/
  //   - aoc-tasks           → ~/.openclaw/skills/aoc-tasks/
  //   - browser-harness-odoo → ~/.openclaw/skills/browser-harness-odoo/
  // The manifest is intentionally empty: agents get scripts via SKILL.md when
  // the corresponding skill is enabled (which is automatic for built-ins).
  // Kept as an empty object to preserve syncAgentBuiltins's API contract.
};

// Filenames of legacy flat scripts that have moved INTO their owning skill.
// At startup we delete these from ~/.openclaw/scripts/ to avoid two copies of
// the same script existing on disk. The skill bundle is now the source of truth.
const LEGACY_FLAT_SCRIPTS_MOVED_TO_SKILLS = [
  // → browser-harness-odoo skill
  'browser-harness-acquire.sh',
  'browser-harness-release.sh',
  'runbook-validate.sh',
  'runbook-run.sh',
  'runbook-list.sh',
  'runbook-show.sh',
  'runbook-publish.sh',
  'runbook-history.sh',
  'runbook-promote-selectors.sh',
  'dom-snapshot.sh',
  // → aoc-tasks skill
  'update_task.sh',
  'check_tasks.sh',
  'fetch_attachment.sh',
  'save_output.sh',
  'post_comment.sh',
  // → aoc-connections skill
  'aoc-connect.sh',
  'check_connections.sh',
  'mcp-call.sh',
  'gws-call.sh',
];

function purgeLegacyFlatScripts() {
  let removed = 0;
  const meta = readMeta(SCRIPTS_DIR);
  let metaChanged = false;
  for (const f of LEGACY_FLAT_SCRIPTS_MOVED_TO_SKILLS) {
    const p = path.join(SCRIPTS_DIR, f);
    try {
      if (fs.existsSync(p)) { fs.unlinkSync(p); removed++; }
    } catch (e) {
      console.warn(`[scripts] failed to remove legacy ${f}:`, e.message);
    }
    if (meta[f]) { delete meta[f]; metaChanged = true; }
  }
  if (metaChanged) writeMeta(SCRIPTS_DIR, meta);
  if (removed > 0) console.log(`[scripts] removed ${removed} legacy flat scripts (now living inside skills)`);
  return { removed };
}

function isBuiltinShared(filename) {
  return Object.prototype.hasOwnProperty.call(BUILTIN_SCRIPT_MANIFEST, filename);
}

/** Stamp source/capability metadata for known built-in scripts. Idempotent.
 *  Run at startup once. Only touches scripts in BUILTIN_SCRIPT_MANIFEST —
 *  user-authored scripts are left untouched (default source='user'). */
function stampBuiltinSharedMeta() {
  ensureDir();
  const all = readMeta(SCRIPTS_DIR);
  let touched = 0;
  for (const [filename, info] of Object.entries(BUILTIN_SCRIPT_MANIFEST)) {
    const filePath = path.join(SCRIPTS_DIR, filename);
    if (!fs.existsSync(filePath)) continue;
    const prev = all[filename] || {};
    if (prev.source === 'aoc-builtin' && prev.capability === info.capability) continue;
    all[filename] = {
      ...prev,
      name: prev.name || '',
      description: prev.description || '',
      source: 'aoc-builtin',
      capability: info.capability,
    };
    touched++;
  }
  if (touched > 0) {
    writeMeta(SCRIPTS_DIR, all);
    console.log(`[scripts] stamped ${touched} built-in scripts with source/capability metadata`);
  }
  return { touched };
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

/** Returns both shared (~/.openclaw/scripts) and agent-specific scripts with enabled status.
 *  By default, AOC built-in shared scripts (source='aoc-builtin') are filtered out —
 *  they activate automatically based on agent state (connections / tasks / skills),
 *  not via this UI. Pass { includeBuiltin: true } to include them (admin/debug). */
function listAgentCustomTools(agentId, getAgentFileFn, opts = {}) {
  const includeBuiltin = !!opts.includeBuiltin;
  let toolsMd = '';
  try { toolsMd = getAgentFileFn(agentId, 'TOOLS.md').content || ''; } catch {}

  // Shared scripts — read-only preview, toggle to assign
  const shared = listScripts()
    .filter((s) => includeBuiltin || s.source !== 'aoc-builtin')
    .map((s) => ({
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

// Task scripts now live in the aoc-tasks skill bundle (see
// server/lib/aoc-tasks/installer.cjs). These ensure*Script functions are
// kept as no-ops for backward compatibility with existing call sites.
function ensureUpdateTaskScript() { /* moved to aoc-tasks skill */ }

const CHECK_TASKS_SCRIPT_NAME = 'check_tasks.sh';
const CHECK_TASKS_SCRIPT_CONTENT = `#!/usr/bin/env bash
# check_tasks — List todo tasks assigned to this agent, sorted by priority
# Called automatically via HEARTBEAT.md

source "\${OPENCLAW_HOME:-$HOME/.openclaw}/.aoc_env"
[ -f "$PWD/.aoc_agent_env" ] && source "$PWD/.aoc_agent_env"
[ -f "\${OPENCLAW_WORKSPACE}/.aoc_agent_env" ] && source "\${OPENCLAW_WORKSPACE}/.aoc_agent_env"
[ -f "\${OPENCLAW_STATE_DIR}/workspace/.aoc_agent_env" ] && source "\${OPENCLAW_STATE_DIR}/workspace/.aoc_agent_env"

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

function ensureCheckTasksScript() { /* moved to aoc-tasks skill */ }

const HEARTBEAT_BLOCK_START = '<!-- aoc-task-check -->';
const HEARTBEAT_BLOCK_END   = '<!-- /aoc-task-check -->';
const HEARTBEAT_BLOCK_CONTENT = `${HEARTBEAT_BLOCK_START}
## Autonomous Task Check

Check if you have tasks assigned to you. The heartbeat runs without your
shell PATH being set up, so use absolute paths:

1. Run: \`bash ~/.openclaw/skills/aoc-tasks/scripts/check_tasks.sh\`
2. If tasks are listed, pick the **highest priority** task (shown first) and start working on it immediately
3. You may work on **multiple tasks in parallel** — do not wait for current tasks to finish
4. For each task you start, immediately run:
   \`bash ~/.openclaw/skills/aoc-tasks/scripts/update_task.sh <taskId> in_progress "Starting work"\`
5. When done: \`bash ~/.openclaw/skills/aoc-tasks/scripts/update_task.sh <taskId> done "Summary of what was done"\`
6. If blocked: \`bash ~/.openclaw/skills/aoc-tasks/scripts/update_task.sh <taskId> blocked "Specific reason"\`

After this check, your subsequent work can use the bare names (the
\`aoc-tasks\` skill SKILL.md instructs you to put its scripts/ on PATH).
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

  // Build a PATH addition that makes every installed skill's scripts/ directory
  // resolvable as bare command names. Without this, agents follow TOOLS.md
  // which tells them to "run check_connections.sh" and the shell errors with
  // "command not found" — costing 1-3 wasted thinking turns per session.
  // Audit data confirms this was the #1 failure pattern in May 4-5 sessions.
  // Skills live under OPENCLAW_STATE_DIR/skills (per-user gateways) which
  // defaults to OPENCLAW_HOME for the admin/legacy single-tenant case. Glob
  // both so admin (state == home) and user (state == home/.openclaw) work.
  const skillPathExpansion = [
    '# Add every installed skill\'s scripts/ dir to PATH so bare names like',
    '# `check_connections.sh`, `team-status.sh`, `aoc-connect.sh` resolve.',
    'for _aoc_skill_dir in \\',
    '  "${OPENCLAW_STATE_DIR:-${OPENCLAW_HOME:-$HOME/.openclaw}}"/skills/*/scripts \\',
    '  "${OPENCLAW_HOME:-$HOME/.openclaw}"/skills/*/scripts; do',
    '  [ -d "$_aoc_skill_dir" ] && PATH="$_aoc_skill_dir:$PATH"',
    'done',
    'unset _aoc_skill_dir',
    'export PATH',
  ].join('\n');

  const content = [
    '# AOC Dashboard connection config — auto-generated by AOC server at startup',
    `# Generated: ${new Date().toISOString()}`,
    `export AOC_TOKEN="${token}"`,
    `export AOC_URL="${url}"`,
    '',
    skillPathExpansion,
    '',
  ].join('\n');

  try {
    if (!fs.existsSync(OPENCLAW_HOME_PATH)) fs.mkdirSync(OPENCLAW_HOME_PATH, { recursive: true });
    fs.writeFileSync(AOC_ENV_FILE, content, { mode: 0o600, encoding: 'utf-8' });
    console.log('[scripts] Updated ~/.openclaw/.aoc_env');

    // Also write `.aoc_paths` — a *static* KEY=VALUE file (no shell syntax)
    // that admin's external gateway can consume directly via systemd
    // `EnvironmentFile=`. The .aoc_env file uses `for ... done` shell loops
    // which systemd cannot parse, so without this static dump the admin
    // gateway has no skills/* on PATH and exec calls like `aoc-connect.sh`
    // fail with "command not found".
    try {
      const dirs = [];
      const skillsRoot = path.join(OPENCLAW_HOME_PATH, 'skills');
      if (fs.existsSync(skillsRoot)) {
        for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
          const scriptsDir = path.join(skillsRoot, entry.name, 'scripts');
          try { if (fs.statSync(scriptsDir).isDirectory()) dirs.push(scriptsDir); } catch {}
        }
      }
      const pathsContent = [
        '# Auto-generated by AOC server at startup. Static PATH dump for systemd',
        '# `EnvironmentFile=` consumption (the sibling .aoc_env uses shell `for`',
        '# loops which systemd cannot parse).',
        `# Generated: ${new Date().toISOString()}`,
        `AOC_TOKEN=${token}`,
        `AOC_URL=${url}`,
        `PATH=${[...dirs, '${PATH}'].join(':')}`,
        '',
      ].join('\n');
      fs.writeFileSync(path.join(OPENCLAW_HOME_PATH, '.aoc_paths'), pathsContent, { mode: 0o600, encoding: 'utf-8' });
    } catch (err) {
      console.warn('[scripts] Failed to write .aoc_paths:', err.message);
    }
  } catch (err) {
    console.warn('[scripts] Failed to write .aoc_env:', err.message);
  }

  // Write .aoc_env for each non-admin user's gateway OPENCLAW_HOME.
  // The per-user gateway is spawned with OPENCLAW_HOME=path.dirname(userHome)
  // (e.g. ~/.openclaw/users/2/), so aoc-connect.sh sources that directory.
  try {
    const dbMod = require('./db.cjs');
    const { getUserHome } = require('./config.cjs');
    const users = (typeof dbMod.getAllUsers === 'function') ? dbMod.getAllUsers() : [];
    let written = 0;
    for (const user of users) {
      if (Number(user.id) === 1) continue;
      const gwHome = path.dirname(getUserHome(user.id)); // ~/.openclaw/users/<id>
      if (!fs.existsSync(gwHome)) continue;
      try {
        fs.writeFileSync(path.join(gwHome, '.aoc_env'), content, { mode: 0o600, encoding: 'utf-8' });
        written++;
      } catch {}
    }
    if (written > 0) console.log(`[scripts] Updated .aoc_env for ${written} non-admin user(s)`);
  } catch (_) { /* DB may not be ready yet */ }

  // Write per-agent .aoc_agent_env in each agent's workspace.
  // Merge two sources: openclaw.json (has workspace paths) + DB agent_profiles
  // (catches agents provisioned via AOC UI, e.g. user2's sparky).
  try {
    const cfg = readJsonSafe(path.join(OPENCLAW_HOME, 'openclaw.json')) || {};
    const configAgents = cfg.agents?.list || [];

    // Build a map: agentId → workspace from config
    const agentMap = new Map();
    for (const agent of configAgents) {
      agentMap.set(agent.id, agent.workspace || OPENCLAW_WORKSPACE);
    }

    // Add DB-provisioned agents that aren't in openclaw.json (including non-admin users)
    try {
      const dbMod2 = require('./db.cjs');
      const { getUserHome: getUH } = require('./config.cjs');
      const profiles = (typeof dbMod2.getAllAgentProfiles === 'function') ? dbMod2.getAllAgentProfiles() : [];
      for (const p of profiles) {
        if (agentMap.has(p.agent_id)) continue;
        const ownerId = p.provisioned_by || 1;
        const ownerHome = getUH(ownerId);
        // master uses <userHome>/workspace; sub-agents use <userHome>/workspaces/<id>
        // Check sub-agent paths first so master's workspace/ doesn't shadow a sibling agent
        const candidates = p.is_master
          ? [path.join(ownerHome, 'workspace')]
          : [
              path.join(ownerHome, 'workspaces', p.agent_id),
              path.join(ownerHome, 'agents', p.agent_id),
              path.join(OPENCLAW_HOME_PATH, 'workspaces', p.agent_id),
              path.join(OPENCLAW_HOME_PATH, 'agents', p.agent_id),
            ];
        const workspace = candidates.find(d => fs.existsSync(d)) || OPENCLAW_WORKSPACE;
        agentMap.set(p.agent_id, workspace);
      }
    } catch (_) { /* DB may not be ready yet */ }

    // Pre-load profile owner map so we mint the right per-agent token. We need
    // (agentId → ownerId) — agents in openclaw.json without a SQLite profile
    // are admin-owned (uid=1) by convention.
    let profilesByAgent = new Map();
    try {
      const dbMod3 = require('./db.cjs');
      if (typeof dbMod3.getAllAgentProfiles === 'function') {
        for (const p of dbMod3.getAllAgentProfiles()) {
          profilesByAgent.set(p.agent_id, Number(p.provisioned_by || 1));
        }
      }
    } catch (_) { /* best-effort */ }

    let dbMod4 = null;
    try { dbMod4 = require('./db.cjs'); } catch (_) {}

    let withToken = 0;
    for (const [agentId, workspace] of agentMap) {
      const agentEnvPath = path.join(workspace, '.aoc_agent_env');
      const ownerId = profilesByAgent.get(agentId) ?? 1;
      // Mint a fresh per-agent service token. Existing agents (provisioned
      // before Sprint 2) get backfilled here on every server start so the
      // cluster-wide DASHBOARD_TOKEN never bleeds into agent shell sessions.
      let token = null;
      try {
        if (dbMod4 && typeof dbMod4.generateAgentServiceToken === 'function') {
          token = dbMod4.generateAgentServiceToken({ agentId, ownerId });
        }
      } catch (e) {
        console.warn(`[scripts] mint token for ${agentId} failed: ${e.message}`);
      }
      const lines = [
        `# AOC agent identity — auto-generated`,
        `export AOC_AGENT_ID="${agentId}"`,
      ];
      if (token) {
        // Set AOC_TOKEN to the per-agent JWT so existing scripts that source
        // .aoc_env first then .aoc_agent_env pick up the scoped token. The
        // explicit AOC_AGENT_TOKEN var is kept for new scripts that want to
        // be unambiguous.
        lines.push(`export AOC_AGENT_TOKEN="${token}"`);
        lines.push(`export AOC_TOKEN="${token}"`);
        withToken++;
      }
      lines.push('');
      try {
        fs.writeFileSync(agentEnvPath, lines.join('\n'), { mode: 0o600, encoding: 'utf-8' });
      } catch {}
    }
    console.log(`[scripts] Updated .aoc_agent_env for ${agentMap.size} agents (${withToken} with per-agent service token)`);
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
[ -f "\${OPENCLAW_WORKSPACE}/.aoc_agent_env" ] && source "\${OPENCLAW_WORKSPACE}/.aoc_agent_env"
[ -f "\${OPENCLAW_STATE_DIR}/workspace/.aoc_agent_env" ] && source "\${OPENCLAW_STATE_DIR}/workspace/.aoc_agent_env"

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
             'githubMode','repo','branch','localPath','clonePath','repoOwner','repoName',
             'linkedEmail','preset','authState','scopes',
             'command','args','toolsDiscoveredAt','transport','url'}
for c in conns:
    t = c.get('type', '?').upper()
    name = c.get('name', '?')
    cid = c.get('id', '?')
    github_mode = c.get('githubMode', 'remote') if c.get('type') == 'github' else None
    mode_tag = f' [{github_mode}]' if github_mode else ''
    print(f'[{t}{mode_tag}] {name}')
    print(f'  id: {cid}')
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
        print(f'  >>> To use: gws-call.sh {cid} <service> <method> \\'<json-body>\\'')
        print(f'  >>> (name "{name}" also works — script resolves name→id)')
        print(f'  >>> Services: drive, docs, sheets, slides, gmail, calendar')
    elif c.get('type') == 'mcp':
        tools = c.get('tools', []) or []
        names = [t.get('name','?') for t in tools]
        preview = ', '.join(names[:8]) + (f' +{len(names)-8} more' if len(names) > 8 else '')
        print(f'  tools ({len(names)}): {preview or "(run --list-tools to discover)"}')
        print(f'  >>> To use: mcp-call.sh "{name}" <tool-name> \\'<json-args>\\'')
        print(f'  >>> List tools: mcp-call.sh "{name}" --list-tools')
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

function ensureCheckConnectionsScript() { /* moved to aoc-connections skill */ }

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

set -uo pipefail   # NOTE: no -e — we handle curl/command exit codes explicitly so
                   # transient failures never abort with empty stdout/stderr.

# Source env files defensively — admin .aoc_env may be EPERM for tenant agents,
# and tenant glob lines can \`nomatch\` in strict shells. Never let that kill us.
source "\${OPENCLAW_HOME:-$HOME/.openclaw}/.aoc_env" 2>/dev/null || true
[ -f "$PWD/.aoc_agent_env" ] && { source "$PWD/.aoc_agent_env" 2>/dev/null || true; }
[ -n "\${OPENCLAW_WORKSPACE:-}" ] && [ -f "\${OPENCLAW_WORKSPACE}/.aoc_agent_env" ] && \\
  { source "\${OPENCLAW_WORKSPACE}/.aoc_agent_env" 2>/dev/null || true; }
[ -n "\${OPENCLAW_STATE_DIR:-}" ] && [ -f "\${OPENCLAW_STATE_DIR}/workspace/.aoc_agent_env" ] && \\
  { source "\${OPENCLAW_STATE_DIR}/workspace/.aoc_agent_env" 2>/dev/null || true; }

# Preflight — fail LOUD with named missing vars so callers (and self-healing
# agents) know exactly what's wrong instead of seeing exit code 3 silently.
_missing=()
[ -z "\${AOC_URL:-}" ]      && _missing+=("AOC_URL")
[ -z "\${AOC_TOKEN:-}" ]    && _missing+=("AOC_TOKEN")
[ -z "\${AOC_AGENT_ID:-}" ] && _missing+=("AOC_AGENT_ID")
if [ \${#_missing[@]} -gt 0 ]; then
  echo "ERROR: gws-call: missing env: \${_missing[*]}" >&2
  echo "  hint: source workspace/.aoc_agent_env, then \\$HOME/.openclaw/.aoc_env" >&2
  echo "  diag: aoc-doctor.sh" >&2
  exit 11
fi

[ $# -lt 2 ] && { echo "Usage: gws-call.sh <connection-name-or-id> <service> <method> [json-body]" >&2; exit 1; }

CONN_ARG="$1"; shift

# Resolve name -> UUID if needed. Server matches \`:id\` to the UUID column only,
# so passing a human-friendly name (e.g. "Google Rheyno") returns 404. We list
# the agent's connections once and find a google_workspace row whose \`name\` or
# \`id\` matches case-insensitively.
_UUID_RE='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
if [[ ! "$CONN_ARG" =~ $_UUID_RE ]]; then
  # NOTE: use /api/connections (full owner-scoped list) — it returns the UUID
  # in the \`id\` field. The agent-scoped /api/agent/connections endpoint
  # deliberately strips \`id\` (see server/routes/mcp-agents.cjs), which makes
  # name→id resolution impossible against it.
  _LIST=$(mktemp /tmp/aoc-gws-list-XXXXXX.json)
  _LIST_HTTP=$(curl -s -o "$_LIST" -w "%{http_code}" \\
    -H "Authorization: Bearer $AOC_TOKEN" \\
    -H "X-AOC-Agent-Id: $AOC_AGENT_ID" \\
    "$AOC_URL/api/connections")
  if [ "$_LIST_HTTP" != "200" ]; then
    echo "ERROR: gws-call: cannot list connections (HTTP $_LIST_HTTP)" >&2
    cat "$_LIST" >&2; echo >&2
    rm -f "$_LIST"
    exit 12
  fi
  CONN_ID=$(CONN_ARG="$CONN_ARG" python3 - "$_LIST" <<'PYEOF'
import json, os, sys
path = sys.argv[1]
target = os.environ["CONN_ARG"].strip().lower()
try:
    with open(path) as f:
        data = json.load(f)
except (OSError, json.JSONDecodeError) as e:
    sys.stderr.write(f"ERROR: gws-call: cannot parse connections response: {e}\\n")
    sys.exit(16)
matches = []
for c in data.get("connections", []):
    if c.get("type") != "google_workspace":
        continue
    if not c.get("id"):
        # Endpoint stripped the id field. Caller picked the wrong URL.
        sys.stderr.write("ERROR: gws-call: connections list missing 'id' field — endpoint returns sanitized payload.\\n")
        sys.stderr.write("  fix: this script must call /api/connections (not /api/agent/connections), or server must include id in response.\\n")
        sys.exit(17)
    name = (c.get("name") or "").strip().lower()
    cid  = (c.get("id")   or "").strip().lower()
    if name == target or cid == target:
        matches.append(c)
if not matches:
    sys.stderr.write(f"ERROR: gws-call: no google_workspace connection matches '{os.environ['CONN_ARG']}'\\n")
    sys.stderr.write("  run: check_connections.sh google_workspace\\n")
    sys.exit(13)
if len(matches) > 1:
    sys.stderr.write(f"ERROR: gws-call: name '{os.environ['CONN_ARG']}' is ambiguous, use UUID:\\n")
    for m in matches:
        sys.stderr.write(f"  {m.get('id')}  {m.get('name')}  ({(m.get('metadata') or {}).get('linkedEmail','?')})\\n")
    sys.exit(14)
print(matches[0]["id"])
PYEOF
)
  _RESOLVE_RC=$?
  rm -f "$_LIST"
  if [ $_RESOLVE_RC -ne 0 ]; then
    exit $_RESOLVE_RC
  fi
else
  CONN_ID="$CONN_ARG"
fi

TMPTOK=$(mktemp /tmp/aoc-gws-tok-XXXXXX.json); trap 'rm -f "$TMPTOK"' EXIT

# Capture HTTP code AND curl exit code separately. Without this, an empty
# AOC_URL gives \`curl: (3) URL rejected: No host part in the URL\` which would
# bubble up under \`set -e\` as a silent script abort.
HTTP_CODE=$(curl -s -o "$TMPTOK" -w "%{http_code}" \\
  -H "Authorization: Bearer $AOC_TOKEN" \\
  -H "X-AOC-Agent-Id: $AOC_AGENT_ID" \\
  "$AOC_URL/api/connections/$CONN_ID/google-access-token")
_CURL_RC=$?

if [ $_CURL_RC -ne 0 ] || [ -z "$HTTP_CODE" ]; then
  echo "ERROR: gws-call: curl failed (rc=$_CURL_RC) — cannot reach $AOC_URL" >&2
  echo "  diag: curl -v \\"$AOC_URL/\\"   and   aoc-doctor.sh" >&2
  exit 15
fi

if [ "$HTTP_CODE" != "200" ]; then
  echo "ERROR: gws-call: token endpoint HTTP $HTTP_CODE for connection '$CONN_ARG' (id=$CONN_ID)" >&2
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
# Optional second positional: full method (e.g. "spreadsheets.values.update").
# When agents collapse service+method into one arg (which is what Google's
# REST docs literally show — "spreadsheets.values.update"), there's no
# METHOD_STR positional. The resource-alias resolver below fixes this up.
METHOD_STR="\${1:-}"; [ $# -gt 0 ] && shift
BODY="\${1:-}"

# Resource-alias resolver: agents frequently use Google's REST-style endpoint
# names directly (e.g. "spreadsheets.values.update") instead of the script's
# <service> <method> two-arg form. Detect a known resource token at the start
# of SERVICE and re-map to the correct service.
_resource="\${SERVICE%%.*}"
_resolved_service=""
case "$_resource" in
  spreadsheets|values)                                            _resolved_service="sheets"   ;;
  documents)                                                      _resolved_service="docs"     ;;
  presentations)                                                  _resolved_service="slides"   ;;
  files|about|permissions|drives|revisions|changes)               _resolved_service="drive"    ;;
  events|calendarList|calendars|freeBusy|settings|colors|acl)     _resolved_service="calendar" ;;
  tasklists)                                                      _resolved_service="tasks"    ;;
  forms)                                                          _resolved_service="forms"    ;;
  notes)                                                          _resolved_service="keep"     ;;
  spaces|conferenceRecords)                                       _resolved_service="meet"     ;;
  messages|threads|labels|drafts|history)                         _resolved_service="gmail"    ;;
  tasks)
    # "tasks" can be both the service name AND a resource. Only re-alias if
    # SERVICE has a dot ("tasks.list" → service=tasks, method=tasks.list).
    [ "$SERVICE" != "tasks" ] && _resolved_service="tasks"
    ;;
esac
if [ -n "$_resolved_service" ]; then
  # The arg the caller put as SERVICE is actually the method. Promote
  # METHOD_STR to BODY if it looks like JSON (collapsed form), else combine.
  if [ -z "$METHOD_STR" ] || [ "\${METHOD_STR:0:1}" = "{" ] || [ "\${METHOD_STR:0:1}" = "[" ]; then
    BODY="$METHOD_STR"
    METHOD_STR="$SERVICE"
  else
    case "$METHOD_STR" in
      "$SERVICE".*) ;;
      *) METHOD_STR="$SERVICE\${METHOD_STR:+.$METHOD_STR}" ;;
    esac
  fi
  SERVICE="$_resolved_service"
fi

case "$SERVICE" in
  drive)     BASE="https://www.googleapis.com/drive/v3"     ; ID_FIELD="fileId"        ;;
  docs)      BASE="https://docs.googleapis.com/v1"          ; ID_FIELD="documentId"    ;;
  sheets)    BASE="https://sheets.googleapis.com/v4"        ; ID_FIELD="spreadsheetId" ;;
  slides)    BASE="https://slides.googleapis.com/v1"        ; ID_FIELD="presentationId";;
  gmail)     BASE="https://gmail.googleapis.com/gmail/v1/users/me"; ID_FIELD="id"      ;;
  calendar)  BASE="https://www.googleapis.com/calendar/v3"  ; ID_FIELD="eventId"       ;;
  forms)     BASE="https://forms.googleapis.com/v1"         ; ID_FIELD="formId"        ;;
  tasks)     BASE="https://tasks.googleapis.com/tasks/v1"   ; ID_FIELD="task"          ;;
  keep)      BASE="https://keep.googleapis.com/v1"          ; ID_FIELD="noteId"        ;;
  meet)      BASE="https://meet.googleapis.com/v2"          ; ID_FIELD="name"          ;;
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

# Normalize SDK-style "body" wrapper. Agents trained on Google's REST API SDKs
# (google-api-python-client etc.) replicate the method-signature shape, which
# nests the actual request payload under a "body" subkey:
#   {"spreadsheetId": "X", "range": "Y", "valueInputOption": "RAW",
#    "body": {"values": [[...]]}}
# Sheets/Docs/Slides APIs expect the payload at top level, so we flatten:
# pop the "body" subkey and merge its contents (without overwriting top-level
# keys agents already specified).
if isinstance(body, dict) and "body" in body and isinstance(body["body"], dict):
    inner = body.pop("body")
    for k, v in inner.items():
        body.setdefault(k, v)
# Same with "requestBody" (alternate SDK convention).
if isinstance(body, dict) and "requestBody" in body and isinstance(body["requestBody"], dict):
    inner = body.pop("requestBody")
    for k, v in inner.items():
        body.setdefault(k, v)
# And "resource" (yet another Google API client naming).
if isinstance(body, dict) and "resource" in body and isinstance(body["resource"], dict):
    inner = body.pop("resource")
    for k, v in inner.items():
        body.setdefault(k, v)

parts = method.split(".")
if len(parts) < 2:
    sys.stderr.write(f"ERROR: method must be <resource>.<action>: {method}\\n"); sys.exit(1)

if service == "sheets" and len(parts) == 3 and parts[1] == "values":
    resource = parts[0]
    action   = "values." + parts[2]
elif service == "forms" and len(parts) == 3 and parts[1] == "responses":
    resource = parts[0]
    action   = "responses." + parts[2]
else:
    resource = parts[0]
    action   = ".".join(parts[1:])

def req_id():
    if not body or id_field not in body:
        sys.stderr.write(f"ERROR: body must contain '{id_field}' for this action\\n"); sys.exit(1)
    v = body.pop(id_field)
    return v

path = None; http = None

def _need(field):
    v = body.pop(field, None)
    if not v:
        sys.stderr.write(f"ERROR: body must contain '{field}' for {service}.{resource}.{action}\\n")
        sys.exit(1)
    return v

# ── Calendar API has unusual URL structure (nested under /users/me/ or
# /calendars/{calendarId}/) so the generic /{resource}/{id} builder produces
# 404. Route Calendar requests through explicit per-resource templates.
if service == "calendar":
    if resource == "calendarList":
        if action == "list":         path, http = "/users/me/calendarList", "GET"
        elif action == "get":        path, http = f"/users/me/calendarList/{urllib.parse.quote(_need('calendarId'))}", "GET"
        elif action in ("insert", "create"): path, http = "/users/me/calendarList", "POST"
        elif action == "patch":      path, http = f"/users/me/calendarList/{urllib.parse.quote(_need('calendarId'))}", "PATCH"
        elif action == "update":     path, http = f"/users/me/calendarList/{urllib.parse.quote(_need('calendarId'))}", "PUT"
        elif action == "delete":     path, http = f"/users/me/calendarList/{urllib.parse.quote(_need('calendarId'))}", "DELETE"
    elif resource == "events":
        cid = urllib.parse.quote(_need("calendarId"))
        if action == "list":         path, http = f"/calendars/{cid}/events", "GET"
        elif action == "get":        path, http = f"/calendars/{cid}/events/{urllib.parse.quote(_need('eventId'))}", "GET"
        elif action in ("create", "insert"): path, http = f"/calendars/{cid}/events", "POST"
        elif action == "update":     path, http = f"/calendars/{cid}/events/{urllib.parse.quote(_need('eventId'))}", "PUT"
        elif action == "patch":      path, http = f"/calendars/{cid}/events/{urllib.parse.quote(_need('eventId'))}", "PATCH"
        elif action == "delete":     path, http = f"/calendars/{cid}/events/{urllib.parse.quote(_need('eventId'))}", "DELETE"
        elif action == "quickAdd":   path, http = f"/calendars/{cid}/events/quickAdd", "POST"
        elif action == "move":       path, http = f"/calendars/{cid}/events/{urllib.parse.quote(_need('eventId'))}/move", "POST"
        elif action == "instances":  path, http = f"/calendars/{cid}/events/{urllib.parse.quote(_need('eventId'))}/instances", "GET"
    elif resource == "calendars":
        if action == "list":
            sys.stderr.write("ERROR: 'calendars.list' doesn't exist in Calendar API — use 'calendarList.list' instead.\\n"); sys.exit(1)
        cid = urllib.parse.quote(_need("calendarId"))
        if action == "get":          path, http = f"/calendars/{cid}", "GET"
        elif action == "patch":      path, http = f"/calendars/{cid}", "PATCH"
        elif action == "update":     path, http = f"/calendars/{cid}", "PUT"
        elif action == "delete":     path, http = f"/calendars/{cid}", "DELETE"
        elif action == "clear":      path, http = f"/calendars/{cid}/clear", "POST"
        elif action in ("create", "insert"): path, http = "/calendars", "POST"
    elif resource == "settings":
        if action == "list":         path, http = "/users/me/settings", "GET"
        elif action == "get":        path, http = f"/users/me/settings/{urllib.parse.quote(_need('setting'))}", "GET"
    elif resource == "freeBusy":
        if action == "query":        path, http = "/freeBusy", "POST"
    elif resource == "colors":
        if action == "get":          path, http = "/colors", "GET"
    if path is None:
        sys.stderr.write(f"ERROR: unsupported calendar action: {resource}.{action}. Use --raw for advanced endpoints.\\n")
        sys.exit(1)
elif service == "tasks":
    # Tasks API — tasklists live under /users/@me/lists, tasks under /lists/{tasklist}/tasks.
    if resource == "tasklists":
        if action == "list":             path, http = "/users/@me/lists", "GET"
        elif action == "get":            path, http = f"/users/@me/lists/{urllib.parse.quote(_need('tasklist'))}", "GET"
        elif action in ("insert","create"): path, http = "/users/@me/lists", "POST"
        elif action == "patch":          path, http = f"/users/@me/lists/{urllib.parse.quote(_need('tasklist'))}", "PATCH"
        elif action == "update":         path, http = f"/users/@me/lists/{urllib.parse.quote(_need('tasklist'))}", "PUT"
        elif action == "delete":         path, http = f"/users/@me/lists/{urllib.parse.quote(_need('tasklist'))}", "DELETE"
    elif resource == "tasks":
        tl = urllib.parse.quote(_need("tasklist"))
        if action == "list":             path, http = f"/lists/{tl}/tasks", "GET"
        elif action == "get":            path, http = f"/lists/{tl}/tasks/{urllib.parse.quote(_need('task'))}", "GET"
        elif action in ("insert","create"): path, http = f"/lists/{tl}/tasks", "POST"
        elif action == "patch":          path, http = f"/lists/{tl}/tasks/{urllib.parse.quote(_need('task'))}", "PATCH"
        elif action == "update":         path, http = f"/lists/{tl}/tasks/{urllib.parse.quote(_need('task'))}", "PUT"
        elif action == "delete":         path, http = f"/lists/{tl}/tasks/{urllib.parse.quote(_need('task'))}", "DELETE"
        elif action == "clear":          path, http = f"/lists/{tl}/clear", "POST"
        elif action == "move":           path, http = f"/lists/{tl}/tasks/{urllib.parse.quote(_need('task'))}/move", "POST"
    if path is None:
        sys.stderr.write(f"ERROR: unsupported tasks action: {resource}.{action}. Use --raw for advanced endpoints.\\n")
        sys.exit(1)
elif service == "meet":
    # Google Meet API v2 — spaces are meeting rooms, conferenceRecords are past meetings.
    if resource == "spaces":
        if action in ("create","insert"): path, http = "/spaces", "POST"
        elif action == "get":            path, http = f"/spaces/{urllib.parse.quote(_need('name'))}", "GET"
        elif action == "patch":          path, http = f"/spaces/{urllib.parse.quote(_need('name'))}", "PATCH"
        elif action == "endActiveConference": path, http = f"/spaces/{urllib.parse.quote(_need('name'))}:endActiveConference", "POST"
    elif resource == "conferenceRecords":
        if action == "list":             path, http = "/conferenceRecords", "GET"
        elif action == "get":            path, http = f"/conferenceRecords/{urllib.parse.quote(_need('name'))}", "GET"
    if path is None:
        sys.stderr.write(f"ERROR: unsupported meet action: {resource}.{action}. Use --raw for advanced endpoints.\\n")
        sys.exit(1)
elif action == "list":              path, http = f"/{resource}", "GET"
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
elif action == "responses.list":
    # forms.responses.list — list all responses for a form
    fid = req_id()  # uses formId from body
    path, http = f"/forms/{fid}/responses", "GET"
elif action == "responses.get":
    # forms.responses.get — fetch a specific response
    fid = req_id()  # formId
    rid = body.pop("responseId", None)
    if not rid:
        sys.stderr.write("ERROR: body must contain 'responseId' for forms.responses.get\\n"); sys.exit(1)
    path, http = f"/forms/{fid}/responses/{rid}", "GET"
else:
    sys.stderr.write(f"ERROR: unsupported action: {action}. Use --raw for advanced endpoints.\\n"); sys.exit(1)

url = base + path

def _qv(v):
    if isinstance(v, bool): return "true" if v else "false"
    if isinstance(v, (dict, list)): return json.dumps(v)
    return str(v)

def _append_qs(_url, params):
    if not params: return _url
    qs = urllib.parse.urlencode({k: _qv(v) for k, v in params.items() if v is not None})
    if not qs: return _url
    return _url + ("&" if "?" in _url else "?") + qs

# Explicit query-param escape hatch: caller can put params into "_queryParams"
# in the body to force them onto the URL regardless of HTTP method.
_explicit_qp = body.pop("_queryParams", None) if isinstance(body, dict) else None
if _explicit_qp:
    url = _append_qs(url, _explicit_qp)

# Calendar events action params that Google expects as QUERY string, not body:
# - sendUpdates / sendNotifications: trigger invite emails ('all' = send to everyone)
# - conferenceDataVersion: required (=1) when creating events with Meet links
# - supportsAttachments, maxAttendees, alwaysIncludeEmail: standard flags
# - destination: required for events.move
# Auto-pop these from body so the agent can pass them naturally alongside the
# event resource.
if service == "calendar" and resource == "events" and isinstance(body, dict):
    for k in ("sendUpdates","sendNotifications","conferenceDataVersion",
             "supportsAttachments","maxAttendees","alwaysIncludeEmail","destination"):
        v = body.pop(k, None)
        if v is not None:
            url = _append_qs(url, {k: v})

# For GET/DELETE, leftover body fields become URL query params (Google APIs
# expect pageSize, fields, q, etc. in the query string — NOT as a JSON body).
# Sending a body with GET makes Google reject the HTTP/2 stream with
# INTERNAL_ERROR (curl exit 92).
if http in ("GET", "DELETE") and body:
    url = _append_qs(url, body)
    body = None

args = ["curl", "-sf", "-X", http, "-H", f"Authorization: Bearer {token}"]
if http in ("POST", "PUT", "PATCH") and body is not None:
    args += ["-H", "Content-Type: application/json", "--data-raw", json.dumps(body)]
args.append(url)

r = subprocess.run(args)
sys.exit(r.returncode)
PYEOF
`;

function ensureGwsCallScript() { /* moved to aoc-connections skill */ }

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

function ensureFetchAttachmentScript() { /* moved to aoc-tasks skill */ }

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
[ -f "\${OPENCLAW_WORKSPACE}/.aoc_agent_env" ] && source "\${OPENCLAW_WORKSPACE}/.aoc_agent_env" 2>/dev/null || true
[ -f "\${OPENCLAW_STATE_DIR}/workspace/.aoc_agent_env" ] && source "\${OPENCLAW_STATE_DIR}/workspace/.aoc_agent_env" 2>/dev/null || true
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

function ensureSaveOutputScript() { /* moved to aoc-tasks skill */ }

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
[ -f "\${OPENCLAW_WORKSPACE}/.aoc_agent_env" ] && source "\${OPENCLAW_WORKSPACE}/.aoc_agent_env" 2>/dev/null || true
[ -f "\${OPENCLAW_STATE_DIR}/workspace/.aoc_agent_env" ] && source "\${OPENCLAW_STATE_DIR}/workspace/.aoc_agent_env" 2>/dev/null || true

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

function ensurePostCommentScript() { /* moved to aoc-tasks skill */ }

// ── project_memory.sh — Read/write project-level structured memory ─────────
//
// Phase A2 — surfaces the dispatched task's project memory (decisions /
// open questions / risks / glossary) and lets the agent contribute.
// Memory is project-scoped, persistent across sessions, and injected into
// every agent context.json under \`projectMemory\`.

const PROJECT_MEMORY_SCRIPT_NAME = 'project_memory.sh';
const PROJECT_MEMORY_SCRIPT_CONTENT = `#!/usr/bin/env bash
# project_memory — Read or write the current project's structured memory.
#
# Memory kinds: decision | question | risk | glossary
# Statuses:     open | resolved | archived
#
# Usage:
#   project_memory.sh show                                 # all open + recent
#   project_memory.sh list <kind> [status]                 # filtered list (json)
#   project_memory.sh add <kind> "<title>" ["<body>"]      # create entry (returns id)
#   project_memory.sh add risk "<title>" "<body>" <category> <severity>
#                                                          # category=value|usability|feasibility|viability
#                                                          # severity=low|medium|high
#   project_memory.sh resolve <id> ["<answer/note>"]       # mark resolved (questions/risks)
#   project_memory.sh archive <id>
#   project_memory.sh delete  <id>
#
# Project id is read from .aoc/tasks/<taskId>/context.json (\`projectId\`).
# The current task id should be set in CURRENT_TASK_ID, or pass --task <id>.

set -euo pipefail

source "\${OPENCLAW_HOME:-$HOME/.openclaw}/.aoc_env" 2>/dev/null || true
[ -f "$PWD/.aoc_agent_env" ] && source "$PWD/.aoc_agent_env" 2>/dev/null || true
[ -f "\${OPENCLAW_WORKSPACE}/.aoc_agent_env" ] && source "\${OPENCLAW_WORKSPACE}/.aoc_agent_env" 2>/dev/null || true
[ -f "\${OPENCLAW_STATE_DIR}/workspace/.aoc_agent_env" ] && source "\${OPENCLAW_STATE_DIR}/workspace/.aoc_agent_env" 2>/dev/null || true

AOC_URL="\${AOC_URL:-http://localhost:\${PORT:-18800}}"
[ -z "\${AOC_TOKEN:-}" ] && { echo "project_memory: AOC_TOKEN not set" >&2; exit 2; }

# Resolve project id by inspecting the most recent context.json the agent has.
# Strategy: look for .aoc/tasks/<taskId>/context.json under either the project
# workspace (if we can detect it) or PWD.
resolve_project_id() {
  local hint
  hint="\${PROJECT_ID:-}"
  if [ -n "$hint" ]; then echo "$hint"; return; fi
  # Try newest context.json under .aoc/tasks anywhere in CWD subtree.
  local ctx
  ctx="$(find . -maxdepth 5 -type f -path '*/.aoc/tasks/*/context.json' 2>/dev/null | head -1 || true)"
  if [ -n "$ctx" ]; then
    python3 -c "import json,sys; print(json.load(open('$ctx')).get('projectId',''))"
    return
  fi
  echo ""
}

PROJECT_ID="\${PROJECT_ID:-$(resolve_project_id)}"
if [ -z "$PROJECT_ID" ]; then
  echo "project_memory: cannot resolve project id (set PROJECT_ID env or run inside a project workspace)" >&2
  exit 2
fi

CMD="\${1:-show}"
shift || true

api_get() {
  curl -sf -X GET "$AOC_URL$1" -H "Authorization: Bearer $AOC_TOKEN"
}
api_json() {
  local method="$1" path="$2" body="$3"
  curl -sf -X "$method" "$AOC_URL$path" \\
    -H "Authorization: Bearer $AOC_TOKEN" \\
    -H "Content-Type: application/json" \\
    -d "$body"
}

case "$CMD" in
  show)
    api_get "/api/projects/$PROJECT_ID/memory" | python3 -c "
import json, sys
d = json.load(sys.stdin)['items']
def section(label, items):
    if not items: return
    print(f'\\n## {label} ({len(items)})')
    for it in items:
        marker = '·'
        if it['kind'] == 'risk':
            sev = (it.get('meta') or {}).get('severity','?')
            cat = (it.get('meta') or {}).get('category','?')
            marker = f'[{cat}/{sev}]'
        title = it['title']
        body = (it.get('body') or '').strip().replace('\\n',' ')[:120]
        print(f'  {marker} ({it[\"id\"][:8]}) {title}')
        if body: print(f'      {body}')
decisions = [it for it in d if it['kind']=='decision'][:10]
questions = [it for it in d if it['kind']=='question' and it['status']=='open']
risks     = [it for it in d if it['kind']=='risk' and it['status']=='open']
glossary  = [it for it in d if it['kind']=='glossary']
section('Decisions (recent)', decisions)
section('Open questions', questions)
section('Open risks', risks)
section('Glossary', glossary)
if not (decisions or questions or risks or glossary):
    print('(empty)')
"
    ;;
  list)
    KIND="\${1:?kind required (decision|question|risk|glossary)}"
    STATUS="\${2:-}"
    QS="kind=$KIND"
    [ -n "$STATUS" ] && QS="$QS&status=$STATUS"
    api_get "/api/projects/$PROJECT_ID/memory?$QS"
    ;;
  add)
    KIND="\${1:?kind required}"
    TITLE="\${2:?title required}"
    BODY="\${3:-}"
    META='{}'
    if [ "$KIND" = "risk" ]; then
      CAT="\${4:-value}"
      SEV="\${5:-medium}"
      META="$(python3 -c "import json; print(json.dumps({'category':'$CAT','severity':'$SEV'}))")"
    fi
    export TITLE BODY META KIND
    PAYLOAD="$(python3 - <<PY
import json, os
print(json.dumps({
  "kind": os.environ["KIND"],
  "title": os.environ["TITLE"],
  "body": os.environ.get("BODY",""),
  "meta": json.loads(os.environ["META"]),
}))
PY
)"
    api_json POST "/api/projects/$PROJECT_ID/memory" "$PAYLOAD" | python3 -c "import json,sys; print(json.load(sys.stdin)['item']['id'])"
    ;;
  resolve|archive)
    ID="\${1:?id required}"
    NEW_STATUS="$([ "$CMD" = "resolve" ] && echo resolved || echo archived)"
    NOTE="\${2:-}"
    if [ -n "$NOTE" ] && [ "$CMD" = "resolve" ]; then
      # Pull current item to merge body with answer note (questions/risks).
      CUR="$(api_get "/api/projects/$PROJECT_ID/memory" | python3 -c "
import json,sys; d=json.load(sys.stdin)['items']
m=[it for it in d if it['id'].startswith('$ID')]
print(json.dumps(m[0] if m else {}))
")"
      if [ "$CUR" != "{}" ]; then
        REAL_ID="$(echo "$CUR" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")"
        export NOTE NEW_STATUS REAL_ID
        PAYLOAD="$(python3 -c "import json,os; print(json.dumps({'status': os.environ['NEW_STATUS'], 'meta': {'answer': os.environ['NOTE']}}))")"
        api_json PATCH "/api/memory/$REAL_ID" "$PAYLOAD" >/dev/null
        echo "ok $REAL_ID -> $NEW_STATUS"
        exit 0
      fi
    fi
    PAYLOAD="$(python3 -c "import json; print(json.dumps({'status':'$NEW_STATUS'}))")"
    api_json PATCH "/api/memory/$ID" "$PAYLOAD" >/dev/null
    echo "ok $ID -> $NEW_STATUS"
    ;;
  delete)
    ID="\${1:?id required}"
    curl -sf -X DELETE "$AOC_URL/api/memory/$ID" -H "Authorization: Bearer $AOC_TOKEN" >/dev/null
    echo "deleted $ID"
    ;;
  *)
    echo "Unknown command: $CMD" >&2
    echo "Usage: project_memory.sh show|list|add|resolve|archive|delete ..." >&2
    exit 2
    ;;
esac
`;

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
[ -f "\${OPENCLAW_WORKSPACE}/.aoc_agent_env" ] && source "\${OPENCLAW_WORKSPACE}/.aoc_agent_env"
[ -f "\${OPENCLAW_STATE_DIR}/workspace/.aoc_agent_env" ] && source "\${OPENCLAW_STATE_DIR}/workspace/.aoc_agent_env"

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
emit('CLONE_PATH', conn.get('clonePath', ''))
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
  CLONE_PATH="\${_C_CLONE_PATH:-}"

  # ── Cloned-mode (hybrid: remote source-of-truth + local working copy) ──
  # If the operator clicked "Copy to Local" on a remote connection, _C_CLONE_PATH
  # is set and the repo lives inside the tenant root. Route git ops there with
  # GIT_ASKPASS-based PAT injection (no token persisted to .git/config).
  # Rebase-first policy: pull.rebase=true was configured at clone time, so all
  # \`pull\` here implicitly rebases the local branch onto upstream — no merge
  # commits in normal sync flow.
  if [ -n "$CLONE_PATH" ] && [ -d "$CLONE_PATH/.git" ]; then
    # Build ephemeral GIT_ASKPASS helper that echoes the PAT. Token lives in
    # process env only; helper file is mode 0700 and removed on EXIT.
    if [ -n "\${_C_TOKEN:-}" ]; then
      _ASKPASS=$(mktemp /tmp/aoc-gh-askpass-XXXXXX)
      TMPFILES+=("$_ASKPASS")
      printf '#!/bin/sh\\necho "$GH_TOKEN"\\n' > "$_ASKPASS"
      chmod 0700 "$_ASKPASS"
      export GH_TOKEN="$_C_TOKEN"
      export GIT_ASKPASS="$_ASKPASS"
      export GIT_TERMINAL_PROMPT=0
    fi

    # Destructive-op guard: strip --force from any user-supplied ARGS, refuse
    # reset --hard (loses uncommitted work) and branch -D (deletes work).
    _CLEAN_ARGS=()
    _SAW_FORCE=0
    for a in "\${ARGS_ARRAY[@]:-}"; do
      case "$a" in
        --force|-f|--force-with-lease) _SAW_FORCE=1 ;;
        *) _CLEAN_ARGS+=("$a") ;;
      esac
    done

    case "$ACTION" in
      info)
        echo "=== Cloned repo: $CLONE_PATH ==="
        echo "Branch:   \$(git -C "$CLONE_PATH" branch --show-current 2>/dev/null || echo unknown)"
        echo "Remote:   \$(git -C "$CLONE_PATH" remote get-url origin 2>/dev/null || echo unknown)"
        echo ""
        echo "=== Last 5 commits ==="
        git -C "$CLONE_PATH" log -5 --format="%h %s (%an, %ar)" 2>&1
        echo ""
        echo "=== Working tree ==="
        git -C "$CLONE_PATH" status --short 2>&1 | head -30
        ;;
      log)
        N="\${_CLEAN_ARGS[0]:-20}"
        git -C "$CLONE_PATH" log -"$N" --format="%h %s (%an, %ar)" 2>&1
        ;;
      status)
        git -C "$CLONE_PATH" status 2>&1
        ;;
      branch)
        if [ -z "\${_CLEAN_ARGS[*]:-}" ]; then
          echo "=== Local branches ==="
          git -C "$CLONE_PATH" branch -v 2>&1
          echo ""
          echo "=== Remote branches ==="
          git -C "$CLONE_PATH" branch -rv 2>&1 | head -20
        else
          # Create + checkout new branch
          NEW="\${_CLEAN_ARGS[0]}"
          git -C "$CLONE_PATH" checkout -b "$NEW" 2>&1
        fi
        ;;
      checkout)
        REF="\${_CLEAN_ARGS[0]:?Usage: ... checkout <branch-or-ref>}"
        git -C "$CLONE_PATH" checkout "$REF" 2>&1
        ;;
      pull|sync)
        # pull.rebase=true was set at clone time, so this is effectively
        # 'git fetch && git rebase origin/<branch>'.
        git -C "$CLONE_PATH" fetch --prune 2>&1
        if [ "$ACTION" = "pull" ]; then
          git -C "$CLONE_PATH" pull --rebase 2>&1
        fi
        # Always show divergence summary at end
        echo ""
        echo "=== Divergence ==="
        CUR=\$(git -C "$CLONE_PATH" branch --show-current 2>/dev/null || echo HEAD)
        git -C "$CLONE_PATH" rev-list --left-right --count "origin/\${CUR}...HEAD" 2>/dev/null \\
          | awk '{print "  behind upstream: "$1"   ahead of upstream: "$2}'
        ;;
      diff)
        TARGET="\${_CLEAN_ARGS[0]:-}"
        if [ -n "$TARGET" ]; then
          git -C "$CLONE_PATH" diff "$TARGET" 2>&1 | head -300
        else
          git -C "$CLONE_PATH" diff 2>&1 | head -300
        fi
        ;;
      files)
        FILE_PATH="\${_CLEAN_ARGS[0]:-}"
        TARGET_PATH="$CLONE_PATH\${FILE_PATH:+/$FILE_PATH}"
        if [ -f "$TARGET_PATH" ]; then
          cat "$TARGET_PATH"
        elif [ -d "$TARGET_PATH" ]; then
          ls -la "$TARGET_PATH" | head -50
        else
          echo "ERROR: '$TARGET_PATH' not found"
          exit 1
        fi
        ;;
      commit)
        # Usage: commit "<msg>"  → git add -A then commit -m
        MSG="\${_CLEAN_ARGS[0]:?Usage: ... commit \\"<message>\\"}"
        git -C "$CLONE_PATH" add -A 2>&1
        git -C "$CLONE_PATH" commit -m "$MSG" 2>&1
        ;;
      commit-files)
        # Usage: commit-files <file1> <file2> ... <message>
        # Last arg is the message, prior are file paths.
        N=\${#_CLEAN_ARGS[@]}
        if [ "$N" -lt 2 ]; then
          echo "ERROR: Usage: ... commit-files <path1> [path2 ...] \\"<message>\\""
          exit 64
        fi
        MSG="\${_CLEAN_ARGS[\$((N-1))]}"
        FILES=("\${_CLEAN_ARGS[@]:0:\$((N-1))}")
        git -C "$CLONE_PATH" add -- "\${FILES[@]}" 2>&1
        git -C "$CLONE_PATH" commit -m "$MSG" 2>&1
        ;;
      push)
        if [ "$_SAW_FORCE" -eq 1 ]; then
          echo "ERROR: --force / --force-with-lease stripped. Push refused."
          echo "       Force-push to a shared remote is a hard-limit violation."
          echo "       If you really need it, the operator must do it manually outside this agent."
          exit 65
        fi
        TARGET_BRANCH="\${_CLEAN_ARGS[0]:-}"
        if [ -z "$TARGET_BRANCH" ]; then
          TARGET_BRANCH=\$(git -C "$CLONE_PATH" branch --show-current 2>/dev/null)
        fi
        git -C "$CLONE_PATH" push origin "$TARGET_BRANCH" 2>&1
        ;;
      rebase)
        # rebase <upstream> — rebase current branch onto upstream
        UPSTREAM="\${_CLEAN_ARGS[0]:?Usage: ... rebase <upstream-branch>}"
        git -C "$CLONE_PATH" fetch --prune 2>&1
        git -C "$CLONE_PATH" rebase "$UPSTREAM" 2>&1
        ;;
      reset)
        # Refuse --hard. Allow soft/mixed which preserve working tree.
        MODE="\${_CLEAN_ARGS[0]:-}"
        case "$MODE" in
          --hard|--keep)
            echo "ERROR: 'reset $MODE' refused — discards uncommitted work."
            echo "       Use 'commit' to save changes first, or 'checkout' to discard specific files."
            exit 65
            ;;
        esac
        git -C "$CLONE_PATH" reset "\${_CLEAN_ARGS[@]}" 2>&1
        ;;
      cherry-pick)
        SHA="\${_CLEAN_ARGS[0]:?Usage: ... cherry-pick <commit-sha>}"
        # Validate SHA exists locally; if not, fetch may be needed.
        if ! git -C "$CLONE_PATH" cat-file -e "\$SHA^{commit}" 2>/dev/null; then
          echo "Commit \$SHA not found locally; fetching all refs first..."
          git -C "$CLONE_PATH" fetch --all --prune 2>&1
          if ! git -C "$CLONE_PATH" cat-file -e "\$SHA^{commit}" 2>/dev/null; then
            echo "ERROR: commit \$SHA still not found after fetch. Wrong sha or wrong remote."
            exit 1
          fi
        fi
        # Check no rebase / cherry-pick in progress
        if [ -e "$CLONE_PATH/.git/CHERRY_PICK_HEAD" ] || [ -d "$CLONE_PATH/.git/rebase-merge" ] || [ -d "$CLONE_PATH/.git/rebase-apply" ]; then
          echo "ERROR: rebase or cherry-pick already in progress."
          echo "       Resolve with 'rebase-continue' / 'rebase-abort' / 'cherry-pick-continue' / 'cherry-pick-abort' first."
          exit 65
        fi
        git -C "$CLONE_PATH" cherry-pick "\$SHA" 2>&1
        RC=\$?
        if [ \$RC -ne 0 ]; then
          echo ""
          echo "Cherry-pick stopped due to conflict. Inspect with 'conflicts' / 'status'."
          echo "After resolving: stage files then run 'cherry-pick-continue' or 'cherry-pick-abort'."
        fi
        exit \$RC
        ;;
      cherry-pick-continue)
        # Stage user-resolved files first if requested.
        if [ -n "\${_CLEAN_ARGS[0]:-}" ]; then
          git -C "$CLONE_PATH" add -- "\${_CLEAN_ARGS[@]}" 2>&1
        fi
        git -C "$CLONE_PATH" cherry-pick --continue 2>&1
        ;;
      cherry-pick-abort)
        git -C "$CLONE_PATH" cherry-pick --abort 2>&1
        ;;
      rebase-abort)
        git -C "$CLONE_PATH" rebase --abort 2>&1
        ;;
      rebase-continue)
        if [ -n "\${_CLEAN_ARGS[0]:-}" ]; then
          git -C "$CLONE_PATH" add -- "\${_CLEAN_ARGS[@]}" 2>&1
        fi
        git -C "$CLONE_PATH" rebase --continue 2>&1
        ;;
      conflicts)
        # List files with unresolved conflicts. Empty stdout = clean tree.
        UNMERGED=\$(git -C "$CLONE_PATH" diff --name-only --diff-filter=U 2>/dev/null)
        if [ -z "$UNMERGED" ]; then
          echo "No unresolved conflicts."
        else
          echo "=== Unresolved conflicts ==="
          echo "$UNMERGED"
          echo ""
          echo "After fixing each file, stage with 'commit-files <f1>... \\"<msg>\\"' (if committing),"
          echo "or 'rebase-continue <f1>...' / 'cherry-pick-continue <f1>...' to resume the in-progress op."
        fi
        ;;
      stash)
        # Usage: stash ["<msg>"]
        MSG="\${_CLEAN_ARGS[0]:-aoc-agent stash @ \$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
        git -C "$CLONE_PATH" stash push -u -m "\$MSG" 2>&1
        ;;
      stash-pop)
        git -C "$CLONE_PATH" stash pop 2>&1
        ;;
      stash-list)
        git -C "$CLONE_PATH" stash list 2>&1
        ;;
      pr-create)
        # Usage: pr-create "<title>" "<body>" [base-branch]
        TITLE="\${_CLEAN_ARGS[0]:?Usage: ... pr-create \\"<title>\\" \\"<body>\\" [base-branch]}"
        BODY="\${_CLEAN_ARGS[1]:-}"
        BASE="\${_CLEAN_ARGS[2]:-\$BRANCH}"
        if [ -z "\${_C_TOKEN:-}" ]; then
          echo "ERROR: PR creation requires a PAT with 'repo' scope. Set PAT on the connection."
          exit 1
        fi
        export GH_TOKEN="$_C_TOKEN"
        CURRENT_BRANCH=\$(git -C "$CLONE_PATH" branch --show-current 2>/dev/null)
        if [ -z "\$CURRENT_BRANCH" ] || [ "\$CURRENT_BRANCH" = "\$BASE" ]; then
          echo "ERROR: cannot open PR — current branch is the base ('\$BASE') or detached HEAD."
          echo "       Create a feature branch first: 'branch <new-name>', commit, push, then pr-create."
          exit 1
        fi
        # Ensure pushed first (else PR points to a non-existent remote branch)
        if ! git -C "$CLONE_PATH" ls-remote --heads origin "\$CURRENT_BRANCH" 2>/dev/null | grep -q .; then
          echo "Branch '\$CURRENT_BRANCH' not yet on remote — pushing first..."
          _AP=\$(mktemp /tmp/aoc-gh-askpass-XXXXXX); TMPFILES+=("\$_AP")
          printf '#!/bin/sh\\necho "$GH_TOKEN"\\n' > "\$_AP"; chmod 0700 "\$_AP"
          GIT_ASKPASS="\$_AP" git -C "$CLONE_PATH" push -u origin "\$CURRENT_BRANCH" 2>&1
        fi
        REPO_URL=\$(git -C "$CLONE_PATH" remote get-url origin 2>/dev/null | sed -E 's|.*github.com[:/]([^/]+/[^/.]+)(\\.git)?$|\\1|')
        gh pr create --repo "\$REPO_URL" --base "\$BASE" --head "\$CURRENT_BRANCH" --title "\$TITLE" --body "\$BODY" 2>&1
        RC=\$?
        if [ \$RC -ne 0 ]; then
          echo ""
          echo "Tip: if 'GraphQL: ... must have admin rights' — PAT scope insufficient. Need 'repo' (private) or 'public_repo' (public)."
        fi
        exit \$RC
        ;;
      remote)
        git -C "$CLONE_PATH" remote -v 2>&1
        ;;
      *)
        echo "ERROR: Unknown github cloned action '$ACTION'"
        echo "Supported (cloned mode):"
        echo "  info, status, log [n], branch [new-name], checkout <ref>"
        echo "  diff [target], files [path]"
        echo "  pull, sync                       — fetch + rebase (pull) / fetch only (sync)"
        echo "  commit \\"<msg>\\"                   — git add -A then commit"
        echo "  commit-files <f1>... \\"<msg>\\"      — stage specific files then commit"
        echo "  push [branch]                    — push to origin (no --force allowed)"
        echo "  rebase <upstream>                — rebase current onto upstream"
        echo "  reset [--soft|--mixed]           — soft/mixed only; --hard refused"
        echo "  cherry-pick <sha>                — bring commit onto current branch"
        echo "  cherry-pick-continue [files...]  — resume after resolving conflicts"
        echo "  cherry-pick-abort                — discard in-progress cherry-pick"
        echo "  rebase-continue [files...]       — resume rebase after fixing conflicts"
        echo "  rebase-abort                     — discard in-progress rebase"
        echo "  conflicts                        — list unresolved conflict files"
        echo "  stash [\\"msg\\"]                    — git stash push -u"
        echo "  stash-pop, stash-list            — restore / list stashes"
        echo "  pr-create \\"<title>\\" \\"<body>\\" [base]  — open PR via gh CLI (needs PAT 'repo' scope)"
        exit 1
        ;;
    esac
    exit 0
  fi

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

function ensureAocConnectScript() { /* moved to aoc-connections skill */ }

// ── mcp-call.sh — Thin client for AOC's MCP proxy ───────────────────────────

const MCP_CALL_SCRIPT_NAME = 'mcp-call.sh';
const MCP_CALL_SCRIPT_CONTENT = `#!/usr/bin/env bash
# mcp-call — Invoke an MCP (Model Context Protocol) server tool via AOC Dashboard
# AOC spawns + manages the MCP child process server-side; this script only
# forwards the call. Credentials never appear on the agent side.
#
# Usage:
#   mcp-call.sh <connection-name> --list-tools
#   mcp-call.sh <connection-name> <tool-name> ['<json-args>']
#
# Examples:
#   mcp-call.sh "GitHub MCP" --list-tools
#   mcp-call.sh "GitHub MCP" create_issue '{"owner":"foo","repo":"bar","title":"..."}'
#   mcp-call.sh "Filesystem" list_directory '{"path":"/tmp"}'

set -euo pipefail

source "\${OPENCLAW_HOME:-$HOME/.openclaw}/.aoc_env"
[ -f "$PWD/.aoc_agent_env" ] && source "$PWD/.aoc_agent_env"
[ -f "\${OPENCLAW_WORKSPACE}/.aoc_agent_env" ] && source "\${OPENCLAW_WORKSPACE}/.aoc_agent_env"
[ -f "\${OPENCLAW_STATE_DIR}/workspace/.aoc_agent_env" ] && source "\${OPENCLAW_STATE_DIR}/workspace/.aoc_agent_env"

CONN_NAME="\${1:?Usage: mcp-call.sh <connection-name> <tool-name|--list-tools> [json-args]}"
TOOL_NAME="\${2:?Usage: mcp-call.sh <connection-name> <tool-name|--list-tools> [json-args]}"
JSON_ARGS="\${3:-{\\}}"

[ -z "\${AOC_TOKEN:-}" ] && { echo "ERROR: AOC_TOKEN not configured" >&2; exit 1; }
[ -z "\${AOC_AGENT_ID:-}" ] && { echo "ERROR: AOC_AGENT_ID not configured" >&2; exit 1; }

# Validate JSON args (skip for --list-tools)
if [ "$TOOL_NAME" != "--list-tools" ] && [ "$TOOL_NAME" != "__list__" ]; then
  if ! echo "$JSON_ARGS" | python3 -c 'import sys,json; json.load(sys.stdin)' 2>/dev/null; then
    echo "ERROR: args must be valid JSON, got: $JSON_ARGS" >&2
    exit 2
  fi
fi

# Build request body (export must come before the subshell so python sees the vars)
export CONN_NAME TOOL_NAME JSON_ARGS
REQ_BODY=$(python3 <<'EOF'
import json, os
body = {
  "connectionName": os.environ["CONN_NAME"],
  "tool": os.environ["TOOL_NAME"],
}
tool = os.environ["TOOL_NAME"]
if tool not in ("--list-tools", "__list__"):
  try:
    body["args"] = json.loads(os.environ.get("JSON_ARGS") or "{}")
  except Exception:
    body["args"] = {}
print(json.dumps(body))
EOF
)

RESP=$(curl -s -X POST "$AOC_URL/api/mcp/call" \\
  -H "Authorization: Bearer $AOC_TOKEN" \\
  -H "X-AOC-Agent-Id: $AOC_AGENT_ID" \\
  -H "Content-Type: application/json" \\
  -d "$REQ_BODY")

# Pretty-print response; if it's not JSON just dump raw
if echo "$RESP" | python3 -c 'import sys,json; json.load(sys.stdin)' >/dev/null 2>&1; then
  echo "$RESP" | python3 -m json.tool
else
  echo "$RESP"
fi
`;

function ensureMcpCallScript() { /* moved to aoc-connections skill */ }

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
  mcp: {
    label: 'MCP Servers',
    actions: [
      '`mcp-call.sh "<name>" --list-tools`                — list available tools',
      '`mcp-call.sh "<name>" <tool-name> \'{"arg":"val"}\'` — invoke a tool',
    ],
  },
  composio: {
    label: 'Composio (100+ SaaS toolkits)',
    actions: [
      '`mcp-call.sh "<name>" --list-tools`                            — see meta-tools (SEARCH, EXECUTE, MANAGE_CONNECTIONS, ...)',
      '`mcp-call.sh "<name>" COMPOSIO_SEARCH_TOOLS \'{"use_case":"send email"}\'`',
      '`mcp-call.sh "<name>" COMPOSIO_MULTI_EXECUTE_TOOL \'{"tool_name":"GMAIL_SEND_EMAIL","arguments":{...}}\'`',
      'If a tool needs auth, the response gives a Connect Link the user opens to authorize.',
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

  // Hybrid mode: remote connection with local clone (post "Copy to Local").
  // Full git ops via aoc-connect.sh, rebase-first policy enforced.
  if (mode === 'remote' && meta.clonePath) {
    const repo = `${meta.repoOwner || '?'}/${meta.repoName || '?'}`;
    lines.push(`**"${name}"** — remote \`${repo}\` cloned to \`${meta.clonePath}\` (branch: \`${branch}\`)`);
    lines.push('');
    lines.push(`  Rebase-first workflow: \`pull.rebase=true\` is configured, so \`pull\` rebases instead of merging.`);
    lines.push('');
    lines.push(`  \`aoc-connect.sh "${name}" info\`                  — branch, recent commits, working tree`);
    lines.push(`  \`aoc-connect.sh "${name}" status\`                — git status`);
    lines.push(`  \`aoc-connect.sh "${name}" log [n]\`                — recent commits`);
    lines.push(`  \`aoc-connect.sh "${name}" diff [target]\`          — diff vs target (default working tree)`);
    lines.push(`  \`aoc-connect.sh "${name}" files [path]\`           — cat file or ls dir inside clone`);
    lines.push(`  \`aoc-connect.sh "${name}" branch\`                 — list branches`);
    lines.push(`  \`aoc-connect.sh "${name}" branch <name>\`          — create + checkout new branch`);
    lines.push(`  \`aoc-connect.sh "${name}" checkout <ref>\`         — switch branch / commit`);
    lines.push(`  \`aoc-connect.sh "${name}" sync\`                   — fetch + show divergence`);
    lines.push(`  \`aoc-connect.sh "${name}" pull\`                   — fetch + rebase onto upstream`);
    lines.push(`  \`aoc-connect.sh "${name}" commit "<msg>"\`         — add -A then commit`);
    lines.push(`  \`aoc-connect.sh "${name}" commit-files <f1>... "<msg>"\` — stage specific files then commit`);
    lines.push(`  \`aoc-connect.sh "${name}" push [branch]\`          — push to origin (no --force allowed)`);
    lines.push(`  \`aoc-connect.sh "${name}" rebase <upstream>\`      — rebase current onto upstream branch`);
    lines.push(`  \`aoc-connect.sh "${name}" cherry-pick <sha>\`      — bring a commit onto current branch`);
    lines.push(`  \`aoc-connect.sh "${name}" rebase-continue [files...]\`  — resume rebase after resolving conflicts`);
    lines.push(`  \`aoc-connect.sh "${name}" rebase-abort\`           — discard in-progress rebase`);
    lines.push(`  \`aoc-connect.sh "${name}" cherry-pick-continue\` / \`cherry-pick-abort\``);
    lines.push(`  \`aoc-connect.sh "${name}" conflicts\`              — list unresolved conflict files`);
    lines.push(`  \`aoc-connect.sh "${name}" stash ["msg"]\` / \`stash-pop\` / \`stash-list\``);
    lines.push(`  \`aoc-connect.sh "${name}" pr-create "<title>" "<body>" [base]\`  — open PR (needs PAT 'repo' scope)`);
    lines.push('');
    lines.push(`  **Rebase-first rule:** integrate other branches via \`rebase\` or \`cherry-pick\`, NOT \`merge\`. Avoid merge commits.`);
    lines.push(`  **No force:** push --force / reset --hard are refused. Persistence after data loss is intentional.`);
    lines.push(`  **Conflict workflow:** if rebase/cherry-pick reports conflict — run \`conflicts\` to see files, fix them, then \`<op>-continue <files...>\` or \`<op>-abort\`.`);
    return lines;
  }

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

// ─── Agent built-in script auto-injection ────────────────────────────────────
//
// Reconciles which AOC built-in scripts should be active in the agent's
// TOOLS.md based on its current state (assigned connections, enabled skills).
// Replaces the old pattern of per-script manual toggles for built-ins.
//
// Inputs:
//   agentId        — id of the agent
//   ctx.connections — array of connection objects assigned to agent (each has .type)
//   ctx.skills     — array of enabled skill names (strings) for the agent
//   getAgentFileFn — (id, filename) => { content }
//   saveAgentFileFn — (id, filename, content) => void
//
// Idempotent. Toggles each built-in on/off via the existing custom-tool block
// machinery so descriptions stay current.
function syncAgentBuiltins(agentId, ctx, getAgentFileFn, saveAgentFileFn) {
  const connectionTypes = new Set((ctx?.connections || []).map(c => c?.type).filter(Boolean));
  const enabledSkills   = new Set(ctx?.skills || []);

  // Clean up custom-tool blocks for scripts that no longer live as flat shared
  // scripts (they migrated into a skill folder). The skill's SKILL.md teaches
  // the agent about them now, so the TOOLS.md block is just stale noise.
  for (const stale of LEGACY_FLAT_SCRIPTS_MOVED_TO_SKILLS) {
    try {
      toggleAgentCustomTool(agentId, stale, false, 'shared', getAgentFileFn, saveAgentFileFn);
    } catch {}
  }

  for (const [filename, info] of Object.entries(BUILTIN_SCRIPT_MANIFEST)) {
    let shouldEnable = false;
    if (info.trigger === 'always') {
      shouldEnable = true;
    } else if (info.trigger === 'connection-type') {
      shouldEnable = (info.types || []).some(t => connectionTypes.has(t));
    } else if (info.trigger === 'skill') {
      shouldEnable = enabledSkills.has(info.skill);
    }

    try {
      // Force re-inject when enabled so descriptions stay fresh.
      toggleAgentCustomTool(agentId, filename, false, 'shared', getAgentFileFn, saveAgentFileFn);
      if (shouldEnable) {
        toggleAgentCustomTool(agentId, filename, true, 'shared', getAgentFileFn, saveAgentFileFn);
      }
    } catch (e) {
      // Built-in script may not be installed yet (e.g. browser-uat slot before
      // bundle install). Silently skip — next sync after install will pick up.
      if (e?.status !== 404) {
        console.warn(`[builtins] sync ${agentId}/${filename}:`, e.message);
      }
    }
  }
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
  ensureMcpCallScript,
  ensureFetchAttachmentScript,
  ensureSaveOutputScript,
  ensurePostCommentScript,
  injectHeartbeatTaskCheck,
  // ADLC shared scripts installer
  ensureSharedAdlcScripts,
  // Connection context injector
  syncAgentConnectionsContext,
  // Built-in stamping + auto-injection
  stampBuiltinSharedMeta,
  syncAgentBuiltins,
  isBuiltinShared,
  purgeLegacyFlatScripts,
  BUILTIN_SCRIPT_MANIFEST,
  // Script content constants (consumed by skill bundles)
  UPDATE_TASK_SCRIPT_CONTENT,
  CHECK_TASKS_SCRIPT_CONTENT,
  FETCH_ATTACHMENT_SCRIPT_CONTENT,
  SAVE_OUTPUT_SCRIPT_CONTENT,
  POST_COMMENT_SCRIPT_CONTENT,
  PROJECT_MEMORY_SCRIPT_NAME,
  PROJECT_MEMORY_SCRIPT_CONTENT,
  AOC_CONNECT_SCRIPT_CONTENT,
  CHECK_CONNECTIONS_SCRIPT_CONTENT,
  MCP_CALL_SCRIPT_CONTENT,
  GWS_CALL_SCRIPT_CONTENT,
  SCRIPTS_DIR, ALLOWED_EXT,
};
