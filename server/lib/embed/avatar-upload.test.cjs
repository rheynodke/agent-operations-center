// server/lib/embed/avatar-upload.test.cjs
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Setup: isolate uploads root per test run ───────────────────────────────

let tmpRoot;

function setupEnv() {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-embed-uploads-'));
  process.env.OPENCLAW_HOME = tmpRoot;
  // Bust require cache so the module picks up the new env
  Object.keys(require.cache).forEach(k => {
    if (k.includes('avatar-upload')) delete require.cache[k];
  });
  return require('./avatar-upload.cjs');
}

// ─── Tests ──────────────────────────────────────────────────────────────────

test('getUploadsRoot returns <OPENCLAW_HOME>/embed-uploads', () => {
  const lib = setupEnv();
  const root = lib.getUploadsRoot();
  assert.strictEqual(root, path.join(tmpRoot, 'embed-uploads'));
});

test('saveAvatarBuffer writes file and returns correct url and path (PNG)', async () => {
  const lib = setupEnv();
  const embedId = 'embed-abc123';
  const buffer = Buffer.alloc(100, 0xff); // 100 bytes, valid size
  const mime = 'image/png';

  const result = await lib.saveAvatarBuffer({ embedId, buffer, mime });

  assert.strictEqual(result.url, `/embed-uploads/${embedId}/avatar.png`);
  assert.ok(result.path.endsWith(`avatar.png`), `path should end with avatar.png, got: ${result.path}`);
  assert.ok(fs.existsSync(result.path), 'file should exist on disk');

  const written = fs.readFileSync(result.path);
  assert.strictEqual(written.length, buffer.length, 'written file should match buffer size');
});

test('saveAvatarBuffer writes JPEG correctly', async () => {
  const lib = setupEnv();
  const embedId = 'embed-jpg-001';
  const buffer = Buffer.alloc(512, 0xaa);
  const mime = 'image/jpeg';

  const result = await lib.saveAvatarBuffer({ embedId, buffer, mime });
  assert.strictEqual(result.url, `/embed-uploads/${embedId}/avatar.jpg`);
  assert.ok(fs.existsSync(result.path));
});

test('saveAvatarBuffer writes WEBP correctly', async () => {
  const lib = setupEnv();
  const embedId = 'embed-webp-001';
  const buffer = Buffer.alloc(256, 0xbb);
  const mime = 'image/webp';

  const result = await lib.saveAvatarBuffer({ embedId, buffer, mime });
  assert.strictEqual(result.url, `/embed-uploads/${embedId}/avatar.webp`);
  assert.ok(fs.existsSync(result.path));
});

test('saveAvatarBuffer rejects unsupported mime type', async () => {
  const lib = setupEnv();
  const embedId = 'embed-gif-001';
  const buffer = Buffer.alloc(100, 0xcc);

  await assert.rejects(
    () => lib.saveAvatarBuffer({ embedId, buffer, mime: 'image/gif' }),
    (err) => {
      assert.ok(err.message.includes('unsupported mime: image/gif'), `Expected unsupported mime error, got: ${err.message}`);
      return true;
    },
  );
});

test('saveAvatarBuffer rejects buffer exceeding MAX_BYTES', async () => {
  const lib = setupEnv();
  const embedId = 'embed-huge';
  const buffer = Buffer.alloc(lib.MAX_BYTES + 1, 0xdd);

  await assert.rejects(
    () => lib.saveAvatarBuffer({ embedId, buffer, mime: 'image/png' }),
    (err) => {
      assert.ok(err.message.includes('too large'), `Expected too large error, got: ${err.message}`);
      assert.ok(err.message.includes('262144'), `Expected max bytes in error, got: ${err.message}`);
      return true;
    },
  );
});

test('saveAvatarBuffer rejects empty buffer', async () => {
  const lib = setupEnv();
  const embedId = 'embed-empty';
  const buffer = Buffer.alloc(0);

  await assert.rejects(
    () => lib.saveAvatarBuffer({ embedId, buffer, mime: 'image/png' }),
    (err) => {
      assert.ok(err.message.includes('empty buffer'), `Expected empty buffer error, got: ${err.message}`);
      return true;
    },
  );
});

