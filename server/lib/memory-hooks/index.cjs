'use strict';
/**
 * memory-hooks — AOC-side memory layer that wraps openclaw's qmd + dreaming.
 *
 * Provides:
 *   - preInjectMemory(sessionKey, userText) → string with <persistent-memory>
 *     block prepended (or unchanged userText if nothing to inject).
 *   - onAssistantFinal(sessionKey, userText, assistantText) → fire-and-forget
 *     post-turn lesson extractor + verifier.
 *
 * Token-efficiency principles:
 *   - qmd query only on first turn of a session OR when topic-shift detected.
 *   - Per-session injection cache to dedupe lessons already shown.
 *   - Cap at 3 results, snippet ~400 chars each.
 *   - Skip when user text is too short / continuation-like.
 *   - Extractor: regex pre-filter, only spawn LLM (claude haiku) when matched.
 *   - All side effects are best-effort; never throw to caller.
 */
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { OPENCLAW_HOME, AGENTS_DIR, getUserHome, getUserAgentsDir } = require('../config.cjs');

const qmd = require('./qmd-client.cjs');
const recall = require('./short-term-recall.cjs');

const MAX_INJECT_RESULTS = 3;
const SNIPPET_CAP = 420;
const SHORT_USER_TEXT_WORDS = 2;
const SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const EXTRACTOR_REGEX = /(\binget\b|\bingat\b|\bcatet\b|\bcatat\b|\bjangan lagi\b|\bnext time\b|\baturan\b|rule baru|\bremember this\b|\bsave to memory\b|\bbiar gak salah\b)/i;
const ASSISTANT_PROMISE_REGEX = /(aku catat|sudah kucatat|kucatet|akan kuingat|saved to memory|catatannya disimpan|RULE BARU|kucatat di memory)/i;

const CLAUDE_BIN = process.env.CLAUDE_BIN || '/Users/itdke/.local/bin/claude';
const EXTRACTOR_MODEL = process.env.AOC_MEMORY_EXTRACTOR_MODEL || 'claude-haiku-4-5';

// ── Session cache ────────────────────────────────────────────────────────────
// Keyed by sessionKey. Holds:
//   - lastTopicFingerprint: Set<string> of significant tokens from last query
//   - injectedKeys: Set<string> of qmd entry keys already shown this session
//   - lastUserMsgAt: number (ms) — for TTL eviction
const sessionCache = new Map();

function fingerprint(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 4)
      .slice(0, 12)
  );
}
function topicShifted(prev, next) {
  if (!prev) return true;
  let overlap = 0;
  for (const w of next) if (prev.has(w)) overlap++;
  return next.size === 0 ? false : overlap / next.size < 0.5;
}
function evictStale(now = Date.now()) {
  for (const [k, v] of sessionCache.entries()) {
    if (now - (v.lastUserMsgAt || 0) > SESSION_TTL_MS) sessionCache.delete(k);
  }
}

// ── Path resolution ──────────────────────────────────────────────────────────
function parseSessionKey(sessionKey) {
  // Format: "agent:<agentId>:..." (per CLAUDE.md)
  if (typeof sessionKey !== 'string') return { agentId: null };
  const parts = sessionKey.split(':');
  return { agentId: parts[1] || null };
}
function homeAndAgentsFor(ownerUserId) {
  const o = ownerUserId == null || Number(ownerUserId) === 1 ? null : Number(ownerUserId);
  return o == null
    ? { home: OPENCLAW_HOME, agentsDir: AGENTS_DIR }
    : { home: getUserHome(o), agentsDir: getUserAgentsDir(o) };
}
function resolveAgentContext(agentId) {
  // Returns { agentsDir, workspaceDir } by looking up owner via db.
  try {
    const db = require('../db.cjs');
    const owner = db.getAgentOwner ? db.getAgentOwner(agentId) : null;
    const { home, agentsDir } = homeAndAgentsFor(owner);
    return {
      ownerUserId: owner == null ? 1 : Number(owner),
      home,
      agentsDir,
      workspaceDir: path.join(home, 'workspace'),
      qmdHome: qmd.qmdHomeFor(agentsDir, agentId),
    };
  } catch { return null; }
}
function memoryCollectionsForAgent(agentId) {
  // openclaw's index.yml uses these naming conventions; aoc-lessons is preferred,
  // then memory-dir/memory-root. We exclude sessions-* (too noisy).
  return [
    `aoc-lessons-${agentId}`,
    `memory-dir-${agentId}`,
    `memory-root-${agentId}`,
  ];
}

