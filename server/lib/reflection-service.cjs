'use strict';

/**
 * Reflection Service — runs at session_end (or via internal RPC) to filter,
 * compress, and submit a session transcript to the LLM provider, then writes
 * results to message_ratings (NL corrections), lessons file, and
 * session_satisfaction_summary.
 *
 * See spec §6 + plan Tasks 7-12.
 */

const { buildPrompt, REFLECTION_PROMPT_VERSION } = require('./reflection-prompts.cjs');

const MIN_MESSAGE_COUNT = 5;
const MIN_TRANSCRIPT_TOKEN_ESTIMATE = 500;
const SAFETY_FLAG_RATIO_THRESHOLD = 0.5;

// Crude token estimate: ~4 chars per token. Good enough for skip thresholds.
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

function evaluateSkip({ messages, ratings }) {
  if (!Array.isArray(messages) || messages.length < MIN_MESSAGE_COUNT) {
    return { skip: true, reason: 'skipped_too_short' };
  }

  const totalText = messages.map(m => (m.content || '')).join('\n');
  if (estimateTokens(totalText) < MIN_TRANSCRIPT_TOKEN_ESTIMATE) {
    return { skip: true, reason: 'skipped_too_short' };
  }

  // No explicit ratings → require user follow-up (>1 user turn) as engagement signal,
  // otherwise treat as no-signal (spec §6.1: "no rating, no user follow-up beyond first Q").
  if (!ratings || ratings.length === 0) {
    const userTurns = messages.filter(m => m.role === 'user');
    if (userTurns.length <= 1) {
      return { skip: true, reason: 'skipped_no_signal' };
    }
    // Long-enough transcript with multiple user turns but no rating → proceed
    // (let LLM detect NL corrections via the next-turn pattern).
  }

  return { skip: false, reason: null };
}

const TARGET_MAX_TOKENS = 4000;
const COMPRESSION_KEEP_FIRST = 3;
const COMPRESSION_KEEP_LAST = 5;

function _extractTextFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (!block || !block.type) continue;
    if (block.type === 'text') parts.push(block.text || '');
    else if (block.type === 'thinking') continue;  // strip thinking
    else if (block.type === 'tool_use') parts.push(`[tool: ${block.name || 'unknown'}]`);
    else if (block.type === 'tool_result') continue;  // strip
  }
  return parts.join('\n').trim();
}

function _ratingTagFor(messageId, ratings) {
  const matches = (ratings || []).filter(r => r.messageId === messageId);
  if (matches.length === 0) return '';
  const tags = matches.map(r => {
    const verb = r.rating === 'positive' ? 'endorsed' : 'flagged';
    return `[rating=${verb} via ${r.source}:${r.channel}]`;
  });
  return ' ' + tags.join(' ');
}

function _renderTurn(turnIndex, msg, ratingTag) {
  const role = (msg.role || 'unknown').toUpperCase();
  const id = msg.id ? `[msgId=${msg.id}]` : '';
  const text = _extractTextFromContent(msg.content);
  return `T${turnIndex} ${role} ${id}${ratingTag}: ${text}`.trim();
}

function compressTranscript({ messages, ratings, sessionMeta }) {
  if (!messages || messages.length === 0) return '';

  const rendered = messages.map((m, i) => ({
    msg: m,
    index: i + 1,
    text: _renderTurn(i + 1, m, _ratingTagFor(m.id, ratings)),
    hasFeedback: (ratings || []).some(r => r.messageId === m.id),
  }));

  const fullText = rendered.map(r => r.text).join('\n\n');
  const fullTokens = estimateTokens(fullText);

  let header = '';
  if (sessionMeta) {
    const { sessionId, agentId, messageCount } = sessionMeta;
    const endorsed = (ratings || []).filter(r => r.rating === 'positive').length;
    const flagged = (ratings || []).filter(r => r.rating === 'negative').length;
    header = `[Session ${sessionId || '?'}, agent=${agentId || '?'}, ${messageCount || messages.length} turns, ${endorsed} endorsed, ${flagged} flagged]\n\n`;
  }

  if (fullTokens <= TARGET_MAX_TOKENS) {
    return header + fullText;
  }

  // Sliding window: keep first N, all turns with feedback, last M
  const keepIndices = new Set();
  for (let i = 0; i < Math.min(COMPRESSION_KEEP_FIRST, rendered.length); i++) keepIndices.add(i);
  for (let i = Math.max(0, rendered.length - COMPRESSION_KEEP_LAST); i < rendered.length; i++) keepIndices.add(i);
  rendered.forEach((r, i) => { if (r.hasFeedback) keepIndices.add(i); });

  const sortedKeep = [...keepIndices].sort((a, b) => a - b);
  const out = [];
  let lastKept = -1;
  for (const idx of sortedKeep) {
    if (idx > lastKept + 1) {
      const omitted = idx - lastKept - 1;
      out.push(`... [${omitted} turns omitted, no signal] ...`);
    }
    out.push(rendered[idx].text);
    lastKept = idx;
  }
  return header + out.join('\n\n');
}

