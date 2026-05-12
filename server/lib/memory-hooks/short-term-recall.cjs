'use strict';
/**
 * short-term-recall — append entries to openclaw's short-term-recall.json store
 * using the same schema openclaw's memory-core uses, so the managed dreaming
 * cron promotes them to MEMORY.md normally.
 *
 * Schema reference: openclaw dist/short-term-promotion-Cd3cMDbx.js ~L880.
 *
 * We mirror the bits openclaw cares about for promotion:
 *   - key, path, startLine, endLine, source, snippet
 *   - recallCount, dailyCount, totalScore, maxScore
 *   - firstRecalledAt, lastRecalledAt
 *   - queryHashes (deduped sha1[:12] of lowercase queries)
 *   - recallDays (recent distinct YYYY-MM-DD bucket strings)
 *
 * Promotion thresholds (from openclaw defaults): score>=minScore,
 * recallCount>=3, uniqueQueries>=2. Each call here counts as one recall event
 * tied to one query hash, so 3 sessions with related queries cross threshold.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const STORE_REL_PATH = path.join('memory', '.dreams', 'short-term-recall.json');
const LOCK_REL_PATH  = path.join('memory', '.dreams', 'short-term-promotion.lock');
const MAX_QUERY_HASHES = 64;
const MAX_RECALL_DAYS = 64;

function normalizeMemoryPath(rawPath) {
  return String(rawPath || '').replaceAll('\\', '/').replace(/^\.\//, '');
}
function sha1Short(s) {
  return crypto.createHash('sha1').update(String(s || '')).digest('hex').slice(0, 12);
}
function hashQuery(q) {
  return sha1Short(String(q || '').toLowerCase());
}
function buildKey({ path: p, startLine, endLine }) {
  return `memory:${normalizeMemoryPath(p)}:${startLine || 1}:${endLine || 1}`;
}
function todayBucket(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function storePathFor(workspaceDir) {
  return path.join(workspaceDir, STORE_REL_PATH);
}
function lockPathFor(workspaceDir) {
  return path.join(workspaceDir, LOCK_REL_PATH);
}

function readStore(workspaceDir) {
  const file = storePathFor(workspaceDir);
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); }
  catch { return { version: 1, entries: {}, updatedAt: new Date().toISOString() }; }
}
function writeStore(workspaceDir, store) {
  const file = storePathFor(workspaceDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

/**
 * Record a batch of recall events for one query against one agent's recall store.
 *
 * @param {object} opts
 * @param {string} opts.workspaceDir
 * @param {string} opts.query
 * @param {Array<{path,startLine,endLine,snippet,score}>} opts.results
 */
function recordRecalls({ workspaceDir, query, results }) {
  if (!workspaceDir || !Array.isArray(results) || results.length === 0) return { recorded: 0 };
  const store = readStore(workspaceDir);
  store.entries = store.entries || {};
  const nowIso = new Date().toISOString();
  const today = todayBucket();
  const qHash = hashQuery(query);

  let recorded = 0;
  for (const r of results) {
    if (!r || !r.path) continue;
    const startLine = Math.max(1, Math.floor(r.startLine || 1));
    const endLine = Math.max(startLine, Math.floor(r.endLine || startLine));
    const score = Number.isFinite(r.score) ? r.score : 0;
    const snippet = String(r.snippet || '').trim().slice(0, 4000);
    const key = buildKey({ path: r.path, startLine, endLine });
    const prev = store.entries[key] || {};

    const existingQH = Array.isArray(prev.queryHashes) ? prev.queryHashes.slice() : [];
    const isNewQuery = !existingQH.includes(qHash);
    const newQH = isNewQuery ? [...existingQH, qHash].slice(-MAX_QUERY_HASHES) : existingQH;

    const existingDays = Array.isArray(prev.recallDays) ? prev.recallDays.slice() : [];
    const isNewDay = !existingDays.includes(today);
    const newDays = isNewDay ? [...existingDays, today].slice(-MAX_RECALL_DAYS) : existingDays;

    const recallCount = Math.max(0, Math.floor(prev.recallCount || 0)) + 1;
    const dailyCount = isNewDay
      ? 1
      : Math.max(1, Math.floor(prev.dailyCount || 0) + 1);
    const totalScore = Number(prev.totalScore || 0) + score;
    const maxScore = Math.max(Number(prev.maxScore || 0), score);

    store.entries[key] = {
      key,
      path: normalizeMemoryPath(r.path),
      startLine,
      endLine,
      source: 'memory',
      snippet: snippet || prev.snippet || '',
      recallCount,
      dailyCount,
      groundedCount: Math.max(0, Math.floor(prev.groundedCount || 0)),
      totalScore,
      maxScore,
      firstRecalledAt: prev.firstRecalledAt || nowIso,
      lastRecalledAt: nowIso,
      queryHashes: newQH,
      recallDays: newDays,
      conceptTags: Array.isArray(prev.conceptTags) ? prev.conceptTags : [],
      ...(prev.promotedAt ? { promotedAt: prev.promotedAt } : {}),
    };
    recorded++;
  }
  store.updatedAt = nowIso;
  writeStore(workspaceDir, store);
  return { recorded };
}

module.exports = {
  storePathFor,
  lockPathFor,
  readStore,
  writeStore,
  recordRecalls,
  hashQuery,
  buildKey,
};
