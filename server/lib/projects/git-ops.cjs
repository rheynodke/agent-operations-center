'use strict';

// Read-only git CLI wrappers + a single mutating op (checkout) for project
// workspace binding. All commands run via execFile (no shell), with a strict
// timeout. Never destructive: no --force, no reset, no clean. Caller is
// responsible for refusing to checkout into a dirty working tree.

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEFAULT_TIMEOUT_MS = 8000;
const FETCH_TIMEOUT_MS = 15000;

function run(args, opts = {}) {
  const cwd = opts.cwd;
  const timeout = opts.timeout || DEFAULT_TIMEOUT_MS;
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        code: err ? (err.code ?? 1) : 0,
        signal: err && err.signal,
        stdout: stdout?.toString() ?? '',
        stderr: stderr?.toString() ?? '',
        error: err ? (err.message || String(err)) : null,
      });
    });
  });
}

async function isGitRepo(cwd) {
  if (!cwd) return false;
  try {
    const st = fs.statSync(cwd);
    if (!st.isDirectory()) return false;
  } catch { return false; }
  const r = await run(['rev-parse', '--is-inside-work-tree'], { cwd });
  return r.ok && r.stdout.trim() === 'true';
}

async function getCurrentBranch(cwd) {
  const r = await run(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
  if (!r.ok) return null;
  const v = r.stdout.trim();
  return v === 'HEAD' ? null : v; // null = detached
}

async function getStatus(cwd) {
  const r = await run(['status', '--porcelain=v1', '-uall'], { cwd });
  if (!r.ok) return { isDirty: false, uncommittedFiles: [] };
  const files = r.stdout.split('\n').filter(Boolean).map((line) => {
    // first 2 chars = XY status, then space, then path
    const code = line.slice(0, 2);
    const filePath = line.slice(3);
    return { status: code.trim(), path: filePath };
  });
  return { isDirty: files.length > 0, uncommittedFiles: files };
}

async function isDetached(cwd) {
  const r = await run(['symbolic-ref', '-q', 'HEAD'], { cwd });
  // exit 0 = symbolic ref (branch); exit 1 = detached
  return !r.ok;
}

async function isSubmodule(cwd) {
  const r = await run(['rev-parse', '--show-superproject-working-tree'], { cwd });
  return r.ok && r.stdout.trim().length > 0;
}

async function getRemotes(cwd) {
  const r = await run(['remote', '-v'], { cwd });
  if (!r.ok) return [];
  const map = new Map();
  for (const line of r.stdout.split('\n').map((s) => s.trim()).filter(Boolean)) {
    const m = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
    if (!m) continue;
    const [, name, url] = m;
    if (!map.has(name)) map.set(name, { name, url });
  }
  return Array.from(map.values());
}

// One-shot inspection used by the validate-path endpoint.
async function inspectRepo(cwd) {
  const repo = await isGitRepo(cwd);
  if (!repo) return { isRepo: false };
  const [currentBranch, status, detached, submodule, remotes] = await Promise.all([
    getCurrentBranch(cwd),
    getStatus(cwd),
    isDetached(cwd),
    isSubmodule(cwd),
    getRemotes(cwd),
  ]);
  return {
    isRepo: true,
    currentBranch,
    isDirty: status.isDirty,
    uncommittedFiles: status.uncommittedFiles,
    isDetached: detached,
    isSubmodule: submodule,
    remotes,
  };
}

async function fetchRemote(cwd, remoteName = 'origin') {
  const start = Date.now();
  const remotes = await getRemotes(cwd);
  if (!remotes.find((r) => r.name === remoteName)) {
    return {
      succeeded: false,
      durationMs: Date.now() - start,
      error: `remote not configured: ${remoteName}`,
    };
  }
  const r = await run(['fetch', '--prune', '--quiet', remoteName], {
    cwd, timeout: FETCH_TIMEOUT_MS,
  });
  return {
    succeeded: r.ok,
    durationMs: Date.now() - start,
    error: r.ok ? null : (r.stderr.trim() || r.error || 'fetch failed'),
  };
}

// List branches with metadata. Includes local + remote refs (excluding HEAD).
async function listBranches(cwd) {
  const fmt = [
    '%(refname)',
    '%(refname:short)',
    '%(objectname:short)',
    '%(authordate:unix)',
    '%(contents:subject)',
    '%(authorname)',
    '%(upstream:short)',
    '%(upstream:track,nobracket)',
  ].join('\x01');

  const r = await run(['for-each-ref', `--format=${fmt}`, 'refs/heads', 'refs/remotes'], { cwd });
  if (!r.ok) return [];

  const out = [];
  for (const line of r.stdout.split('\n').filter(Boolean)) {
    const [refname, short, sha, ts, subject, author, upstream, track] = line.split('\x01');
    if (!refname) continue;
    if (refname.endsWith('/HEAD')) continue; // skip refs/remotes/origin/HEAD
    const isLocal = refname.startsWith('refs/heads/');
    const isRemote = refname.startsWith('refs/remotes/');
    if (!isLocal && !isRemote) continue;

    let ahead = 0, behind = 0;
    if (track) {
      const aM = track.match(/ahead\s+(\d+)/);
      const bM = track.match(/behind\s+(\d+)/);
      if (aM) ahead = parseInt(aM[1], 10);
      if (bM) behind = parseInt(bM[1], 10);
    }

    out.push({
      name: short,
      type: isLocal ? 'local' : 'remote',
      tracking: upstream || null,
      ahead, behind,
      lastCommit: {
        sha,
        subject: subject || '',
        author: author || '',
        date: ts ? Number(ts) * 1000 : null,
      },
    });
  }

  // Sort: local first, then remote-only; within each by commit date desc.
  out.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'local' ? -1 : 1;
    return (b.lastCommit?.date || 0) - (a.lastCommit?.date || 0);
  });
  return out;
}

