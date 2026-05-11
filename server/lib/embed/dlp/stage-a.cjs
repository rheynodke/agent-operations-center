'use strict';

// DLP Stage A — regex sweep over a single text string.
// Returns { text: <redacted>, redactions: [...] }
//
// Key design notes:
// - catalog patterns do NOT carry /g flag (stateless for .test() callers).
// - _findMatches() recompiles each pattern with /g at call time so exec()
//   loops work correctly without shared lastIndex state across invocations.
// - compiled-with-g patterns are cached at module load to avoid per-call cost.
// - pii-credit-card matches are post-filtered through Luhn validation.

const cat = require('./regex-catalog.cjs');

// --- Luhn validator ---

function _luhnValid(numStr) {
  const digits = numStr.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

// --- Build a compiled-with-g cache keyed by pattern id ---
// Populated lazily on first _findMatches call.
const _gCache = new Map();

function _getGRegex(p) {
  if (_gCache.has(p.id)) return _gCache.get(p.id);
  const flags = p.regex.flags.includes('g') ? p.regex.flags : p.regex.flags + 'g';
  const re = new RegExp(p.regex.source, flags);
  _gCache.set(p.id, re);
  return re;
}

// --- Core match finder ---

function _findMatches(text, patterns) {
  const out = [];
  for (const p of patterns) {
    const re = _getGRegex(p);
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      // Avoid infinite loop on zero-length matches (safety guard)
      if (m.index === re.lastIndex) {
        re.lastIndex++;
        continue;
      }
      // Credit card: only emit when Luhn checksum passes
      if (p.id === 'pii-credit-card' && !_luhnValid(m[0])) continue;
      out.push({
        start: m.index,
        end: m.index + m[0].length,
        match: m[0],
        reason: p.reason,
        category: p.category,
        severity: p.severity,
        patternId: p.id,
      });
    }
  }
  return out;
}

// --- Allowlist filter ---

function _applyAllowlist(matches, allowlistPatterns) {
  if (!allowlistPatterns || !allowlistPatterns.length) return matches;
  return matches.filter(m => {
    for (const al of allowlistPatterns) {
      try {
        // Escape regex metacharacters in allowlist strings so plain text
        // like "/Users/alice" is matched literally.
        const escaped = al.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
        // Allow if the matched text contains the allowlist string
        const re = new RegExp(escaped);
        if (re.test(m.match)) return false;
      } catch {
        // Invalid allowlist pattern — skip it safely
      }
    }
    return true;
  });
}

// --- Overlap resolver ---
// Sort by start asc, end desc; drop later matches wholly contained in
// an earlier match's span.

function _resolveOverlaps(matches) {
  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  let lastEnd = -1;
  for (const m of matches) {
    if (m.start >= lastEnd) {
      out.push(m);
      lastEnd = m.end;
    }
  }
  return out;
}

// --- Redaction renderer ---

function _renderRedacted(text, redactions) {
  if (!redactions.length) return text;
  const sorted = [...redactions].sort((a, b) => a.start - b.start);
  let out = '';
  let cursor = 0;
  for (const r of sorted) {
    out += text.slice(cursor, r.start);
    out += `[redacted:${r.reason}]`;
    cursor = r.end;
  }
  out += text.slice(cursor);
  return out;
}

// --- Public API ---

/**
 * scan(text, opts) → { text: string, redactions: Array }
 *
 * @param {string} text
 * @param {{ preset?: string, allowlistPatterns?: string[] }} opts
 * @returns {{ text: string, redactions: Array<{start,end,match,reason,category,severity,patternId}> }}
 */
function scan(text, { preset = 'internal-tool-default', allowlistPatterns = [] } = {}) {
  if (!text || typeof text !== 'string') return { text: text || '', redactions: [] };

  const patterns = cat.getPatternsForPreset(preset);
  const raw = _findMatches(text, patterns);
  const filtered = _applyAllowlist(raw, allowlistPatterns);
  const redactions = _resolveOverlaps(filtered);

  return { text: _renderRedacted(text, redactions), redactions };
}

module.exports = { scan, _luhnValid, _findMatches, _applyAllowlist, _resolveOverlaps, _renderRedacted };