// ── Hook 1: preInjectMemory ─────────────────────────────────────────────────
async function preInjectMemory(sessionKey, userText) {
  try {
    if (typeof userText !== 'string' || !userText.trim()) return userText;
    const { agentId } = parseSessionKey(sessionKey);
    if (!agentId) return userText;
    const wordCount = userText.trim().split(/\s+/).length;
    if (wordCount < SHORT_USER_TEXT_WORDS) return userText;

    evictStale();
    const cached = sessionCache.get(sessionKey) || { injectedKeys: new Set(), lastUserMsgAt: 0 };
    const now = Date.now();
    const newFp = fingerprint(userText);
    const isFirstTurn = !cached.lastTopicFingerprint;
    const isShifted = isFirstTurn || topicShifted(cached.lastTopicFingerprint, newFp);

    cached.lastTopicFingerprint = newFp;
    cached.lastUserMsgAt = now;
    sessionCache.set(sessionKey, cached);

    if (!isShifted) return userText; // continuation: no new qmd query

    const ctx = resolveAgentContext(agentId);
    if (!ctx) return userText;
    if (!qmd.qmdIndexExists(ctx.qmdHome)) return userText;

    // Two-query strategy: literal + domain hint (first content word + "memory rule")
    const domainWords = [...newFp].slice(0, 3).join(' ');
    const queries = [userText.trim(), domainWords ? `${domainWords} rule pattern` : null].filter(Boolean);
    const allHits = [];
    for (const q of queries) {
      const hits = await qmd.query({
        query: q,
        qmdHome: ctx.qmdHome,
        collections: memoryCollectionsForAgent(agentId),
        topN: MAX_INJECT_RESULTS,
        minScore: 0.4,
      });
      for (const h of hits) allHits.push({ ...h, _q: q });
    }
    if (allHits.length === 0) return userText;

    // Dedup by path+startLine, prefer higher score, exclude already-injected this session
    const byKey = new Map();
    for (const h of allHits) {
      const k = `memory:${h.path.replace(/^qmd:\/\/[^/]+\//, '')}:${h.startLine || 1}:${h.endLine || 1}`;
      if (cached.injectedKeys.has(k)) continue;
      const prev = byKey.get(k);
      if (!prev || (h.score || 0) > (prev.score || 0)) byKey.set(k, { ...h, _key: k });
    }
    const ranked = [...byKey.values()].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, MAX_INJECT_RESULTS);
    if (ranked.length === 0) return userText;

    // Update injected cache + recall store (feeds dreaming pipeline)
    for (const h of ranked) cached.injectedKeys.add(h._key);
    try {
      recall.recordRecalls({
        workspaceDir: ctx.workspaceDir,
        query: userText,
        results: ranked.map(h => ({
          path: h.path.replace(/^qmd:\/\/[^/]+\//, ''),
          startLine: h.startLine,
          endLine: h.endLine,
          snippet: h.snippet,
          score: h.score,
        })),
      });
    } catch { /* best-effort */ }

    // Build injection block
    const lines = ['<persistent-memory source="aoc-memory-hooks">'];
    for (const h of ranked) {
      const title = h.title || h.path.split('/').pop();
      const snip = h.snippet.length > SNIPPET_CAP ? h.snippet.slice(0, SNIPPET_CAP) + '…' : h.snippet;
      lines.push(`[${title}] ${snip}`);
    }
    lines.push('</persistent-memory>');
    return `${lines.join('\n')}\n\n${userText}`;
  } catch (e) {
    // Never block user message on memory hook failures
    if (process.env.AOC_MEMORY_HOOK_DEBUG) console.warn('[memory-hooks/preinject]', e.message);
    return userText;
  }
}

// ── Hook 2: extractor (post-turn, fire-and-forget) ──────────────────────────
function runClaudeForExtraction(prompt, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let out = '', err = '';
    let settled = false;
    const child = spawn(CLAUDE_BIN, ['-p', '--model', EXTRACTOR_MODEL], { stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('close', () => {
      if (settled) return; settled = true;
      resolve({ ok: true, stdout: out, stderr: err });
    });
    child.on('error', () => {
      if (settled) return; settled = true;
      resolve({ ok: false, stdout: '', stderr: err });
    });
    child.stdin.end(prompt);
    setTimeout(() => {
      if (settled) return; settled = true;
      try { child.kill('SIGKILL'); } catch {}
      resolve({ ok: false, stdout: out, stderr: 'timeout' });
    }, timeoutMs);
  });
}

