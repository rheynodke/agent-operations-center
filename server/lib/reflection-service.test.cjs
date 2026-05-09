'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { evaluateSkip } = require('./reflection-service.cjs');

test('skip: messageCount < 5 → skipped_too_short', () => {
  const res = evaluateSkip({
    messages: [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hi back' },
    ],
    ratings: [],
  });
  assert.equal(res.skip, true);
  assert.equal(res.reason, 'skipped_too_short');
});

test('skip: substantive transcript but zero engagement signal → skipped_no_signal', () => {
  // 6 messages: 1 user message + 5 assistant turns (e.g., agent monologue),
  // each substantive (200 chars). Tokens ≈ 300, hmm wait — make each 800 chars
  // so total ≈ 4800 chars = ~1200 tokens, comfortably above 500.
  const messages = [
    { role: 'user', content: 'q ' + 'x'.repeat(800) },
    { role: 'assistant', content: 'a1 ' + 'y'.repeat(800) },
    { role: 'assistant', content: 'a2 ' + 'y'.repeat(800) },
    { role: 'assistant', content: 'a3 ' + 'y'.repeat(800) },
    { role: 'assistant', content: 'a4 ' + 'y'.repeat(800) },
    { role: 'assistant', content: 'a5 ' + 'y'.repeat(800) },
  ];
  const res = evaluateSkip({ messages, ratings: [] });
  assert.equal(res.skip, true);
  assert.equal(res.reason, 'skipped_no_signal');
});

test('proceed: substantive transcript with rating → not skipped', () => {
  const messages = [];
  for (let i = 0; i < 12; i++) {
    messages.push({
      id: 'm' + i,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: 'message ' + i + ' ' + 'z'.repeat(300),
    });
  }
  const ratings = [{ messageId: 'm5', source: 'button', rating: 'positive' }];
  const res = evaluateSkip({ messages, ratings });
  assert.equal(res.skip, false);
});

test('skip: 6 trivially-short messages (tokens<500) even with rating → skipped_too_short', () => {
  const messages = [];
  for (let i = 0; i < 6; i++) {
    messages.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: 'a' });
  }
  const ratings = [{ messageId: 'x', source: 'button', rating: 'positive' }];
  const res = evaluateSkip({ messages, ratings });
  assert.equal(res.skip, true);
  assert.equal(res.reason, 'skipped_too_short');
});

const { compressTranscript } = require('./reflection-service.cjs');

test('compressTranscript strips tool_use and thinking blocks', () => {
  const messages = [
    { id: 'u1', role: 'user', content: 'do thing' },
    { id: 'a1', role: 'assistant',
      content: [
        { type: 'thinking', text: 'hidden reasoning' },
        { type: 'tool_use', name: 'bash', input: { cmd: 'ls' } },
        { type: 'text', text: 'I ran ls' },
      ]
    },
  ];
  const out = compressTranscript({ messages, ratings: [] });
  assert.ok(out.includes('do thing'));
  assert.ok(out.includes('I ran ls'));
  assert.ok(out.includes('[tool: bash]'));
  assert.ok(!out.includes('hidden reasoning'));
});

test('compressTranscript injects rating tags inline', () => {
  const messages = [
    { id: 'u1', role: 'user', content: 'q' },
    { id: 'a1', role: 'assistant', content: 'reply' },
  ];
  const ratings = [
    { messageId: 'a1', source: 'button', rating: 'positive', channel: 'dashboard' },
  ];
  const out = compressTranscript({ messages, ratings });
  assert.ok(out.includes('[rating=endorsed via button:dashboard]'));
});

test('compressTranscript applies sliding window above threshold', () => {
  const messages = [];
  for (let i = 0; i < 30; i++) {
    messages.push({
      id: 'm' + i,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: 'x'.repeat(2000),  // ~500 tokens each
    });
  }
  // No ratings on middle messages
  const ratings = [
    { messageId: 'm0', source: 'button', rating: 'positive', channel: 'dashboard' },
    { messageId: 'm29', source: 'button', rating: 'positive', channel: 'dashboard' },
  ];
  const out = compressTranscript({ messages, ratings });
  assert.ok(out.includes('omitted'));
  // First few + last few preserved
  assert.ok(out.includes('m0'));
  assert.ok(out.includes('m29'));
});

const { parseAndValidateOutput } = require('./reflection-service.cjs');

test('parseAndValidateOutput accepts well-formed schema v1', () => {
  const raw = JSON.stringify({
    schema_version: '1',
    session_quality: 'mixed',
    flagged_messages: [{ messageId: 'm1', evidence: 'T2 said no', type: 'factual_error' }],
    lessons: [{ kind: 'fact', text: 'X is Y', tags: ['t1'], evidence_message_ids: ['m3'] }],
    validated_examples: [{ messageId: 'm5', kind: 'code', title: 'q', tags: ['x'] }],
  });
  const r = parseAndValidateOutput(raw, ['m1', 'm3', 'm5']);
  assert.equal(r.ok, true);
  assert.equal(r.data.flagged_messages.length, 1);
  assert.equal(r.data.lessons.length, 1);
  assert.equal(r.data.validated_examples.length, 1);
});