function _stripMarkdownFences(text) {
  return text.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
}

function parseAndValidateOutput(rawText, validMessageIds) {
  let parsed;
  try {
    parsed = JSON.parse(_stripMarkdownFences(rawText));
  } catch (e) {
    return { ok: false, error: `JSON parse error: ${e.message}` };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, error: 'output not an object' };
  }

  const requiredFields = ['schema_version', 'session_quality', 'flagged_messages', 'lessons', 'validated_examples'];
  for (const f of requiredFields) {
    if (!(f in parsed)) return { ok: false, error: `missing field: ${f}` };
  }

  const validIdSet = new Set(validMessageIds || []);

  // Drop flagged_messages entries with unknown messageId
  const flagged = (parsed.flagged_messages || []).filter(
    e => e && typeof e.messageId === 'string' && validIdSet.has(e.messageId)
  );

  // Drop validated_examples with unknown messageId
  const examples = (parsed.validated_examples || []).filter(
    e => e && typeof e.messageId === 'string' && validIdSet.has(e.messageId)
  );

  // Lessons: keep all, but filter evidence_message_ids
  const lessons = (parsed.lessons || []).map(l => ({
    ...l,
    evidence_message_ids: (l.evidence_message_ids || []).filter(id => validIdSet.has(id)),
  }));

  return {
    ok: true,
    data: {
      schema_version: parsed.schema_version,
      session_quality: parsed.session_quality,
      flagged_messages: flagged,
      lessons,
      validated_examples: examples,
    },
  };
}

/**
 * Reflect over a single session. Returns {status, summary, llmStats}.
 * Pure logic — all I/O and LLM are injected via `deps`.
 *
 * deps:
 *   - provider: { complete(req) → { text, inputTokens, outputTokens, modelUsed, providerLatencyMs } }
 *   - recordRating(rating)
 *   - upsertSessionSummary(summary)
 *   - writeLessonsForSession({workspace, sessionId, agentId, ownerId, llmOutput, jsonlPath, sessionMeta}) → filePath
 */
async function reflectSession({
  sessionId, agentId, ownerId,
  messages, ratings = [], workspace, jsonlPath,
  channel = 'all',
  deps,
  promptVersion = REFLECTION_PROMPT_VERSION,
  retryStrictOnParse = true,
}) {
  const startTime = Date.now();
  const messageCount = messages.length;
  const assistantMessages = messages.filter(m => m.role === 'assistant');

  // Skip evaluation
  const skip = evaluateSkip({ messages, ratings });
  if (skip.skip) {
    const summary = {
      sessionId, agentId, ownerId,
      messageCount,
      endorsedCount: ratings.filter(r => r.rating === 'positive').length,
      flaggedCount: ratings.filter(r => r.rating === 'negative').length,
      presumedGoodCount: assistantMessages.length - ratings.length,
      hallucinationRate: 0, endorsementRate: 0,
      reflectionStatus: skip.reason,
      reflectionSkipReason: skip.reason,
      lessonsExtracted: 0, examplesCaptured: 0,
      llmInputTokens: null, llmOutputTokens: null,
      promptVersion,
      reflectionAt: Date.now(),
      durationMs: Date.now() - startTime,
    };
    deps.upsertSessionSummary(summary);
    return { status: skip.reason, summary, llmStats: null };
  }

  // Compress
  const compactTranscript = compressTranscript({
    messages, ratings,
    sessionMeta: { sessionId, agentId, messageCount },
  });

  // LLM call (with optional retry on parse fail)
  const validIds = messages.map(m => m.id).filter(Boolean);
  let llmStats = null;
  let parsed = null;
  let attempts = 0;
  const maxAttempts = retryStrictOnParse ? 2 : 1;

  while (attempts < maxAttempts) {
    attempts++;
    let llmRes;
    try {
      const prompt = buildPrompt({ compactTranscript, retryStrict: attempts > 1 });
      llmRes = await deps.provider.complete({
        prompt,
        model: process.env.REFLECTION_LLM_MODEL || 'claude-haiku-4-5',
        responseFormat: 'json',
        timeoutMs: Number(process.env.REFLECTION_TIMEOUT_MS || 60000),
      });
    } catch (e) {
      const summary = _failedSummary({ sessionId, agentId, ownerId, messageCount, ratings,
        promptVersion, startTime, reason: `llm_error: ${e.message}` });
      deps.upsertSessionSummary(summary);
      return { status: 'failed', summary, llmStats: null };
    }
    llmStats = {
      inputTokens: llmRes.inputTokens,
      outputTokens: llmRes.outputTokens,
      modelUsed: llmRes.modelUsed,
      latencyMs: llmRes.providerLatencyMs,
    };

    const validation = parseAndValidateOutput(llmRes.text, validIds);
    if (validation.ok) {
      parsed = validation.data;
      break;
    }
    if (attempts >= maxAttempts) {
      const summary = _failedSummary({ sessionId, agentId, ownerId, messageCount, ratings,
        promptVersion, startTime, reason: `parse_error: ${validation.error}`,
        llmStats });
      deps.upsertSessionSummary(summary);
      return { status: 'failed', summary, llmStats };
    }
  }

  // Resolve flagged → record as nl_correction in message_ratings
  for (const f of parsed.flagged_messages) {
    deps.recordRating({
      messageId: f.messageId,
      sessionId, agentId, ownerId,
      channel: 'reflection', source: 'nl_correction', rating: 'negative',
      reason: f.evidence,
      raterExternalId: null,
      createdAt: Date.now(),
    });
  }

  // Compute counts (after NL corrections recorded)
  const totalAssistant = assistantMessages.length;
  const flaggedCount = parsed.flagged_messages.length + ratings.filter(r => r.rating === 'negative').length;
  const endorsedCount = ratings.filter(r => r.rating === 'positive').length;
  const presumedGoodCount = Math.max(0, totalAssistant - flaggedCount - endorsedCount);
  const hallucinationRate = totalAssistant > 0 ? flaggedCount / totalAssistant : 0;
  const endorsementRate = totalAssistant > 0 ? endorsedCount / totalAssistant : 0;

  // Safety net: skip lessons write if too many flagged
  const writeLessons = hallucinationRate <= SAFETY_FLAG_RATIO_THRESHOLD;
  let lessonsExtracted = 0;
  let examplesCaptured = 0;

  if (writeLessons && (parsed.lessons.length > 0 || parsed.validated_examples.length > 0)) {
    try {
      await deps.writeLessonsForSession({
        workspace, sessionId, agentId, ownerId,
        llmOutput: parsed,
        jsonlPath,
        sessionMeta: {
          sessionId, agentId, ownerId,
          messageCount: totalAssistant,
          endorsedCount, flaggedCount,
          hallucinationRate, sessionQuality: parsed.session_quality,
          promptVersion,
          reflectionAt: new Date().toISOString(),
        },
      });
      lessonsExtracted = parsed.lessons.length;
      examplesCaptured = parsed.validated_examples.length;
    } catch (e) {
      // Lessons write failure is logged but doesn't fail the whole reflection
    }
  }

  const summary = {
    sessionId, agentId, ownerId,
    messageCount: totalAssistant,
    endorsedCount, flaggedCount, presumedGoodCount,
    hallucinationRate, endorsementRate,
    reflectionStatus: 'completed',
    reflectionSkipReason: null,
    lessonsExtracted, examplesCaptured,
    llmInputTokens: llmStats?.inputTokens ?? null,
    llmOutputTokens: llmStats?.outputTokens ?? null,
    promptVersion,
    reflectionAt: Date.now(),
    durationMs: Date.now() - startTime,
  };
  deps.upsertSessionSummary(summary);

  return { status: 'completed', summary, llmStats };
}

