'use strict';
/**
 * workspace-browser — Read-only file system access to an agent's workspace.
 *
 * Used by the Agent Files → Browse mode in the dashboard. Strict path-traversal
 * guard: every request is resolved against the agent's workspace root, and any
 * path that escapes is rejected with 403.
 *
 * Two operations:
 *   - tree(agentId, relPath)   → list of { name, type, size, mtime, ext }
 *   - readFile(agentId, relPath) → { mode: 'text', content, ... } for small text,
 *                                  { mode: 'binary', stream, contentType, size } for binary
 */
const fs = require('fs');
const path = require('path');
const { OPENCLAW_HOME, OPENCLAW_WORKSPACE, getUserHome, readJsonSafe } = require('./config.cjs');

// ── Multi-tenant home resolution ─────────────────────────────────────────────

function _ownerOf(agentId) {
  try {
    const owner = require('./db.cjs').getAgentOwner(agentId);
    return owner == null ? null : Number(owner);
  } catch { return null; }
}
function homeFor(agentId) {
  const o = _ownerOf(agentId);
  return o == null || o === 1 ? OPENCLAW_HOME : getUserHome(o);
}
function workspaceFor(agentId) {
  const o = _ownerOf(agentId);
  return o == null || o === 1 ? OPENCLAW_WORKSPACE : path.join(getUserHome(o), 'workspace');
}

const TEXT_EXTS = new Set([
  '.md', '.markdown', '.txt', '.log', '.csv', '.tsv',
  '.json', '.jsonl', '.yml', '.yaml', '.toml', '.xml',
  '.sh', '.bash', '.zsh', '.fish', '.py', '.js', '.ts',
  '.tsx', '.jsx', '.rb', '.lua', '.go', '.rs', '.java',
  '.kt', '.swift', '.c', '.cpp', '.h', '.hpp', '.cs',
  '.css', '.scss', '.html', '.htm', '.svg', '.env',
  '.gitignore', '.dockerignore',
]);

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico']);

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.html': 'text/html',
};

const TEXT_MAX_BYTES   = 5 * 1024 * 1024;   // 5 MB inline text
const BINARY_MAX_BYTES = 50 * 1024 * 1024;  // 50 MB max binary stream

function getAgentWorkspaceRoot(agentId) {
  const home = homeFor(agentId);
  const cfg = readJsonSafe(path.join(home, 'openclaw.json'));
  if (!cfg) throw httpErr(500, 'openclaw.json missing');
  const agent = (cfg.agents?.list || []).find(a => a.id === agentId);
  if (!agent) throw httpErr(404, `Agent "${agentId}" not found`);
  const ws = agent.workspace || cfg.agents?.defaults?.workspace || workspaceFor(agentId);
  const expanded = ws.replace(/^~/, process.env.HOME || '~');
  return path.resolve(expanded);
}

function httpErr(status, msg) {
  const e = new Error(msg);
  e.status = status;
  return e;
}

/** Resolve a user-provided relative path against the agent's workspace root.
 *  Throws 403 on traversal, 404 when target doesn't exist. */
function resolveSafe(agentId, relPath) {
  const root = getAgentWorkspaceRoot(agentId);
  // Normalize: strip leading slashes, decode URI-style encoded paths
  let rel = String(relPath || '').replace(/^\/+/, '');
  // Reject explicit traversal attempts upfront
  if (rel.split(/[/\\]/).some(seg => seg === '..')) {
    throw httpErr(403, 'Path traversal not allowed');
  }
  const target = path.resolve(root, rel);
  // Belt + suspenders — even after the .. check, ensure resolved path is within root
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw httpErr(403, 'Path escapes workspace');
  }
  return { root, target };
}

function extOf(name) {
  return path.extname(name).toLowerCase();
}

/** List immediate children of a directory under the agent workspace.
 *  Skips entries that error out (e.g. broken symlinks). */
function tree(agentId, relPath = '') {
  const { root, target } = resolveSafe(agentId, relPath);
  let stat;
  try { stat = fs.lstatSync(target); }
  catch { throw httpErr(404, 'Path not found'); }

  if (stat.isSymbolicLink()) {
    // Refuse to traverse symlinks for safety
    throw httpErr(403, 'Symlinks are not browsed');
  }
  if (!stat.isDirectory()) throw httpErr(400, 'Not a directory');

  const entries = [];
  for (const name of fs.readdirSync(target)) {
    const full = path.join(target, name);
    let s;
    try { s = fs.lstatSync(full); } catch { continue; }
    // Skip symlinks (don't traverse into them, don't expose them)
    if (s.isSymbolicLink()) continue;
    const ext = extOf(name);
    entries.push({
      name,
      type: s.isDirectory() ? 'dir' : 'file',
      size: s.size,
      mtime: s.mtime.toISOString(),
      ext,
      hidden: name.startsWith('.'),
      previewable: s.isDirectory() ? null : (TEXT_EXTS.has(ext) ? 'text' : (IMAGE_EXTS.has(ext) ? 'image' : 'binary')),
    });
  }
  // Dirs first, then files, both alphabetical
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const relRoot = path.relative(root, target).replace(/\\/g, '/');
  return {
    path: relRoot,
    parent: relRoot === '' ? null : path.posix.dirname(relRoot === '' ? '' : relRoot),
    workspaceRoot: root,
    entries,
  };
}

/** Read a file under the agent workspace.
 *  Returns either { mode: 'text', content, ... } or { mode: 'binary', filePath, contentType, size } so the route handler can pick stream vs json. */
function readFileMeta(agentId, relPath) {
  const { target } = resolveSafe(agentId, relPath);
  let stat;
  try { stat = fs.lstatSync(target); }
  catch { throw httpErr(404, 'File not found'); }
  if (stat.isSymbolicLink()) throw httpErr(403, 'Symlinks are not served');
  if (!stat.isFile()) throw httpErr(400, 'Not a regular file');

  const ext = extOf(relPath);
  const isText = TEXT_EXTS.has(ext);
  const isImage = IMAGE_EXTS.has(ext);
  const contentType = MIME_BY_EXT[ext] || (isText ? 'text/plain; charset=utf-8' : 'application/octet-stream');

  return {
    mode: isText ? 'text' : 'binary',
    filePath: target,
    size: stat.size,
    mtime: stat.mtime.toISOString(),
    ext,
    isImage,
    contentType,
    textCap: TEXT_MAX_BYTES,
    binaryCap: BINARY_MAX_BYTES,
  };
}

/** Convenience for routes that want JSON for text (with size cap) or
 *  fall through to streaming via meta.filePath for binaries. */
function readTextIfSmall(agentId, relPath) {
  const meta = readFileMeta(agentId, relPath);
  if (meta.mode !== 'text') return { ...meta, content: null, oversize: false };
  if (meta.size > meta.textCap) return { ...meta, content: null, oversize: true };
  const content = fs.readFileSync(meta.filePath, 'utf-8');
  return { ...meta, content, oversize: false };
}

module.exports = {
  tree,
  readFileMeta,
  readTextIfSmall,
  TEXT_EXTS,
  IMAGE_EXTS,
};
