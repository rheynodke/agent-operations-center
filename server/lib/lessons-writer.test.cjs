'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { renderLessonsFile } = require('./lessons-writer.cjs');

test('renderLessonsFile produces YAML frontmatter + lessons + examples', () => {
  const out = renderLessonsFile({
    sessionMeta: {
      sessionId: 's1', agentId: 'a1', ownerId: 1,
      messageCount: 12, endorsedCount: 3, flaggedCount: 1,
      hallucinationRate: 0.083, sessionQuality: 'mixed',
      promptVersion: 'v1.0',
      reflectionAt: '2026-05-09T14:32:00.000Z',
    },
    llmOutput: {
      schema_version: '1', session_quality: 'mixed',
      flagged_messages: [],
      lessons: [
        { kind: 'fact', text: 'X is Y', tags: ['t1', 't2'], evidence_message_ids: ['m3'] },
        { kind: 'pattern', text: 'always do A', tags: [], evidence_message_ids: [] },
      ],
      validated_examples: [],
    },
    examples: [
      { messageId: 'm5', kind: 'code', title: 'demo query', tags: ['sql'], verbatim: 'SELECT 1;' },
    ],
  });

  assert.match(out, /^---/);
  assert.ok(out.includes('session_id: s1'));
  assert.ok(out.includes('agent_id: a1'));
  assert.ok(out.includes('hallucination_rate: 0.083'));
  assert.ok(out.includes('## Lessons'));
  assert.ok(out.includes('### lesson-1'));
  assert.ok(out.includes('X is Y'));
  assert.ok(out.includes('### lesson-2'));
  assert.ok(out.includes('always do A'));
  assert.ok(out.includes('## Validated Examples'));
  assert.ok(out.includes('### example-1: demo query'));
  assert.ok(out.includes('SELECT 1;'));
});

test('renderLessonsFile aggregates tags from frontmatter', () => {
  const out = renderLessonsFile({
    sessionMeta: {
      sessionId: 's1', agentId: 'a1', ownerId: 1,
      messageCount: 5, endorsedCount: 1, flaggedCount: 0,
      hallucinationRate: 0, sessionQuality: 'good',
      promptVersion: 'v1.0',
      reflectionAt: '2026-05-09T14:32:00.000Z',
    },
    llmOutput: {
      lessons: [{ kind: 'fact', text: 'a', tags: ['x', 'y'], evidence_message_ids: [] }],
      validated_examples: [],
      flagged_messages: [],
    },
    examples: [{ messageId: 'm1', kind: 'code', title: 't', tags: ['z'], verbatim: '' }],
  });
  // tags in frontmatter should include x, y, z
  assert.match(out, /tags:.*x.*y.*z|tags:.*z.*x.*y|tags:.*y.*z.*x/s);
});

function writeFixtureJsonl() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lessons-'));
  const file = path.join(dir, 'session.jsonl');
  const lines = [
    JSON.stringify({ type: 'session', id: 's1', timestamp: 0 }),
    JSON.stringify({ type: 'message', id: 'u1', role: 'user', content: 'hi' }),
    JSON.stringify({ type: 'message', id: 'a1', role: 'assistant',
      content: [
        { type: 'thinking', text: 'hidden' },
        { type: 'text', text: 'verbatim assistant text' },
        { type: 'tool_use', name: 'bash', input: {} },
      ]
    }),
    JSON.stringify({ type: 'message', id: 'a2', role: 'assistant', content: 'plain string content' }),
  ];
  fs.writeFileSync(file, lines.join('\n'));
  return { dir, file };
}

const { resolveVerbatim } = require('./lessons-writer.cjs');

test('resolveVerbatim extracts assistant text from JSONL, dropping thinking + tool_use', async () => {
  const { file } = writeFixtureJsonl();
  const examples = [
    { messageId: 'a1', kind: 'explanation', title: 't', tags: [] },
    { messageId: 'a2', kind: 'code', title: 'plain', tags: [] },
  ];
  const resolved = await resolveVerbatim(examples, file);
  assert.equal(resolved.length, 2);
  assert.equal(resolved[0].verbatim, 'verbatim assistant text');
  assert.equal(resolved[1].verbatim, 'plain string content');
});

