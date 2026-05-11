'use strict';

// server/lib/embed/dlp-tester.cjs
// DLP allowlist tester — thin wrapper around stage-A scan.
//
// Lets the embed owner paste arbitrary text and see:
//   - which stage-A regex patterns would fire
//   - what the redacted output would look like
//   - warnings for invalid allowlist regex entries
//
// Text length cap is enforced at the route layer (10_000 chars), NOT here.
// This module is pure logic with no I/O.

const stageA = require('./dlp/stage-a.cjs');

/**
 * Validate allowlist entries and split them into:
 *   - valid:   entries that compile as regex
 *   - warnings: one string per invalid entry
 *
 * The stage-A internal _applyAllowlist silently skips invalid regex, so to
 * surface warnings we pre-validate here before calling scan().
 *
 * @param {string[]} allowlist
 * @returns {{ validAllowlist: string[], warnings: string[] }}
 */
function _validateAllowlist(allowlist) {
  const validAllowlist = [];
  const warnings = [];

  for (const pattern of allowlist) {
    try {
      // stage-A escapes plain strings when applying allowlist, but here we want
      // to let the user specify actual regex patterns too. We attempt to compile
      // the pattern as a regex to detect syntax errors.
      // eslint-disable-next-line no-new
      new RegExp(pattern);
      validAllowlist.push(pattern);
    } catch (err) {
      warnings.push(`invalid regex: ${pattern} (${err.message})`);
    }
  }

  return { validAllowlist, warnings };
}

/**
 * testText({ text, preset, allowlist }) → { matches, redacted, warnings }
 *
 * @param {{ text: string, preset?: string, allowlist?: string[] }} opts
 * @returns {{
 *   matches: Array<{type: string, text: string, start: number, end: number}>,
 *   redacted: string,
 *   warnings: string[]
 * }}
 */
function testText({ text, preset = 'internal-tool-default', allowlist = [] } = {}) {
  // Edge case: empty or non-string text
  if (!text || typeof text !== 'string') {
    return { matches: [], redacted: text || '', warnings: [] };
  }

  // Validate allowlist entries — collect warnings for bad regex, pass valid
  // ones through to stage-A.
  const { validAllowlist, warnings } = _validateAllowlist(allowlist);

  // Run stage-A scan with valid allowlist entries only.
  const { text: redacted, redactions } = stageA.scan(text, {
    preset,
    allowlistPatterns: validAllowlist,
  });

  // Map stage-A redaction objects to the public shape: {type, text, start, end}
  // type  → patternId (e.g. "pii-email", "fs-users", "cred-env-style")
  // text  → the matched string
  const matches = redactions.map(r => ({
    type: r.patternId,
    text: r.match,
    start: r.start,
    end: r.end,
  }));

  return { matches, redacted, warnings };
}

module.exports = { testText };