test('parseAndValidateOutput drops entries with messageIds not in JSONL', () => {
  const raw = JSON.stringify({
    schema_version: '1',
    session_quality: 'good',
    flagged_messages: [{ messageId: 'ghost1', evidence: 'fake', type: 'factual_error' }],
    lessons: [{ kind: 'fact', text: 'real', tags: [], evidence_message_ids: ['m1'] }],
    validated_examples: [{ messageId: 'ghost2', kind: 'code', title: 'fake' }],
  });
  const r = parseAndValidateOutput(raw, ['m1']);
  assert.equal(r.ok, true);
  assert.equal(r.data.flagged_messages.length, 0, 'ghost1 dropped');
  assert.equal(r.data.validated_examples.length, 0, 'ghost2 dropped');
  assert.equal(r.data.lessons.length, 1);
});

test('parseAndValidateOutput rejects malformed JSON', () => {
  const r = parseAndValidateOutput('not json', []);
  assert.equal(r.ok, false);
  assert.match(r.error, /JSON/);
});

test('parseAndValidateOutput rejects missing required fields', () => {
  const raw = JSON.stringify({ schema_version: '1' });
  const r = parseAndValidateOutput(raw, []);
  assert.equal(r.ok, false);
});

test('parseAndValidateOutput strips markdown fences if present', () => {
  const raw = '```json\n' + JSON.stringify({
    schema_version: '1', session_quality: 'good',
    flagged_messages: [], lessons: [], validated_examples: [],
  }) + '\n```';
  const r = parseAndValidateOutput(raw, []);
  assert.equal(r.ok, true);
});

test('reflectSession skips short session and writes summary with skip status', async () => {
  const { reflectSession } = require('./reflection-service.cjs');
  const writes = { ratings: [], summary: null, lessons: null };

  const result = await reflectSession({
    sessionId: 's-skip',
    agentId: 'a1',
    ownerId: 1,
    messages: [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hi' },
    ],
    ratings: [],
    workspace: '/tmp/dummy',
    deps: {
      provider: { complete: async () => { throw new Error('should not be called'); } },
      recordRating: () => {},
      upsertSessionSummary: (s) => { writes.summary = s; },
      writeLessonsForSession: () => { writes.lessons = 'should not happen'; },
    },
  });
  assert.equal(result.status, 'skipped_too_short');
  assert.equal(writes.summary.reflectionStatus, 'skipped_too_short');
  assert.equal(writes.lessons, null);
});

test('reflectSession runs LLM, writes ratings + lessons + summary on success', async () => {
  const { reflectSession } = require('./reflection-service.cjs');

  // 12 turns, with 1 endorsed (each ~300 chars to clear MIN_TRANSCRIPT_TOKEN_ESTIMATE=500)
  const messages = [];
  for (let i = 0; i < 12; i++) {
    messages.push({
      id: 'm' + i,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: 'message ' + i + ' ' + 'z'.repeat(300),
    });
  }
  const ratings = [{ messageId: 'm5', source: 'button', rating: 'positive', channel: 'dashboard' }];

  const writes = { ratings: [], summary: null, lessons: null };
  const llmOutput = JSON.stringify({
    schema_version: '1',
    session_quality: 'mixed',
    flagged_messages: [{ messageId: 'm3', evidence: 'T4 said no', type: 'factual_error' }],
    lessons: [{ kind: 'fact', text: 'X is Y', tags: ['t1'], evidence_message_ids: ['m5'] }],
    validated_examples: [{ messageId: 'm5', kind: 'code', title: 'eg', tags: ['x'] }],
  });

  const result = await reflectSession({
    sessionId: 's-good',
    agentId: 'a1',
    ownerId: 1,
    messages,
    ratings,
    workspace: '/tmp/dummy',
    jsonlPath: '/tmp/dummy.jsonl',
    deps: {
      provider: {
        complete: async () => ({ text: llmOutput, inputTokens: 4500, outputTokens: 280, modelUsed: 'claude-haiku-4-5', providerLatencyMs: 4200 }),
      },
      recordRating: (r) => writes.ratings.push(r),
      upsertSessionSummary: (s) => { writes.summary = s; },
      writeLessonsForSession: async (params) => {
        writes.lessons = params;
        return '/tmp/dummy/aoc-lessons/test.md';
      },
    },
  });

  assert.equal(result.status, 'completed');
  assert.equal(writes.ratings.length, 1, 'flagged turn recorded as nl_correction');
  assert.equal(writes.ratings[0].source, 'nl_correction');
  assert.equal(writes.ratings[0].rating, 'negative');
  assert.equal(writes.ratings[0].messageId, 'm3');
  assert.equal(writes.summary.reflectionStatus, 'completed');
  assert.equal(writes.summary.lessonsExtracted, 1);
  assert.equal(writes.summary.examplesCaptured, 1);
  assert.equal(writes.summary.flaggedCount, 1);
  assert.equal(writes.summary.endorsedCount, 1);
  assert.ok(writes.lessons, 'lessons writer called');
});

