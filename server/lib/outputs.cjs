// server/lib/outputs.cjs
// Agent-produced output files, keyed by task.
// Convention: `{agentWorkspace}/outputs/{taskId}/` — one folder per task.
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const { OPENCLAW_HOME, OPENCLAW_WORKSPACE, getUserHome, readJsonSafe } = require('./config.cjs');

// Multi-tenant aware: an agent owned by a non-admin user lives under
// `<userHome>/.openclaw/{agents,workspace,...}`, not under the admin's
// `~/.openclaw`. Without this lookup the chat-outputs API would always
// resolve to the admin workspace and return [] for every tenant agent.
let _dbModule = null;
function _getOwner(agentId) {
  if (!_dbModule) {
    try { _dbModule = require('./db.cjs'); } catch { _dbModule = {}; }
  }
  try { return _dbModule.getAgentOwner ? _dbModule.getAgentOwner(agentId) : null; }
  catch { return null; }
}
function _homeFor(agentId) {
  const owner = _getOwner(agentId);
  return owner == null || owner === 1 ? OPENCLAW_HOME : getUserHome(owner);
}
function _defaultWorkspaceFor(agentId) {
  const owner = _getOwner(agentId);
  return owner == null || owner === 1
    ? OPENCLAW_WORKSPACE
    : path.join(getUserHome(owner), 'workspace');
}

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip', '.tar': 'application/x-tar', '.gz': 'application/gzip',
  '.txt': 'text/plain', '.csv': 'text/csv', '.json': 'application/json',
  '.md': 'text/markdown', '.html': 'text/html', '.xml': 'application/xml',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
};

function expandHome(p) {
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  return (p || '').replace(/^~/, home);
}

/** Resolve an agent's workspace directory, multitenant-aware. Reads the
 *  *correct* `openclaw.json` based on the agent's owner so we don't always
 *  land in the admin workspace for tenant agents. */
function getAgentWorkspacePath(agentId) {
  const home = _homeFor(agentId);
  const cfg = readJsonSafe(path.join(home, 'openclaw.json')) || {};
  const agent = (cfg.agents?.list || []).find(a => a.id === agentId);
  const fallback = cfg.agents?.defaults?.workspace || _defaultWorkspaceFor(agentId);
  return expandHome(agent?.workspace || fallback);
}

/** Sanitize a task id before using it as a directory component. */
function safeTaskId(taskId) {
  const clean = String(taskId || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!clean) throw new Error('Invalid taskId');
  return clean;
}

function outputsRoot(agentId) {
  return path.join(getAgentWorkspacePath(agentId), 'outputs');
}

function outputsDir(agentId, taskId) {
  return path.join(outputsRoot(agentId), safeTaskId(taskId));
}

