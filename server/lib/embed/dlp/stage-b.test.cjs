'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const sb = require('./stage-b.cjs');

// ── shouldRunStageB ──────────────────────────────────────────────────────────

test('shouldRunStageB true for code blocks', () => {
  const text = 'Here is code:\n```python\nprint("hello")\n```';
  assert.strictEqual(sb.shouldRunStageB(text), true);
});

test('shouldRunStageB true for long responses', () => {
  const long = 'x'.repeat(2000);
  assert.strictEqual(sb.shouldRunStageB(long), true);
});

test('shouldRunStageB true for refusal patterns', () => {
  assert.strictEqual(sb.shouldRunStageB('I cannot share that information.'), true);
});

test('shouldRunStageB false for short clean text', () => {
  assert.strictEqual(sb.shouldRunStageB('Hello, how can I help you today?'), false);
});

// ── parseProviderResponse ────────────────────────────────────────────────────

test('parseProviderResponse handles valid clean JSON', () => {
  const r = sb.parseProviderResponse('{"clean": true, "redactions": []}');
  assert.strictEqual(r.clean, true);
  assert.deepStrictEqual(r.redactions, []);
});

test('parseProviderResponse handles redactions list', () => {
  const r = sb.parseProviderResponse(
    '{"clean": false, "redactions": [{"start": 5, "end": 10, "reason": "filesystem-path", "severity": "critical"}]}'
  );
  assert.strictEqual(r.clean, false);
  assert.strictEqual(r.redactions.length, 1);
});

test('parseProviderResponse extracts JSON from prose wrapper', () => {
  const wrapped = 'Here is the result:\n{"clean": true, "redactions": []}\nThanks.';
  const r = sb.parseProviderResponse(wrapped);
  assert.strictEqual(r.clean, true);
});

test('parseProviderResponse returns null on invalid input', () => {
  assert.strictEqual(sb.parseProviderResponse('garbage no json'), null);
});

// ── scan ─────────────────────────────────────────────────────────────────────

test('scan with mocked provider returns redactions', async () => {
  const mockProvider = {
    async generate({ prompt }) {
      return {
        text: '{"clean": false, "redactions": [{"start": 0, "end": 5, "reason": "test-reason", "severity": "warning"}]}',
      };
    },
  };
  const r = await sb.scan('test text', { provider: mockProvider });
  assert.strictEqual(r.failed, false);
  assert.strictEqual(r.redactions.length, 1);
});

test('scan with provider error returns failure result (not throw)', async () => {
  const mockProvider = {
    async generate() { throw new Error('subprocess failed'); },
  };
  const r = await sb.scan('test', { provider: mockProvider });
  assert.strictEqual(r.failed, true);
  assert.deepStrictEqual(r.redactions, []);
});
