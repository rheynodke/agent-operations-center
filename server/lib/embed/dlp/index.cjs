'use strict';

// DLP filter orchestrator — combines Stage A (regex sweep) and Stage B (LLM scan).
//
// Flow:
//   1. Run Stage A → collect redactions
//   2. If provider AND shouldRunStageB(text): run Stage B with timeout
//   3. If Stage B failed → set stageBFailed=true, skip Stage B redactions
//   4. If Stage B succeeded → merge Stage B redactions (with offsets) into list
//   5. If redactions.length > HARD_BLOCK_THRESHOLD → return action='block'
//   6. If 0 redactions → return action='pass' with original text
//   7. Else → render redacted (resolve overlaps via sort-by-start + drop-contained)

const stageA = require('./stage-a.cjs');
const stageB = require('./stage-b.cjs');

const HARD_BLOCK_THRESHOLD = 3;
const HARD_BLOCK_MESSAGE = 'Maaf, saya tidak bisa menjawab itu. Coba pertanyaan lain.';

/**
 * filter(text, opts) — async DLP orchestrator.
 *
 * @param {string} text — agent response text to filter
 * @param {{
 *   preset?: string,
 *   provider?: object,
 *   allowlistPatterns?: string[],
 *   stageBTimeoutMs?: number
 * }} opts
 * @returns {Promise<{
 *   action: 'pass'|'redact'|'block',
 *   text: string,
 *   redactions: Array,
 *   stageBRan: boolean,
 *   stageBFailed: boolean
 * }>}
 */
async function filter(text, {
  preset = 'internal-tool-default',
  provider = null,
  allowlistPatterns = [],
  stageBTimeoutMs = 5000,
} = {}) {
  // --- Stage A ---
  const a = stageA.scan(text, { preset, allowlistPatterns });
  let allRedactions = [...a.redactions];

  // --- Stage B (conditional + best-effort) ---
  let stageBRan = false;
  let stageBFailed = false;

  if (provider && stageB.shouldRunStageB(text)) {
    stageBRan = true;
    const b = await stageB.scan(text, { provider, timeoutMs: stageBTimeoutMs });
    if (b.failed) {
      stageBFailed = true;
      // Fall through to Stage A results only — do NOT block on Stage B failure
    } else if (Array.isArray(b.redactions)) {
      // Merge Stage B redactions; offsets are against original text
      for (const r of b.redactions) {
        if (typeof r.start === 'number' && typeof r.end === 'number' && r.end > r.start) {
          allRedactions.push({
            start: r.start,
            end: r.end,
            match: text.slice(r.start, r.end),
            reason: r.reason || 'stage-b',
            category: 'stage-b',
            severity: r.severity || 'warning',
            patternId: 'stage-b',
          });
        }
      }
    }
  }

  // --- Hard-block check ---
  if (allRedactions.length > HARD_BLOCK_THRESHOLD) {
    return {
      action: 'block',
      text: HARD_BLOCK_MESSAGE,
      redactions: allRedactions,
      stageBRan,
      stageBFailed,
    };
  }

  // --- Pass-through (no redactions) ---
  if (allRedactions.length === 0) {
    return { action: 'pass', text, redactions: [], stageBRan, stageBFailed };
  }

  // --- Render combined redactions (resolve overlaps) ---
  // Sort by start asc, end desc — then drop matches wholly contained in an earlier span
  allRedactions.sort((x, y) => x.start - y.start || y.end - x.end);
  const merged = [];
  let lastEnd = -1;
  for (const r of allRedactions) {
    if (r.start >= lastEnd) {
      merged.push(r);
      lastEnd = r.end;
    }
  }

  let out = '';
  let cursor = 0;
  for (const r of merged) {
    out += text.slice(cursor, r.start);
    out += `[redacted:${r.reason}]`;
    cursor = r.end;
  }
  out += text.slice(cursor);

  return { action: 'redact', text: out, redactions: merged, stageBRan, stageBFailed };
}

module.exports = { filter, HARD_BLOCK_THRESHOLD, HARD_BLOCK_MESSAGE };