// Switch active branch. Caller MUST have already refused dirty trees, but we
// re-check here as defense-in-depth. Auto-creates a local tracking branch
// when target is a remote-only ref (origin/foo).
async function checkoutBranch(cwd, branch, opts = {}) {
  if (!branch || typeof branch !== 'string') {
    return { ok: false, error: 'branch name required' };
  }
  const status = await getStatus(cwd);
  if (status.isDirty) {
    return {
      ok: false,
      error: 'working tree dirty',
      uncommittedFiles: status.uncommittedFiles,
    };
  }
  const current = await getCurrentBranch(cwd);
  if (current === branch) {
    const headSha = (await run(['rev-parse', '--short', 'HEAD'], { cwd })).stdout.trim();
    return { ok: true, currentBranch: current, switched: false, headSha };
  }

  let args;
  if (opts.createLocalFromRemote) {
    // expect branch like "origin/foo"; produce local "foo" tracking it
    const slash = branch.indexOf('/');
    if (slash < 0) {
      return { ok: false, error: 'createLocalFromRemote requires <remote>/<branch>' };
    }
    const localName = branch.slice(slash + 1);
    args = ['checkout', '-b', localName, '--track', branch];
  } else {
    args = ['checkout', branch];
  }
  const r = await run(args, { cwd });
  if (!r.ok) {
    return { ok: false, error: (r.stderr.trim() || r.error || 'checkout failed') };
  }
  const newCurrent = await getCurrentBranch(cwd);
  const headSha = (await run(['rev-parse', '--short', 'HEAD'], { cwd })).stdout.trim();
  return { ok: true, currentBranch: newCurrent, switched: true, headSha };
}

module.exports = {
  isGitRepo,
  getCurrentBranch,
  getStatus,
  getRemotes,
  inspectRepo,
  fetchRemote,
  listBranches,
  checkoutBranch,
  // exported for testing / advanced use
  _run: run,
};
