'use strict';

/**
 * Normalize an origin string: lowercase + trim.
 * Returns null if origin is falsy or non-string.
 * @param {string|null|undefined} origin
 * @returns {string|null}
 */
function _normalize(origin) {
  if (!origin || typeof origin !== 'string') return null;
  return origin.trim().toLowerCase();
}

/**
 * Compile a wildcard pattern into a RegExp.
 *
 * Rules:
 * - All regex meta-characters are escaped EXCEPT `*`.
 * - `*` becomes `[^/]*` (matches any character except `/`).
 * - Overly permissive patterns (`*`, `.*`, `*.*`) throw an Error.
 *
 * @param {string} pattern
 * @returns {RegExp}
 * @throws {Error} if pattern is empty, invalid, or too permissive
 */
function compilePattern(pattern) {
  if (!pattern || typeof pattern !== 'string') {
    throw new Error('Invalid pattern: empty');
  }
  const trimmed = pattern.trim().toLowerCase();
  if (trimmed === '*' || trimmed === '.*' || trimmed === '*.*') {
    throw new Error('Pattern too permissive: ' + pattern);
  }
  // Escape all regex meta-chars except `*`.
  // Then replace `*` with the appropriate wildcard:
  //   - `[^/]*` for patterns that include a scheme (`://`), so that the
  //     wildcard only matches within a single path segment (e.g. `http://localhost:*`).
  //   - `.*` for scheme-less patterns (e.g. `*.local`), where the `*` must
  //     span the scheme + subdomain prefix (e.g. matching `http://staging.local`).
  const hasScheme = trimmed.includes('://');
  const wildcardReplacement = hasScheme ? '[^/]*' : '.*';
  const escaped = trimmed
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, wildcardReplacement);
  return new RegExp(`^${escaped}$`);
}

/**
 * Check whether an incoming HTTP `Origin` header is allowed.
 *
 * Matching order:
 * 1. Exact match against `productionOrigin` → source: 'production'
 * 2. Loop through `devOrigins` compiled patterns → source: 'dev'
 * 3. No match → { matched: false }
 *
 * Invalid / overly-permissive devOrigin patterns are silently skipped
 * (validation should happen at save time when the embed is created/updated).
 *
 * @param {string|null} origin - value from `Origin` request header
 * @param {{ productionOrigin: string, devOrigins?: string[] }} config
 * @returns {{ matched: boolean, source?: 'production'|'dev' }}
 */
function matchOrigin(origin, { productionOrigin, devOrigins = [] }) {
  const o = _normalize(origin);
  if (!o) return { matched: false };

  const prod = _normalize(productionOrigin);
  if (prod && o === prod) return { matched: true, source: 'production' };

  for (const pat of devOrigins) {
    try {
      const re = compilePattern(pat);
      if (re.test(o)) return { matched: true, source: 'dev' };
    } catch {
      // Skip invalid / overly-permissive patterns silently.
      // Validation happens at embed create/update time.
    }
  }

  return { matched: false };
}

module.exports = { matchOrigin, compilePattern };