test('saveAvatarBuffer rejects path-traversal embedId', async () => {
  const lib = setupEnv();

  await assert.rejects(
    () => lib.saveAvatarBuffer({ embedId: '../escape', buffer: Buffer.alloc(10, 0), mime: 'image/png' }),
    (err) => {
      assert.ok(err.message.includes('invalid embedId'), `Expected invalid embedId error, got: ${err.message}`);
      return true;
    },
  );
});

test('saveAvatarBuffer rejects embedId with slash', async () => {
  const lib = setupEnv();

  await assert.rejects(
    () => lib.saveAvatarBuffer({ embedId: 'foo/bar', buffer: Buffer.alloc(10, 0), mime: 'image/png' }),
    (err) => {
      assert.ok(err.message.includes('invalid embedId'), `Expected invalid embedId error, got: ${err.message}`);
      return true;
    },
  );
});

test('saveAvatarBuffer replaces stale avatar.jpg when uploading avatar.png (one canonical file)', async () => {
  const lib = setupEnv();
  const embedId = 'embed-replace-test';

  // First upload a JPEG
  const jpgResult = await lib.saveAvatarBuffer({ embedId, buffer: Buffer.alloc(50, 0x11), mime: 'image/jpeg' });
  assert.ok(fs.existsSync(jpgResult.path), 'jpg should exist');

  // Then upload a PNG — should remove the jpg
  const pngResult = await lib.saveAvatarBuffer({ embedId, buffer: Buffer.alloc(60, 0x22), mime: 'image/png' });
  assert.ok(fs.existsSync(pngResult.path), 'png should exist');
  assert.ok(!fs.existsSync(jpgResult.path), 'jpg should be removed after png upload');

  // Verify only one avatar file exists
  const dir = path.dirname(pngResult.path);
  const files = fs.readdirSync(dir).filter(f => f.startsWith('avatar.'));
  assert.strictEqual(files.length, 1, `Should have exactly 1 avatar file, got: ${files.join(', ')}`);
});

test('deleteAvatar removes avatar file and returns true', async () => {
  const lib = setupEnv();
  const embedId = 'embed-to-delete';

  // Upload first
  await lib.saveAvatarBuffer({ embedId, buffer: Buffer.alloc(100, 0xee), mime: 'image/png' });
  const uploadsDir = path.join(lib.getUploadsRoot(), embedId);
  assert.ok(fs.existsSync(uploadsDir), 'dir should exist before delete');

  // Delete
  const result = lib.deleteAvatar(embedId);
  assert.strictEqual(result, true, 'deleteAvatar should return true when dir existed');

  // File should be gone
  const avatarPath = path.join(uploadsDir, 'avatar.png');
  assert.ok(!fs.existsSync(avatarPath), 'avatar.png should be removed');
});

test('deleteAvatar on nonexistent dir returns false', () => {
  const lib = setupEnv();

  const result = lib.deleteAvatar('nonexistent-embed-id-xyz');
  assert.strictEqual(result, false, 'deleteAvatar should return false when dir did not exist');
});

test('deleteAvatar rejects path-traversal embedId', () => {
  const lib = setupEnv();

  assert.throws(
    () => lib.deleteAvatar('../escape'),
    (err) => {
      assert.ok(err.message.includes('invalid embedId'), `Expected invalid embedId error, got: ${err.message}`);
      return true;
    },
  );
});

test('MAX_BYTES is exactly 256 * 1024', () => {
  const lib = setupEnv();
  assert.strictEqual(lib.MAX_BYTES, 256 * 1024);
});

test('ALLOWED_MIMES has png, jpeg, webp', () => {
  const lib = setupEnv();
  assert.strictEqual(lib.ALLOWED_MIMES['image/png'], 'png');
  assert.strictEqual(lib.ALLOWED_MIMES['image/jpeg'], 'jpg');
  assert.strictEqual(lib.ALLOWED_MIMES['image/webp'], 'webp');
  assert.strictEqual(Object.keys(lib.ALLOWED_MIMES).length, 3, 'Should have exactly 3 MIME types');
});
