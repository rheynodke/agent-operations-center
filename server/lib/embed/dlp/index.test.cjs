'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const dlp = require('./index.cjs');

const cleanProvider = { async generate() { return { text: '{"clean": true, "redactions": []}' }; } };
const dirtyProvider = { async generate() { return { text: '{"clean": false, "redactions": [{"start": 0, "end": 4, "reason": "stage-b-extra", "severity": "warning"}]}' }; } };

test('filter clean text passes through unchanged', async () => {
  const r = await dlp.filter('Hello world', { preset: 'internal-tool-default', provider: cleanProvider });
  assert.strictEqual(r.text, 'Hello world');
  assert.strictEqual(r.action, 'pass');
});

test('filter Stage A redactions applied', async () => {
  const r = await dlp.filter('Path: /Users/alice', { preset: 'internal-tool-default', provider: cleanProvider });
  assert.strictEqual(r.action, 'redact');
  assert.ok(r.text.includes('[redacted:'));
  assert.ok(r.redactions.length > 0);
});

test('filter triggers Stage B for code block', async () => {
  const r = await dlp.filter('```\ncode here\n```', { preset: 'internal-tool-default', provider: dirtyProvider });
  assert.strictEqual(r.stageBRan, true);
});

test('hard-block triggered when >3 redactions', async () => {
  const text = '/Users/a /home/b /opt/c /etc/d';
  const r = await dlp.filter(text, { preset: 'internal-tool-default', provider: cleanProvider });
  assert.strictEqual(r.action, 'block');
  assert.ok(r.text.includes('Maaf, saya tidak bisa menjawab itu'));
});

test('Stage B failure does not block — falls through to Stage A only', async () => {
  const failProvider = { async generate() { throw new Error('boom'); } };
  const r = await dlp.filter('```\nlong code block here that should trigger stage B\n```', { preset: 'internal-tool-default', provider: failProvider });
  assert.strictEqual(r.action, 'pass');
  assert.strictEqual(r.stageBFailed, true);
});

test('allowlist passed through to Stage A', async () => {
  const r = await dlp.filter('Path: /Users/alice', {
    preset: 'internal-tool-default',
    provider: cleanProvider,
    allowlistPatterns: ['/Users/alice'],
  });
  assert.strictEqual(r.action, 'pass');
});

test('critical Stage A match still blocks even when allowlist matches non-critical', async () => {
  // Allowlist /Users/alice but TOKEN= still critical
  const r = await dlp.filter('Path: /Users/alice and TOKEN=abc123def456ghi789jkl012', {
    preset: 'internal-tool-default',
    provider: cleanProvider,
    allowlistPatterns: ['/Users/alice'],
  });
  assert.strictEqual(r.action, 'redact');
  assert.ok(r.redactions.some(red => red.reason === 'credential'));
});
