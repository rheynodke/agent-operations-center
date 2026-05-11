// server/lib/embed/avatar-upload.cjs
// Pure I/O helpers for custom embed avatar uploads. No Express knowledge.
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const ALLOWED_MIMES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

const MAX_BYTES = 256 * 1024; // 256 KB

// Only alphanumeric, underscore, hyphen — blocks path traversal
const SAFE_ID_RE = /^[a-zA-Z0-9_-]+$/;

/**
 * Returns the root directory where embed avatar uploads are stored.
 * Reads OPENCLAW_HOME at call time so tests can override the env before calling.
 */
function getUploadsRoot() {
  const home = process.env.OPENCLAW_HOME || path.join(os.homedir(), '.openclaw');
  return path.join(home, 'embed-uploads');
}

/**
 * Saves an avatar buffer to disk.
 *
 * @param {object} opts
 * @param {string} opts.embedId  - Safe alphanumeric embed id (no slashes)
 * @param {Buffer} opts.buffer   - Raw image bytes
 * @param {string} opts.mime     - MIME type string (must be in ALLOWED_MIMES)
 * @returns {Promise<{url: string, path: string}>}
 */
async function saveAvatarBuffer({ embedId, buffer, mime }) {
  // Validate embedId against safe pattern
  if (!embedId || !SAFE_ID_RE.test(embedId)) {
    throw new Error('invalid embedId');
  }

  // Validate mime type
  const ext = ALLOWED_MIMES[mime];
  if (!ext) {
    throw new Error(`unsupported mime: ${mime}`);
  }

  // Validate buffer
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('empty buffer');
  }
  if (buffer.length > MAX_BYTES) {
    throw new Error(`too large (max ${MAX_BYTES} bytes)`);
  }

  const uploadDir = path.join(getUploadsRoot(), embedId);
  fs.mkdirSync(uploadDir, { recursive: true });

  // Wipe any stale avatar files with other extensions — keep exactly one canonical file
  for (const otherExt of Object.values(ALLOWED_MIMES)) {
    if (otherExt === ext) continue;
    const stale = path.join(uploadDir, `avatar.${otherExt}`);
    try {
      fs.unlinkSync(stale);
    } catch (e) {
      // Ignore ENOENT — file didn't exist
      if (e.code !== 'ENOENT') throw e;
    }
  }

  const filePath = path.join(uploadDir, `avatar.${ext}`);
  fs.writeFileSync(filePath, buffer); // default mode 0o666 → effective 0644 with umask

  const url = `/embed-uploads/${embedId}/avatar.${ext}`;
  return { url, path: filePath };
}

/**
 * Deletes any avatar file(s) for the given embed.
 *
 * @param {string} embedId
 * @returns {boolean} true if the directory existed, false otherwise
 */
function deleteAvatar(embedId) {
  if (!embedId || !SAFE_ID_RE.test(embedId)) {
    throw new Error('invalid embedId');
  }

  const uploadDir = path.join(getUploadsRoot(), embedId);
  if (!fs.existsSync(uploadDir)) {
    return false;
  }

  // Remove all allowed avatar extensions
  for (const ext of Object.values(ALLOWED_MIMES)) {
    const filePath = path.join(uploadDir, `avatar.${ext}`);
    try {
      fs.unlinkSync(filePath);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }

  return true;
}

module.exports = {
  saveAvatarBuffer,
  deleteAvatar,
  getUploadsRoot,
  ALLOWED_MIMES,
  MAX_BYTES,
};
