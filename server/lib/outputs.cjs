// server/lib/outputs.cjs
// Agent-produced output files, keyed by task.
// Convention: `{agentWorkspace}/outputs/{taskId}/` — one folder per task.
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const { OPENCLAW_HOME, OPENCLAW_WORKSPACE, readJsonSafe } = require('./config.cjs');

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

/** Resolve an agent's workspace directory, honoring ~ and env defaults. */
function getAgentWorkspacePath(agentId) {
  const cfg = readJsonSafe(path.join(OPENCLAW_HOME, 'openclaw.json')) || {};
  const agent = (cfg.agents?.list || []).find(a => a.id === agentId);
  return expandHome(agent?.workspace || OPENCLAW_WORKSPACE);
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
  MIME_BY_EXT,
};
