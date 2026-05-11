'use strict';

// DLP Stage B — Haiku LLM scanner.
// Invoked after Stage A when heuristic triggers indicate deeper inspection is
// warranted (code blocks, long responses, refusal patterns, prompt-leak signals).
//
// Design notes:
// - `scan()` never throws — all errors surface as { failed: true, ... }.
// - Provider is injected so tests can mock without spawning a real subprocess.
// - Timeout is enforced via Promise.race; on timeout the error path fires.
// - `parseProviderResponse` accepts both raw JSON and JSON embedded in prose.

const SYSTEM_PROMPT = `You are a DLP filter. Inspect the agent response below. Flag any:
1. Absolute filesystem paths (Unix or Windows)
2. Credentials, tokens, API keys, passwords
3. Internal config filenames (openclaw.json, .env, .db, etc.)
4. Cross-tenant data leak (other users' info, other agents' data)

Output JSON only, no prose: {"clean": <bool>, "redactions": [{"start": <int>, "end": <int>, "reason": <string>, "severity": "info"|"warning"|"critical"}]}.

Be conservative. Prefer false positives over false negatives.`;

/**
 * Determine whether the text warrants a Stage B LLM scan.
 *
 * Triggers:
 * - Length > 1500 chars (higher density of potential leaks)
 * - Contains code blocks (``` markers)
 * - Refusal patterns that may indicate prompt extraction attempt
 * - Prompt-leak signals ("my system prompt", "I was told", etc.)
 *
 * @param {string} text
 * @returns {boolean}
 */
function shouldRunStageB(text) {
  if (!text) return false;
  if (text.length > 1500) return true;
  if (/```/.test(text)) return true;
  if (/I (cannot|can't|won't) (share|reveal|tell|provide)/i.test(text)) return true;
  if (/(my system prompt|my instructions|I was told)/i.test(text)) return true;
  return false;
}

/**
 * Parse the raw string returned by the LLM provider.
 * Tries direct JSON.parse first; falls back to extracting the first `{...}`
 * block from prose-wrapped output.
 *
 * @param {string} raw
 * @returns {{ clean: boolean, redactions: Array }|null}
 */
function parseProviderResponse(raw) {
  if (!raw || typeof raw !== 'string') return null;
  // Try direct parse first (happy path — well-behaved model)
  try { return JSON.parse(raw); } catch { /* fall through */ }
  // Extract first {...} block from prose-wrapped response
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

/**
 * Run the LLM DLP scan against the given text.
 *
 * @param {string} text — The agent response to inspect.
 * @param {{ provider?: object, timeoutMs?: number }} opts
 *   provider — object with `generate({ prompt, maxTokens }) → Promise<{ text }>`.
 *              Pass undefined/null to get a fast no-op failure result.
 *   timeoutMs — abort LLM call after this many ms (default 5000).
 * @returns {Promise<{
 *   failed: boolean,
 *   reason?: string,
 *   clean?: boolean,
 *   redactions: Array
 * }>}
 */
async function scan(text, { provider, timeoutMs = 5000 } = {}) {
  if (!provider) {
    return { failed: true, reason: 'no-provider', redactions: [] };
  }

  const prompt = `${SYSTEM_PROMPT}\n\n---\nAGENT RESPONSE TO INSPECT:\n${text}\n---`;

  try {
    const racePromise = provider.generate({ prompt, maxTokens: 800 });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), timeoutMs)
    );
    const result = await Promise.race([racePromise, timeoutPromise]);

    const parsed = parseProviderResponse(result.text || '');
    if (!parsed) {
      return { failed: true, reason: 'parse-error', redactions: [] };
    }

    return {
      failed: false,
      clean: !!parsed.clean,
      redactions: Array.isArray(parsed.redactions) ? parsed.redactions : [],
    };
  } catch (e) {
    return { failed: true, reason: e.message || 'unknown', redactions: [] };
  }
}

module.exports = { shouldRunStageB, parseProviderResponse, scan, SYSTEM_PROMPT };