test('resolveVerbatim drops examples whose messageId is not in JSONL (LLM hallucination guard)', async () => {
  const { file } = writeFixtureJsonl();
  const examples = [
    { messageId: 'ghost', kind: 'code', title: 'fake', tags: [] },
    { messageId: 'a1', kind: 'explanation', title: 'real', tags: [] },
  ];
  const resolved = await resolveVerbatim(examples, file);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].messageId, 'a1');
});

const { writeLessonsForSession } = require('./lessons-writer.cjs');

test('writeLessonsForSession writes atomically with timestamp+sessionId filename', async () => {
  const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-'));
  const { file: jsonlPath } = writeFixtureJsonl();

  const filePath = await writeLessonsForSession({
    workspace: wsDir,
    sessionId: 's1',
    agentId: 'a1',
    ownerId: 1,
    llmOutput: {
      schema_version: '1', session_quality: 'good',
      flagged_messages: [],
      lessons: [{ kind: 'fact', text: 'X', tags: ['t'], evidence_message_ids: [] }],
      validated_examples: [{ messageId: 'a1', kind: 'explanation', title: 't', tags: [] }],
    },
    jsonlPath,
    sessionMeta: {
      sessionId: 's1', agentId: 'a1', ownerId: 1,
      messageCount: 5, endorsedCount: 1, flaggedCount: 0,
      hallucinationRate: 0, sessionQuality: 'good',
      promptVersion: 'v1.0',
      reflectionAt: '2026-05-09T14:32:00.000Z',
    },
  });

  assert.ok(fs.existsSync(filePath));
  assert.match(filePath, /aoc-lessons[\/\\]\d{8}T\d{6}Z__s1\.md$/);
  const content = fs.readFileSync(filePath, 'utf8');
  assert.ok(content.includes('## Lessons'));
  assert.ok(content.includes('verbatim assistant text'));  // resolved from JSONL
});

test('writeLessonsForSession rejects malicious sessionId (path traversal guard)', async () => {
  const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-'));
  const { file: jsonlPath } = writeFixtureJsonl();
  await assert.rejects(
    writeLessonsForSession({
      workspace: wsDir,
      sessionId: '../../../etc/passwd',
      agentId: 'a1', ownerId: 1,
      llmOutput: { lessons: [], validated_examples: [], flagged_messages: [] },
      jsonlPath,
      sessionMeta: {
        sessionId: '../../../etc/passwd',
        agentId: 'a1', ownerId: 1, messageCount: 1,
        endorsedCount: 0, flaggedCount: 0, hallucinationRate: 0,
        sessionQuality: 'good', promptVersion: 'v1.0',
        reflectionAt: '2026-05-09T14:32:00.000Z',
      },
    }),
    /invalid sessionId/
  );
});

test('writeLessonsForSession is idempotent re-reflect creates new timestamped file', async () => {
  const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-'));
  const { file: jsonlPath } = writeFixtureJsonl();
  const meta = {
    sessionId: 's-rerun', agentId: 'a1', ownerId: 1,
    messageCount: 5, endorsedCount: 1, flaggedCount: 0,
    hallucinationRate: 0, sessionQuality: 'good',
    promptVersion: 'v1.0',
    reflectionAt: '2026-05-09T14:32:00.000Z',
  };
  const baseOutput = { schema_version: '1', session_quality: 'good', flagged_messages: [], validated_examples: [] };

  const path1 = await writeLessonsForSession({
    workspace: wsDir, sessionId: 's-rerun', agentId: 'a1', ownerId: 1,
    llmOutput: { ...baseOutput, lessons: [{ kind: 'fact', text: 'V1', tags: [], evidence_message_ids: [] }] },
    jsonlPath, sessionMeta: meta,
  });
  // Different reflectionAt timestamp → different filename. User-driven re-reflect
  // endpoint will glob+unlink prior session files before re-running.
  const path2 = await writeLessonsForSession({
    workspace: wsDir, sessionId: 's-rerun', agentId: 'a1', ownerId: 1,
    llmOutput: { ...baseOutput, lessons: [{ kind: 'fact', text: 'V2', tags: [], evidence_message_ids: [] }] },
    jsonlPath, sessionMeta: { ...meta, reflectionAt: '2026-05-09T14:33:00.000Z' },
  });
  assert.notEqual(path1, path2);
  const c2 = fs.readFileSync(path2, 'utf8');
  assert.ok(c2.includes('V2'));
});