/** Ensure the task's output folder exists. Returns the absolute path. */
function ensureOutputsDir(agentId, taskId) {
  const dir = outputsDir(agentId, taskId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * List output files for a task. Returns [] if the folder doesn't exist.
 * Each entry: { filename, size, mtime, mimeType, ext, isText }
 */
function listOutputs(agentId, taskId) {
  if (!agentId || !taskId) return [];
  const dir = outputsDir(agentId, taskId);
  if (!fs.existsSync(dir)) return [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return []; }

  const out = [];
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    if (ent.name.startsWith('.')) continue; // skip dotfiles (.DS_Store, etc.)
    const full = path.join(dir, ent.name);
    let stat;
    try { stat = fs.statSync(full); } catch { continue; }
    const ext = path.extname(ent.name).toLowerCase();
    const mimeType = MIME_BY_EXT[ext] || 'application/octet-stream';
    out.push({
      filename: ent.name,
      size: stat.size,
      mtime: stat.mtime.toISOString(),
      ctime: stat.birthtime ? stat.birthtime.toISOString() : stat.ctime.toISOString(),
      mimeType,
      ext,
      isText: /^text\//.test(mimeType) || mimeType === 'application/json' || mimeType === 'application/xml',
    });
  }
  out.sort((a, b) => b.mtime.localeCompare(a.mtime)); // newest first
  return out;
}

// ── Chat-session outputs ─────────────────────────────────────────────────────
//
// Single-user → agent chats don't have a `taskId`, so the per-task convention
// above doesn't apply. The convention we DO want for chat is simpler:
//
//   - The agent saves shareable artifacts to `<workspace>/outputs/...`.
//     They MAY group under `outputs/<descriptive-slug>/` — anything below
//     `outputs/` is fair game and walked recursively.
//   - We scope the listing to a session by mtime: only files modified at or
//     after the chat session started are surfaced. That gives a reliable
//     "what came out of this conversation" view even if the agent groups
//     files into subfolders or names them inconsistently.
//   - As a transitional/legacy fallback (the agent hasn't always followed
//     the convention) we ALSO include files at the workspace root or in
//     non-standard top-level folders that were modified during the session,
//     skipping known infra (`memory/`, `skills/`, `state/`, `.agents/`,
//     `.openclaw/`) and standard prompt files (AGENTS.md, TOOLS.md, etc.).
//     Those legacy hits get flagged `outOfConvention: true` so the UI can
//     nudge users.

const STANDARD_PROMPT_FILES = new Set([
  'AGENTS.md', 'TOOLS.md', 'IDENTITY.md', 'MEMORY.md', 'SOUL.md',
  'USER.md', 'HEARTBEAT.md',
]);
// Top-level workspace dirs that hold infra, NOT user-visible artifacts.
const INFRA_DIRS = new Set([
  'memory', 'skills', 'state', '.agents', '.openclaw', '.aoc', 'node_modules', '.git',
]);
// Hard cap so a runaway agent that wrote 10k files doesn't OOM the API.
const MAX_FILES = 200;
// Some agents flush slightly before they finish writing; allow a tiny
// negative window so we still catch files whose mtime got stamped just
// before the session lifecycle event arrived.
const SESSION_START_GRACE_MS = 30_000;

function fileEntry(absPath, relPath) {
  let stat;
  try { stat = fs.statSync(absPath); } catch { return null; }
  if (!stat.isFile()) return null;
  const ext = path.extname(relPath).toLowerCase();
  const mimeType = MIME_BY_EXT[ext] || 'application/octet-stream';
  return {
    relPath,
    name: path.basename(relPath),
    size: stat.size,
    mtime: stat.mtime.toISOString(),
    mtimeMs: stat.mtime.getTime(),
    mimeType,
    ext,
    isText: /^text\//.test(mimeType) || mimeType === 'application/json' || mimeType === 'application/xml',
  };
}

// Yields every file under `root` (recursive). Skips dotfiles + dotdirs unless
// `includeDotFiles=true`. Returns relative-to-root paths (POSIX-style).
function* walkFiles(root, { includeDotFiles = false } = {}) {
  if (!fs.existsSync(root)) return;
  const stack = [{ abs: root, rel: '' }];
  while (stack.length) {
    const { abs, rel } = stack.pop();
    let entries;
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { continue; }
    for (const ent of entries) {
      if (!includeDotFiles && ent.name.startsWith('.')) continue;
      const childAbs = path.join(abs, ent.name);
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        stack.push({ abs: childAbs, rel: childRel });
      } else if (ent.isFile()) {
        yield { abs: childAbs, rel: childRel };
      }
    }
  }
}

/**
 * List a chat session's "outputs" view.
 *
 * @param {string} agentId
 * @param {object} opts
 * @param {number} [opts.sinceMs] — epoch ms; files older than this are skipped.
 *   When omitted, returns everything (still capped by MAX_FILES).
 * @returns {{
 *   workspace: string,
 *   outputsRoot: string,
 *   sinceMs: number | null,
 *   files: Array<file & { source: 'outputs' | 'legacy', outOfConvention: boolean }>,
 *   truncated: boolean,
 * }}
 */
