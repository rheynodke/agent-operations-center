// server/lib/attachments.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.AOC_DATA_DIR || path.join(__dirname, '..', '..', 'data');
const ATTACHMENTS_DIR = path.join(DATA_DIR, 'attachments');

const MAX_SIZE = 25 * 1024 * 1024;
const MAX_PER_TASK = 10;

const ALLOWED_EXT = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp',
  '.pdf',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.zip', '.tar', '.gz',
  '.txt', '.csv', '.json', '.md', '.log',
  '.mp4', '.mov', '.mp3', '.wav',
]);

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
  '.md': 'text/markdown', '.log': 'text/plain',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
};

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function sanitizeFilename(name) {
  // Keep basename only, strip path separators + control chars, collapse whitespace
  const base = path.basename(String(name || 'attachment'));
  return base.replace(/[\x00-\x1f<>:"/\\|?*]+/g, '_').replace(/\s+/g, '_').slice(0, 200) || 'attachment';
}

function taskDir(taskId) {
  // taskId is a uuid, but normalize defensively
  const safeTask = String(taskId).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeTask) throw new Error('Invalid taskId');
  return path.join(ATTACHMENTS_DIR, safeTask);
}

function storeUpload({ taskId, originalName, buffer, mimeType }) {
  if (!Buffer.isBuffer(buffer)) throw new Error('buffer required');
  if (buffer.length > MAX_SIZE) throw new Error(`File exceeds ${MAX_SIZE} bytes`);
  const cleanName = sanitizeFilename(originalName);
  const ext = path.extname(cleanName).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) throw new Error(`Extension not allowed: ${ext || '(none)'}`);

  const dir = taskDir(taskId);
  ensureDir(dir);
  const id = crypto.randomUUID();
  const storedName = `${id}${ext}`;
  const absPath = path.join(dir, storedName);
  fs.writeFileSync(absPath, buffer);

  return {
    id,
    url: `/api/attachments/${taskId}/${id}`,
    filename: cleanName,
    mimeType: mimeType || MIME_BY_EXT[ext] || 'application/octet-stream',
    size: buffer.length,
    source: 'upload',
    storagePath: path.relative(DATA_DIR, absPath),
    createdAt: new Date().toISOString(),
  };
}

function resolveAttachmentFile(taskId, attachmentId, attachments) {
  const att = (attachments || []).find(a => a.id === attachmentId && a.source === 'upload');
  if (!att) return null;
  const dir = taskDir(taskId);
  // Find file by id prefix (id + any extension)
  let files;
  try { files = fs.readdirSync(dir); } catch { return null; }
  const match = files.find(f => f.startsWith(attachmentId + '.') || f === attachmentId);
  if (!match) return null;
  return { absPath: path.join(dir, match), att };
}

function deleteAttachmentFile(taskId, attachmentId) {
  const dir = taskDir(taskId);
  let files;
  try { files = fs.readdirSync(dir); } catch { return false; }
  const match = files.find(f => f.startsWith(attachmentId + '.') || f === attachmentId);
  if (!match) return false;
  try { fs.unlinkSync(path.join(dir, match)); } catch {}
  // Cleanup empty dir
  try { if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir); } catch {}
  return true;
}

module.exports = {
  ATTACHMENTS_DIR,
  MAX_SIZE,
  MAX_PER_TASK,
  ALLOWED_EXT,
  storeUpload,
  resolveAttachmentFile,
  deleteAttachmentFile,
  sanitizeFilename,
};