test('reflectSession honors safety net: do not write lessons if flagged > 50%', async () => {
  const { reflectSession } = require('./reflection-service.cjs');

  const messages = [];
  for (let i = 0; i < 10; i++) {
    messages.push({ id: 'm' + i, role: i % 2 === 0 ? 'user' : 'assistant', content: 'x'.repeat(200) });
  }
  const ratings = [{ messageId: 'm1', source: 'button', rating: 'positive', channel: 'dashboard' }];

  const writes = { lessons: null, summary: null };
  const llmOutput = JSON.stringify({
    schema_version: '1',
    session_quality: 'poor',
    // 5 flagged out of 10 messages → ratio 0.5 → still write? No, threshold is > 0.5
    // Use 6 to clearly exceed (only 5 assistant messages, but counts use total/assistant);
    // To trigger > 0.5 we need flagged_count > 0.5 * totalAssistant = 0.5 * 5 = 2.5 → 3+
    flagged_messages: ['m1', 'm3', 'm5', 'm7'].map(id => ({ messageId: id, evidence: 'bad', type: 'factual_error' })),
    lessons: [{ kind: 'fact', text: 'should not be saved', tags: [], evidence_message_ids: [] }],
    validated_examples: [],
  });

  await reflectSession({
    sessionId: 's-bad', agentId: 'a1', ownerId: 1, messages, ratings,
    workspace: '/tmp/dummy', jsonlPath: '/tmp/dummy.jsonl',
    deps: {
      provider: { complete: async () => ({ text: llmOutput, inputTokens: 1, outputTokens: 1, modelUsed: 'h', providerLatencyMs: 10 }) },
      recordRating: () => {},
      upsertSessionSummary: (s) => { writes.summary = s; },
      writeLessonsForSession: async (p) => { writes.lessons = p; return '/tmp/x'; },
    },
  });

  assert.equal(writes.lessons, null, 'safety net engaged: lessons not written');
  assert.equal(writes.summary.reflectionStatus, 'completed');
  assert.equal(writes.summary.lessonsExtracted, 0);
});

test('createReflectionQueue limits concurrent reflections', async () => {
  const { createReflectionQueue } = require('./reflection-service.cjs');
  const inFlight = { count: 0, max: 0 };

  const queue = createReflectionQueue({
    concurrency: 2,
    maxQueue: 50,
    runner: async () => {
      inFlight.count++;
      inFlight.max = Math.max(inFlight.max, inFlight.count);
      await new Promise(r => setTimeout(r, 30));
      inFlight.count--;
      return { status: 'completed' };
    },
  });

  const promises = [];
  for (let i = 0; i < 6; i++) promises.push(queue.enqueue({ id: i }));
  await Promise.all(promises);

  assert.ok(inFlight.max <= 2, `max in flight was ${inFlight.max}, expected ≤ 2`);
});

test('createReflectionQueue rejects when full', async () => {
  const { createReflectionQueue } = require('./reflection-service.cjs');
  const queue = createReflectionQueue({
    concurrency: 1,
    maxQueue: 2,
    runner: () => new Promise(r => setTimeout(() => r({ status: 'completed' }), 100)),
  });

  // 1 running + 2 queued = 3 capacity used (= concurrency + maxQueue)
  queue.enqueue({ id: 1 });
  queue.enqueue({ id: 2 });
  queue.enqueue({ id: 3 });

  await assert.rejects(
    () => queue.enqueue({ id: 4 }),
    /queue full/
  );
});

test('evaluateSkip extracts text from array content (regression: bug found in pipeline test)', () => {
  // Real assistant messages come as content arrays; without text extraction
  // the token estimate falls back to '[object Object]' string-coercion which
  // is way below MIN_TRANSCRIPT_TOKEN_ESTIMATE, causing false too_short skips.
  const messages = [];
  for (let i = 0; i < 12; i++) {
    messages.push({
      id: 'm' + i,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: i % 2 === 0
        ? ('user message ' + i + ' ').repeat(50)
        : [
            { type: 'thinking', text: 'should be ignored' },
            { type: 'text', text: ('substantive assistant reply ' + i + ' ').repeat(50) },
          ],
    });
  }
  const ratings = [{ messageId: 'm5', source: 'button', rating: 'positive' }];
  const res = evaluateSkip({ messages, ratings });
  assert.equal(res.skip, false, 'array content with substantive text must not skip');
});
