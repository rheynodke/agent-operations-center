'use strict';
/**
 * qmd-client — shell wrapper around the `qmd` CLI scoped to an agent's
 * per-agent qmd home (where openclaw stores the agent's index).
 *
 * Per-agent qmd home layout (created by openclaw gateway):
 *   <agentsDir>/<agentId>/qmd/xdg-cache/qmd/index.sqlite
 *   <agentsDir>/<agentId>/qmd/xdg-config/qmd/index.yml
 *
 * The CLI honors XDG_CACHE_HOME / XDG_CONFIG_HOME, so we set those env vars
 * to point at the agent's qmd home, then exec.
 */
const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');

const QMD_BIN = process.env.QMD_BIN || 'qmd';
const QUERY_TIMEOUT_MS = 8000;

function qmdHomeFor(agentsDir, agentId) {
  return path.join(agentsDir, agentId, 'qmd');
}

function qmdIndexExists(qmdHome) {
  return fs.existsSync(path.join(qmdHome, 'xdg-cache', 'qmd', 'index.sqlite'));
}

/**
 * Run `qmd query` for a single agent. Returns parsed hits or [] on any error.
 * @param {object} opts
 * @param {string} opts.query
 * @param {string} opts.qmdHome     — <agentsDir>/<agentId>/qmd
 * @param {string[]} [opts.collections]  — defaults to memory-only ones
 * @param {number} [opts.topN]      — defaults to 3
 * @param {number} [opts.minScore]  — 0-1, defaults to 0.6
 */
function query(opts) {
  return new Promise((resolve) => {
    if (!opts || !opts.query || !opts.qmdHome) return resolve([]);
    if (!qmdIndexExists(opts.qmdHome)) return resolve([]);

    const topN = opts.topN || 3;
    const minScore = opts.minScore == null ? 0.6 : opts.minScore;
    const collections = opts.collections && opts.collections.length
      ? opts.collections
      : null;

    const args = ['query', opts.query, '--json'];
    if (collections) for (const c of collections) args.push('--collection', c);

    const env = {
      ...process.env,
      XDG_CACHE_HOME: path.join(opts.qmdHome, 'xdg-cache'),
      XDG_CONFIG_HOME: path.join(opts.qmdHome, 'xdg-config'),
    };

    let settled = false;
    const child = execFile(QMD_BIN, args, { env, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (settled) return;
      settled = true;
      if (err) return resolve([]);
      let parsed;
      try { parsed = JSON.parse(stdout); } catch { return resolve([]); }
      const results = Array.isArray(parsed) ? parsed
        : Array.isArray(parsed?.results) ? parsed.results
        : [];
      const filtered = results
        .filter(r => (r.score == null || r.score >= minScore))
        .slice(0, topN)
        .map(r => ({
          path: r.file || r.path || r.url || r.source || '',
          docid: r.docid || null,
          score: r.score ?? null,
          startLine: r.startLine ?? r.start_line ?? null,
          endLine: r.endLine ?? r.end_line ?? null,
          title: r.title || '',
          snippet: (r.snippet || r.text || r.content || '').replace(/^@@[^\n]*\n+/, '').trim(),
        }))
        .filter(r => r.path && r.snippet);
      resolve(filtered);
    });
    setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch {}
      resolve([]);
    }, QUERY_TIMEOUT_MS);
  });
}

module.exports = { qmdHomeFor, qmdIndexExists, query };
