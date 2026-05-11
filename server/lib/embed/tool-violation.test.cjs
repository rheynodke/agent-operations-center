'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  checkToolUse,
  extractToolUseFromGatewayEvent,
  PUBLIC_DEFAULT_ALLOWLIST,
} = require('./tool-violation.cjs');

// Test 1: passes when allowlist is null (no restriction)
test('checkToolUse passes when allowlist is null', () => {
  const result = checkToolUse({ name: 'exec', input: {} }, { allowlist: null });
  assert.deepEqual(result, { allowed: true });
});

// Test 2: passes when tool name is in allowlist
test('checkToolUse passes when tool is in allowlist', () => {
  const result = checkToolUse(
    { name: 'memory_search', input: {} },
    { allowlist: ['memory_search', 'text_response'] }
  );
  assert.deepEqual(result, { allowed: true });
});

// Test 3: rejects when tool name is not in allowlist
test('checkToolUse rejects when tool is not in allowlist', () => {
  const result = checkToolUse(
    { name: 'exec', input: {} },
    { allowlist: ['memory_search', 'text_response'] }
  );
  assert.deepEqual(result, { allowed: false, violation: 'exec' });
});

// Test 4: PUBLIC_DEFAULT_ALLOWLIST contains memory_search + text_response, NOT exec
test('PUBLIC_DEFAULT_ALLOWLIST contains memory_search and text_response but not exec', () => {
  assert.ok(
    PUBLIC_DEFAULT_ALLOWLIST.includes('memory_search'),
    'should include memory_search'
  );
  assert.ok(
    PUBLIC_DEFAULT_ALLOWLIST.includes('text_response'),
    'should include text_response'
  );
  assert.ok(
    !PUBLIC_DEFAULT_ALLOWLIST.includes('exec'),
    'should NOT include exec'
  );
});

// Test 5: extractToolUseFromGatewayEvent pulls tool_use blocks from message content
test('extractToolUseFromGatewayEvent extracts tool_use blocks from message content', () => {
  const event = {
    message: {
      content: [
        { type: 'text', text: 'Thinking...' },
        { type: 'tool_use', name: 'memory_search', input: { query: 'hello' } },
        { type: 'tool_use', name: 'text_response', input: { text: 'hi' } },
      ],
    },
  };
  const result = extractToolUseFromGatewayEvent(event);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], { name: 'memory_search', input: { query: 'hello' } });
  assert.deepEqual(result[1], { name: 'text_response', input: { text: 'hi' } });
});

// Test 6: handles event without tool_use (returns empty array)
test('extractToolUseFromGatewayEvent returns empty array when no tool_use blocks', () => {
  const result1 = extractToolUseFromGatewayEvent(null);
  assert.deepEqual(result1, []);

  const result2 = extractToolUseFromGatewayEvent({});
  assert.deepEqual(result2, []);

  const result3 = extractToolUseFromGatewayEvent({
    message: { content: [{ type: 'text', text: 'hello' }] },
  });
  assert.deepEqual(result3, []);
});