function listChatOutputs(agentId, { sinceMs = null } = {}) {
  const workspace = getAgentWorkspacePath(agentId);
  const root = outputsRoot(agentId);
  const cutoff = (typeof sinceMs === 'number' && Number.isFinite(sinceMs))
    ? Math.max(0, sinceMs - SESSION_START_GRACE_MS)
    : null;

  const out = [];
  let truncated = false;

  // 1. Convention path: walk `<workspace>/outputs/` recursively.
  for (const { abs, rel } of walkFiles(root)) {
    if (out.length >= MAX_FILES) { truncated = true; break; }
    const fe = fileEntry(abs, `outputs/${rel}`);
    if (!fe) continue;
    if (cutoff != null && fe.mtimeMs < cutoff) continue;
    out.push({ ...fe, source: 'outputs', outOfConvention: false });
  }

  // 2. Legacy path: also pick up files written outside `outputs/` so the user
  //    can still see artifacts produced by an older session before the
  //    convention was enforced. We walk the workspace root one level deep
  //    (loose top-level files) plus any non-infra subdir.
  if (!truncated) {
    let entries;
    try { entries = fs.readdirSync(workspace, { withFileTypes: true }); } catch { entries = []; }
    for (const ent of entries) {
      if (out.length >= MAX_FILES) { truncated = true; break; }
      if (ent.name.startsWith('.')) continue;
      const childAbs = path.join(workspace, ent.name);
      if (ent.isFile()) {
        if (STANDARD_PROMPT_FILES.has(ent.name)) continue;
        const fe = fileEntry(childAbs, ent.name);
        if (!fe) continue;
        if (cutoff != null && fe.mtimeMs < cutoff) continue;
        out.push({ ...fe, source: 'legacy', outOfConvention: true });
        continue;
      }
      if (!ent.isDirectory()) continue;
      // Skip infra + the conventional outputs dir (already walked above).
      if (INFRA_DIRS.has(ent.name) || ent.name === 'outputs') continue;
      // Walk this rogue dir — these are the `product_sync_audit/` style
      // folders the agent shouldn't have created at workspace root.
      for (const child of walkFiles(childAbs)) {
        if (out.length >= MAX_FILES) { truncated = true; break; }
        const fe = fileEntry(child.abs, `${ent.name}/${child.rel}`);
        if (!fe) continue;
        if (cutoff != null && fe.mtimeMs < cutoff) continue;
        out.push({ ...fe, source: 'legacy', outOfConvention: true });
      }
      if (truncated) break;
    }
  }

  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return { workspace, outputsRoot: root, sinceMs: cutoff, files: out, truncated };
}

/**
 * Resolve a chat-output file by relative path (POSIX). Refuses any path that
 * escapes the agent's workspace via `..` or absolute components.
 */
function resolveChatOutputFile(agentId, relPath) {
  if (!relPath || typeof relPath !== 'string') return null;
  if (relPath.startsWith('/') || relPath.includes('..')) return null;
  const workspace = getAgentWorkspacePath(agentId);
  const abs = path.resolve(workspace, relPath);
  const root = path.resolve(workspace) + path.sep;
  if (!abs.startsWith(root)) return null;
  if (!fs.existsSync(abs)) return null;
  let stat;
  try { stat = fs.statSync(abs); } catch { return null; }
  if (!stat.isFile()) return null;
  const ext = path.extname(relPath).toLowerCase();
  return {
    absPath: abs,
    filename: path.basename(relPath),
    relPath,
    size: stat.size,
    mtime: stat.mtime.toISOString(),
    mimeType: MIME_BY_EXT[ext] || 'application/octet-stream',
  };
}

/** Resolve an output file path. Returns null if it doesn't exist or escapes the task dir. */
function resolveOutputFile(agentId, taskId, filename) {
  if (!filename || filename.includes('/') || filename.includes('\\') || filename.startsWith('.')) return null;
  const dir = outputsDir(agentId, taskId);
  const abs = path.resolve(dir, filename);
  if (!abs.startsWith(path.resolve(dir) + path.sep)) return null; // defense in depth
  if (!fs.existsSync(abs)) return null;
  let stat;
  try { stat = fs.statSync(abs); } catch { return null; }
  if (!stat.isFile()) return null;
  const ext = path.extname(filename).toLowerCase();
  return {
    absPath: abs,
    filename,
    size: stat.size,
    mtime: stat.mtime.toISOString(),
    mimeType: MIME_BY_EXT[ext] || 'application/octet-stream',
  };
}

module.exports = {
  ensureOutputsDir,
  listOutputs,
  resolveOutputFile,
  outputsDir,
  outputsRoot,
  getAgentWorkspacePath,
  listChatOutputs,
  resolveChatOutputFile,
  MIME_BY_EXT,
};