function _failedSummary({ sessionId, agentId, ownerId, messageCount, ratings, promptVersion, startTime, reason, llmStats }) {
  const totalAssistant = messageCount;
  return {
    sessionId, agentId, ownerId,
    messageCount: totalAssistant,
    endorsedCount: ratings.filter(r => r.rating === 'positive').length,
    flaggedCount: ratings.filter(r => r.rating === 'negative').length,
    presumedGoodCount: 0,
    hallucinationRate: 0, endorsementRate: 0,
    reflectionStatus: 'failed',
    reflectionSkipReason: reason,
    lessonsExtracted: 0, examplesCaptured: 0,
    llmInputTokens: llmStats?.inputTokens ?? null,
    llmOutputTokens: llmStats?.outputTokens ?? null,
    promptVersion,
    reflectionAt: Date.now(),
    durationMs: Date.now() - startTime,
  };
}

function createReflectionQueue({ concurrency = 3, maxQueue = 50, runner }) {
  const pending = [];
  let inFlight = 0;

  function tick() {
    while (inFlight < concurrency && pending.length > 0) {
      const item = pending.shift();
      inFlight++;
      Promise.resolve()
        .then(() => runner(item.payload))
        .then(
          (res) => { inFlight--; item.resolve(res); tick(); },
          (err) => { inFlight--; item.reject(err); tick(); }
        );
    }
  }

  function enqueue(payload) {
    return new Promise((resolve, reject) => {
      if (pending.length + inFlight >= maxQueue + concurrency) {
        return reject(new Error(`reflection queue full (max=${maxQueue})`));
      }
      pending.push({ payload, resolve, reject });
      tick();
    });
  }

  function stats() {
    return { inFlight, pending: pending.length, concurrency, maxQueue };
  }

  return { enqueue, stats };
}

module.exports = {
  reflectSession,
  createReflectionQueue,
  evaluateSkip,
  compressTranscript,
  parseAndValidateOutput,
  estimateTokens,
  MIN_MESSAGE_COUNT,
  MIN_TRANSCRIPT_TOKEN_ESTIMATE,
  TARGET_MAX_TOKENS,
  SAFETY_FLAG_RATIO_THRESHOLD,
};