function parseExtractionOutput(stdout) {
  if (!stdout) return null;
  // Claude haiku tends to wrap JSON in ```json blocks. Strip fences.
  const stripped = stdout
    .replace(/^[\s\S]*?```(?:json)?\s*/i, '')
    .replace(/```[\s\S]*$/, '')
    .trim();
  const candidate = stripped || stdout.trim();
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && parsed.lesson && typeof parsed.lesson === 'string' && parsed.lesson.trim()) {
      return {
        lesson: parsed.lesson.trim(),
        title: (parsed.title || 'lesson').trim().slice(0, 60),
      };
    }
  } catch { /* fallthrough */ }
  return null;
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'lesson';
}

async function extractAndPersistLesson({ sessionKey, userText, assistantText, agentCtx }) {
  const prompt = `You are extracting a single durable lesson from a chat turn so an agent can remember it across sessions.

User said:
"""${userText.slice(0, 2000)}"""

Assistant replied:
"""${assistantText.slice(0, 2000)}"""

Task: If the user taught the assistant a rule, preference, or fact that should
be remembered FOREVER (not just for this conversation), extract it.

Output strict JSON, nothing else:
{"title": "<3-7 word slug>", "lesson": "<one-paragraph rule in same language user used. Include why if user gave a reason.>"}

If there is no durable lesson, output exactly:
{"title": null, "lesson": null}

No prose, no markdown, JSON only.`;

  const r = await runClaudeForExtraction(prompt);
  if (!r.ok) return null;
  const parsed = parseExtractionOutput(r.stdout);
  if (!parsed || !parsed.lesson) return null;

  const dateStr = new Date().toISOString().slice(0, 10);
  const slug = slugify(parsed.title);
  const file = path.join(agentCtx.workspaceDir, 'memory', `${dateStr}-${slug}.md`);
  if (fs.existsSync(file)) return null; // avoid clobber
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = `# ${parsed.title}\n\n**Date:** ${dateStr}\n**Source:** auto-extracted by aoc-memory-hooks from session ${sessionKey}\n\n${parsed.lesson}\n`;
  fs.writeFileSync(file, body, 'utf-8');
  return { file, title: parsed.title };
}

async function onAssistantFinal(sessionKey, userText, assistantText) {
  try {
    if (typeof userText !== 'string' || typeof assistantText !== 'string') return;
    const triggerUser = EXTRACTOR_REGEX.test(userText);
    const triggerAssistant = ASSISTANT_PROMISE_REGEX.test(assistantText);
    if (!triggerUser && !triggerAssistant) return;

    const { agentId } = parseSessionKey(sessionKey);
    if (!agentId) return;
    const ctx = resolveAgentContext(agentId);
    if (!ctx) return;

    // Fire async — do NOT await; caller is a WS broadcast path.
    extractAndPersistLesson({ sessionKey, userText, assistantText, agentCtx: ctx })
      .then((r) => { if (r && process.env.AOC_MEMORY_HOOK_DEBUG) console.log('[memory-hooks/extracted]', r.file); })
      .catch((e) => { if (process.env.AOC_MEMORY_HOOK_DEBUG) console.warn('[memory-hooks/extractor]', e.message); });
  } catch (e) {
    if (process.env.AOC_MEMORY_HOOK_DEBUG) console.warn('[memory-hooks/onAssistantFinal]', e.message);
  }
}

// Track last user turn per session so extractor has the right user text at final time.
const lastUserTurn = new Map();
function captureUserTurn(sessionKey, userText) {
  if (!sessionKey || typeof userText !== 'string') return;
  lastUserTurn.set(sessionKey, { text: userText, at: Date.now() });
}
function getLastUserTurn(sessionKey) {
  return lastUserTurn.get(sessionKey)?.text || '';
}

module.exports = {
  preInjectMemory,
  onAssistantFinal,
  captureUserTurn,
  getLastUserTurn,
  // Exported for tests:
  _internal: { fingerprint, topicShifted, parseExtractionOutput, sessionCache, lastUserTurn },
};
