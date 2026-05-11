'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const cat = require('./regex-catalog.cjs');

test('FILESYSTEM patterns match common paths', () => {
  const patterns = cat.getCategoryPatterns('filesystem');
  assert.ok(patterns.some(p => p.regex.test('/Users/alice/secret')));
  assert.ok(patterns.some(p => p.regex.test('/home/bob/data')));
  assert.ok(patterns.some(p => p.regex.test('C:\\Windows\\System32')));
  assert.ok(patterns.some(p => p.regex.test('~/.openclaw/')));
  assert.ok(patterns.some(p => p.regex.test('/opt/myapp')));
});

test('CREDENTIAL patterns match common formats', () => {
  const patterns = cat.getCategoryPatterns('credentials');
  assert.ok(patterns.some(p => p.regex.test('TOKEN=abc123def456')));
  assert.ok(patterns.some(p => p.regex.test('API_KEY: sk-prod-xxxxxxxxxxxxxxxxxxxx')));
  assert.ok(patterns.some(p => p.regex.test('Bearer abcdefghijklmnopqrstuvwxyz12345')));
  assert.ok(patterns.some(p => p.regex.test('sk-abcdefghijklmnopqrstuvwxyz12345')));
  assert.ok(patterns.some(p => p.regex.test('xoxb-1234-5678-token')));
  assert.ok(patterns.some(p => p.regex.test('ghp_abcdefghijklmnopqrstuvwxyz12345')));
});

test('INTERNAL marker patterns', () => {
  const patterns = cat.getCategoryPatterns('internal');
  assert.ok(patterns.some(p => p.regex.test('openclaw.json')));
  assert.ok(patterns.some(p => p.regex.test('aoc.db')));
  assert.ok(patterns.some(p => p.regex.test('.aoc_env')));
  assert.ok(patterns.some(p => p.regex.test('SQLITE_ERROR')));
});

test('PII patterns match emails, phones, credit cards (Luhn)', () => {
  const patterns = cat.getCategoryPatterns('pii');
  assert.ok(patterns.some(p => p.regex.test('john@example.com')));
  // Indonesian phone
  assert.ok(patterns.some(p => p.regex.test('+6281234567890')));
  // Valid Luhn credit card
  assert.ok(patterns.some(p => p.regex.test('4532015112830366')));  // Visa test
});

test('NEGATIVE: regular sentences do not match', () => {
  const all = cat.getAllPatterns();
  for (const p of all) {
    assert.ok(!p.regex.test('Hello world, how are you?'));
    assert.ok(!p.regex.test('I would like to order a pizza.'));
  }
});

test('getAllPatterns returns at least 30 patterns', () => {
  const all = cat.getAllPatterns();
  assert.ok(all.length >= 30, `expected >=30, got ${all.length}`);
});

test('preset filtering: internal-tool-default excludes PII', () => {
  const internal = cat.getPatternsForPreset('internal-tool-default');
  assert.ok(!internal.some(p => p.category === 'pii'));
});

test('preset filtering: customer-service-default includes PII', () => {
  const cs = cat.getPatternsForPreset('customer-service-default');
  assert.ok(cs.some(p => p.category === 'pii'));
});
