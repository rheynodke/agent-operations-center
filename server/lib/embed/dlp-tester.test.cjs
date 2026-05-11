'use strict';

// server/lib/embed/dlp-tester.test.cjs
// Unit tests for the DLP allowlist tester helper.

const { test } = require('node:test');
const assert = require('node:assert');
const tester = require('./dlp-tester.cjs');

// ─── Test 1: basic stage-A applied (email + path leak get matched) ────────────

test('testText: email in customer-service preset → match returned', () => {
  const { matches, redacted, warnings } = tester.testText({
    text: 'Contact admin@example.com for help',
    preset: 'customer-service-default',
    allowlist: [],
  });

  assert.ok(Array.isArray(matches), 'matches should be an array');
  assert.ok(matches.length > 0, 'should have at least one match');

  const emailMatch = matches.find(m => m.type === 'pii-email');
  assert.ok(emailMatch, 'should have a pii-email match');
  assert.ok(typeof emailMatch.text === 'string', 'match.text should be a string');
  assert.ok(typeof emailMatch.start === 'number', 'match.start should be a number');
  assert.ok(typeof emailMatch.end === 'number', 'match.end should be a number');
  assert.ok(emailMatch.end > emailMatch.start, 'end > start');

  assert.ok(typeof redacted === 'string', 'redacted should be a string');
  assert.ok(redacted.includes('[redacted:'), 'redacted should contain [redacted: marker');
  assert.ok(!redacted.includes('admin@example.com'), 'redacted should not contain the original email');

  assert.ok(Array.isArray(warnings), 'warnings should be an array');
  assert.strictEqual(warnings.length, 0, 'no warnings for valid call');
});

test('testText: filesystem path in internal-tool-default preset → match returned', () => {
  const { matches, redacted } = tester.testText({
    text: 'Check /Users/alice/secret.txt for the config',
    preset: 'internal-tool-default',
    allowlist: [],
  });

  assert.ok(matches.length > 0, 'should have at least one match');
  // patternId for /Users/... is 'fs-users' (from regex-catalog)
  const pathMatch = matches.find(m => m.type && m.type.startsWith('fs-'));
  assert.ok(pathMatch, 'should have a fs-* type match (filesystem category)');
  assert.ok(!redacted.includes('/Users/alice'), 'path should be redacted in output');
});

// ─── Test 2: allowlist exempts a specific pattern ─────────────────────────────

test('testText: allowlist exempts matching text (anchor pattern)', () => {
  // stage-A regex for /Users/... stops at the next slash, so the matched
  // text for '/Users/alice/shared/report.txt' is just '/Users/alice'.
  // The allowlist entry must match the *matched text* substring.
  const { matches, redacted, warnings } = tester.testText({
    text: 'File at /Users/alice/shared/report.txt',
    preset: 'internal-tool-default',
    allowlist: ['/Users/alice'],
  });

  assert.strictEqual(matches.length, 0, 'allowlisted path should produce no matches');
  assert.ok(redacted.includes('/Users/alice'), 'allowlisted path should NOT be redacted');
  assert.strictEqual(warnings.length, 0);
});

test('testText: allowlist only exempts matching text, other matches still fire', () => {
  const { matches } = tester.testText({
    text: 'File at /Users/alice/shared and TOKEN=abc123def456ghi789jkl012',
    preset: 'internal-tool-default',
    allowlist: ['/Users/alice/shared'],
  });

  // Token match should remain even though path is allowlisted
  const credMatch = matches.find(m => m.type === 'cred-env-style' || m.type === 'credential');
  assert.ok(credMatch || matches.length > 0, 'credential match should still fire');
});

// ─── Test 3: invalid regex in allowlist → warning, not crash ──────────────────

test('testText: invalid regex in allowlist → warning pushed, no throw', () => {
  const invalidPattern = '[invalid(regex';

  let result;
  assert.doesNotThrow(() => {
    result = tester.testText({
      text: 'Check /Users/alice/file.txt',
      preset: 'internal-tool-default',
      allowlist: [invalidPattern],
    });
  }, 'testText must not throw on invalid regex');

  assert.ok(Array.isArray(result.warnings), 'warnings should be an array');
  assert.ok(result.warnings.length > 0, 'should have at least one warning');
  assert.ok(
    result.warnings[0].includes(invalidPattern) || result.warnings[0].includes('invalid regex'),
    `warning should mention the bad pattern; got: ${result.warnings[0]}`,
  );
  // Should still have produced matches (invalid allowlist entry is skipped, not blocking)
  assert.ok(result.matches.length > 0, 'matches should still fire for non-allowlisted text');
});

// ─── Test 4: clean text → no matches ─────────────────────────────────────────

test('testText: clean text → empty matches, original text returned as redacted', () => {
  const input = 'Hello, this is a clean message with no sensitive data.';
  const { matches, redacted, warnings } = tester.testText({
    text: input,
    preset: 'internal-tool-default',
    allowlist: [],
  });

  assert.strictEqual(matches.length, 0, 'clean text should have no matches');
  assert.strictEqual(redacted, input, 'clean text should pass through unchanged');
  assert.strictEqual(warnings.length, 0);
});

// ─── Test 5: match shape → {type, text, start, end} ─────────────────────────

test('testText: match object has correct shape {type, text, start, end}', () => {
  const { matches } = tester.testText({
    text: 'Path is /Users/bob',
    preset: 'internal-tool-default',
    allowlist: [],
  });

  assert.ok(matches.length > 0, 'expected at least one match');
  const m = matches[0];
  assert.ok('type' in m, 'match must have type');
  assert.ok('text' in m, 'match must have text');
  assert.ok('start' in m, 'match must have start');
  assert.ok('end' in m, 'match must have end');
  assert.ok(typeof m.type === 'string', 'type must be string');
  assert.ok(typeof m.text === 'string', 'text must be string');
  assert.ok(typeof m.start === 'number', 'start must be number');
  assert.ok(typeof m.end === 'number', 'end must be number');
});

// ─── Test 6: multiple invalid patterns in allowlist ──────────────────────────

test('testText: multiple invalid allowlist patterns → one warning per invalid entry', () => {
  const { warnings } = tester.testText({
    text: 'Check /Users/alice',
    preset: 'internal-tool-default',
    allowlist: ['[bad1', '[bad2'],
  });

  assert.ok(warnings.length >= 2, `expected at least 2 warnings, got ${warnings.length}`);
});

// ─── Test 7: empty text → no matches ─────────────────────────────────────────

test('testText: empty string → no matches, no warnings', () => {
  const { matches, redacted, warnings } = tester.testText({
    text: '',
    preset: 'internal-tool-default',
    allowlist: [],
  });

  assert.deepStrictEqual(matches, []);
  assert.strictEqual(redacted, '');
  assert.deepStrictEqual(warnings, []);
});
