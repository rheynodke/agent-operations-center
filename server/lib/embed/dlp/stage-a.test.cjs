'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const sa = require('./stage-a.cjs');

// Test 1: clean text → no redactions
test('clean text returns no redactions', () => {
  const r = sa.scan('Hello, this is a totally clean response.', { preset: 'internal-tool-default' });
  assert.deepStrictEqual(r.redactions, []);
  assert.strictEqual(r.text, 'Hello, this is a totally clean response.');
});

// Test 2: filesystem path redacted
test('filesystem path redacted', () => {
  const r = sa.scan('Check /Users/alice/secret.txt for details', { preset: 'internal-tool-default' });
  assert.ok(r.redactions.length > 0);
  assert.ok(r.text.includes('[redacted:'));
  assert.ok(!r.text.includes('alice'));
});

// Test 3: credential pattern redacted
test('credential pattern redacted', () => {
  const r = sa.scan('TOKEN=abc123def456ghi789jkl012', { preset: 'internal-tool-default' });
  assert.ok(r.redactions.length > 0);
});

// Test 4: PII detected only in customer-service preset (not internal-tool)
test('PII detected only in customer-service preset', () => {
  const text = 'Contact john@example.com';
  const internal = sa.scan(text, { preset: 'internal-tool-default' });
  const cs = sa.scan(text, { preset: 'customer-service-default' });
  assert.strictEqual(internal.redactions.length, 0);
  assert.ok(cs.redactions.length > 0);
});

// Test 5: multiple matches in single response
test('multiple matches in single response', () => {
  const text = 'Check /Users/alice and TOKEN=abc123def456ghi789jkl012';
  const r = sa.scan(text, { preset: 'internal-tool-default' });
  assert.ok(r.redactions.length >= 2);
});

// Test 6: redaction includes start/end positions + reason
test('redaction includes start/end positions + reason', () => {
  const r = sa.scan('Path: /Users/bob', { preset: 'internal-tool-default' });
  assert.ok(r.redactions.length > 0);
  const red = r.redactions[0];
  assert.ok(red.reason, 'reason should be truthy');
  assert.ok(typeof red.start === 'number', 'start should be a number');
  assert.ok(typeof red.end === 'number', 'end should be a number');
  assert.ok(red.end > red.start, 'end should be after start');
});

// Test 7: allowlist patterns un-redact matched content
test('allowlist patterns un-redact matched content', () => {
  const r = sa.scan('Check /Users/alice for details', {
    preset: 'internal-tool-default',
    allowlistPatterns: ['/Users/alice'],
  });
  assert.strictEqual(r.redactions.length, 0);
  assert.ok(r.text.includes('/Users/alice'));
});

// Test 8: Luhn-invalid credit-card-shaped number not redacted as credit card
test('Luhn-invalid credit-card-shaped number not redacted as pii-credit-card', () => {
  // 1234567890123456 fails Luhn — it should NOT appear as pii-credit-card redaction.
  const r = sa.scan('Order #1234567890123456 (not a real card)', { preset: 'customer-service-default' });
  const ccRedactions = r.redactions.filter(red => red.reason === 'pii-credit-card');
  assert.strictEqual(ccRedactions.length, 0, 'Luhn-invalid number must not be flagged as credit card');
});
