'use strict';
/**
 * github-clone — clone a remote GitHub connection's repo into the owning
 * tenant's local repository area, then enable full git ops via aoc-connect.sh.
 *
 * Tenant isolation: clone path is rooted at
 *   ~/.openclaw/users/<ownerId>/.openclaw/repository/<repo-slug>/
 * which sits INSIDE the tenant root. The per-user gateway's sandbox-exec
 * profile already denies cross-tenant filesystem access, so peers cannot
 * read or write this clone even though they share the same UNIX user.
 *
 * Rebase-first workflow: clones are configured with `pull.rebase=true` and
 * `rebase.autoStash=true` so all subsequent `git pull` automatically rebase
 * the local branch onto the upstream — avoiding merge commits that clutter
 * the history (per the operator's preferred git policy).
 *
 * PAT handling: the connection PAT is NEVER written to disk inside the
 * clone (no embedded token in remote.origin.url, no .git/config plaintext).
 * Auth at clone/push/fetch time uses an ephemeral GIT_ASKPASS helper that
 * echoes $GH_TOKEN from process env. The token lives in memory only.
 *
 * Background job model: clone is potentially slow (network-bound). The
 * helper exposes startCloneJob() which returns immediately with a job
 * descriptor and runs the actual clone in the background. State updates
 * (running → completed | failed) persist into connection.metadata so the
 * frontend can poll via GET /connections/:id/clone-status.
 */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile, spawn } = require('node:child_process');
const crypto = require('node:crypto');

const { getUserHome, OPENCLAW_HOME, OPENCLAW_BASE } = require('./../config.cjs');

const CLONE_DEPTH = 50;
const CLONE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes hard cap
const MIN_FREE_BYTES = 500 * 1024 * 1024; // 500 MB minimum free space before clone
const GIT_BIN = process.env.GIT_BIN || '/usr/bin/git';

/** ── path resolution ───────────────────────────────────────────────────── */

function repositoryRootFor(ownerUserId) {
  const home = (ownerUserId == null || Number(ownerUserId) === 1)
    ? (OPENCLAW_HOME || OPENCLAW_BASE)
    : getUserHome(ownerUserId);
  return path.join(home, 'repository');
}

function slugifyRepo(owner, name) {
  const clean = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return [clean(owner), clean(name)].filter(Boolean).join('--') || 'repo';
}

function resolveClonePath(ownerUserId, repoOwner, repoName) {
  return path.join(repositoryRootFor(ownerUserId), slugifyRepo(repoOwner, repoName));
}

/** ── git command runner with GIT_ASKPASS PAT injection ─────────────────── */

async function _withAskpass(pat, fn) {
  // Build an ephemeral helper script that prints the PAT. We use a randomly
  // named tempfile in the OS temp dir and chmod 0700 so other UNIX users
  // can't read it. We delete it as soon as the wrapped command returns.
  const helperPath = path.join(os.tmpdir(), `aoc-gh-askpass-${crypto.randomBytes(8).toString('hex')}.sh`);
  await fsp.writeFile(helperPath, '#!/bin/sh\necho "$GH_TOKEN"\n', { mode: 0o700 });
  try {
    return await fn({
      GH_TOKEN: pat || '',
      GIT_ASKPASS: helperPath,
      GIT_TERMINAL_PROMPT: '0',
    });
  } finally {
    try { await fsp.unlink(helperPath); } catch {}
  }
}

function _runGit(args, { cwd, env, timeoutMs = CLONE_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = execFile(GIT_BIN, args, {
      cwd,
      env: { ...process.env, ...(env || {}) },
      maxBuffer: 32 * 1024 * 1024,
      timeout: timeoutMs,
    }, (err, stdout, stderr) => {
      if (settled) return;
      settled = true;
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        return reject(err);
      }
      resolve({ stdout, stderr });
    });
    child.on('error', (err) => { if (!settled) { settled = true; reject(err); } });
  });
}

/** ── clone state ───────────────────────────────────────────────────────── */

const activeJobs = new Map(); // connId -> { state, startedAt, etc. }

function getJobState(connectionId) {
  return activeJobs.get(connectionId) || null;
}

/** ── public API ────────────────────────────────────────────────────────── */

/**
 * Kick off a background clone. Returns the initial job descriptor. The
 * connection's metadata.cloneJob is updated as the job progresses; final
 * outcome lives in metadata.{clonePath, clonedAt, cloneError}.
 *
 * @param {object} opts
 * @param {object} opts.connection — DB row { id, type, credentials, metadata, created_by, ... }
 * @param {number} opts.ownerUserId
 * @param {object} opts.db — server/lib/db.cjs (passed in to avoid circular require)
 */
function startCloneJob({ connection, ownerUserId, db }) {
  if (!connection) throw new Error('connection required');
  if (connection.type !== 'github') throw new Error('connection.type must be github');
  const meta = connection.metadata || {};
  if ((meta.githubMode || 'remote') !== 'remote') {
    throw new Error('clone-to-local only supported for remote-mode github connections');
  }
  if (!meta.repoOwner || !meta.repoName) {
    throw new Error('connection missing repoOwner / repoName');
  }
  if (activeJobs.has(connection.id)) {
    return activeJobs.get(connection.id); // dedupe
  }

  const pat = connection.credentials || '';
  const branch = meta.branch || 'main';
  const clonePath = resolveClonePath(ownerUserId, meta.repoOwner, meta.repoName);

  const job = {
    connectionId: connection.id,
    state: 'starting',
    phase: 'preparing',
    startedAt: new Date().toISOString(),
    progress: 0,
    clonePath,
    branch,
    repo: `${meta.repoOwner}/${meta.repoName}`,
    error: null,
  };
  activeJobs.set(connection.id, job);

  _persistJobState(db, connection.id, job);

  // Detached background execution. We don't await; caller gets the descriptor.
  _runClone(job, { connection, pat, db, ownerUserId })
    .catch(err => {
      job.state = 'failed';
      job.error = String(err && err.message || err);
      _persistJobState(db, connection.id, job);
    })
    .finally(() => {
      // Keep job in map for ~60s so a quick poll after completion sees it.
      setTimeout(() => activeJobs.delete(connection.id), 60_000);
    });

  return job;
}

async function _checkFreeSpace(dir) {
  try {
    const s = await fsp.statfs(dir);
    return s.bavail * s.bsize;
  } catch {
    // Some Node versions don't expose statfs; degrade gracefully.
    return Infinity;
  }
}

async function _runClone(job, { connection, pat, db, ownerUserId }) {
  const meta = connection.metadata || {};
  const { repoOwner, repoName } = meta;
  const branch = job.branch;
  const clonePath = job.clonePath;

  // Phase 1: ensure parent dir exists, check free space.
  job.state = 'running';
  job.phase = 'preparing';
  await fsp.mkdir(path.dirname(clonePath), { recursive: true });
  const free = await _checkFreeSpace(path.dirname(clonePath));
  if (free < MIN_FREE_BYTES) {
    throw new Error(`insufficient disk space (${Math.floor(free / 1024 / 1024)} MB free, need at least ${MIN_FREE_BYTES / 1024 / 1024} MB). Free up space or unclone an unused repo.`);
  }

  // Phase 2: clean up partial clone if any.
  if (fs.existsSync(clonePath)) {
    if (fs.existsSync(path.join(clonePath, '.git'))) {
      // already a repo. If config has matching remote URL, treat as already
      // cloned — short-circuit.
      try {
        const { stdout } = await _runGit(['-C', clonePath, 'remote', 'get-url', 'origin'], { timeoutMs: 5_000 });
        const url = stdout.trim();
        if (url.endsWith(`${repoOwner}/${repoName}.git`) || url.endsWith(`${repoOwner}/${repoName}`)) {
          job.state = 'completed';
          job.phase = 'already-cloned';
          job.progress = 100;
          _persistJobResult(db, connection.id, { clonePath, branch });
          return;
        }
      } catch { /* fallthrough to wipe */ }
    }
    // wipe leftover dir before re-clone
    job.phase = 'cleaning';
    await fsp.rm(clonePath, { recursive: true, force: true });
  }

  // Phase 3: clone.
  job.phase = 'cloning';
  job.progress = 10;
  _persistJobState(db, connection.id, job);

  try {
    await _withAskpass(pat, async (env) => {
      await _runGit([
        'clone',
        `--depth=${CLONE_DEPTH}`,
        '--single-branch',
        '--branch', branch,
        `https://github.com/${repoOwner}/${repoName}.git`,
        clonePath,
      ], { env });
    });
  } catch (e) {
    const stderr = String(e && e.stderr || e.message || '');
    if (/Authentication failed|could not read Username|HTTP 401|fatal: unable to access.*: The requested URL returned error: 401/i.test(stderr)) {
      throw new Error(`auth failed: PAT rejected by GitHub. Check that the token is valid and has 'repo' scope (private) or 'public_repo' (public). Original: ${stderr.trim().slice(0, 200)}`);
    }
    if (/Repository not found|HTTP 404/i.test(stderr)) {
      throw new Error(`repository not found: ${repoOwner}/${repoName}. Either it doesn't exist or your PAT lacks access. Original: ${stderr.trim().slice(0, 200)}`);
    }
    if (/HTTP 403/i.test(stderr)) {
      throw new Error(`access forbidden: PAT lacks required scope. For private repos use 'repo'; for org-restricted orgs the PAT must be SSO-authorized. Original: ${stderr.trim().slice(0, 200)}`);
    }
    if (/Remote branch .* not found/i.test(stderr)) {
      throw new Error(`branch '${branch}' does not exist on remote. Check connection's branch setting. Original: ${stderr.trim().slice(0, 200)}`);
    }
    throw e;
  }

  // Phase 4: post-clone config.
  job.phase = 'configuring';
  job.progress = 80;
  _persistJobState(db, connection.id, job);

  // Strip any embedded token from origin URL (defense-in-depth — none should
  // be there since we used --depth + askpass, but verify).
  await _runGit([
    '-C', clonePath, 'remote', 'set-url', 'origin',
    `https://github.com/${repoOwner}/${repoName}.git`,
  ]);
  // Rebase-first workflow.
  await _runGit(['-C', clonePath, 'config', 'pull.rebase', 'true']);
  await _runGit(['-C', clonePath, 'config', 'rebase.autoStash', 'true']);
  // Best-effort: identify commits with operator (not the agent) by default.
  await _runGit(['-C', clonePath, 'config', 'user.name', `AOC user ${ownerUserId}`]);
  await _runGit(['-C', clonePath, 'config', 'user.email', `aoc+user${ownerUserId}@local.invalid`]);

  // Phase 5: done.
  job.state = 'completed';
  job.phase = 'done';
  job.progress = 100;
  _persistJobResult(db, connection.id, { clonePath, branch });
}

function _persistJobState(db, connectionId, job) {
  try {
    const conn = db.getConnection ? db.getConnection(connectionId) : null;
    if (!conn) return;
    const meta = conn.metadata || {};
    meta.cloneJob = {
      state: job.state,
      phase: job.phase,
      progress: job.progress,
      startedAt: job.startedAt,
      error: job.error,
    };
    db.updateConnection(connectionId, { metadata: meta });
  } catch (e) {
    console.warn(`[github-clone] persist state failed for ${connectionId}: ${e.message}`);
  }
}

function _persistJobResult(db, connectionId, { clonePath, branch }) {
  try {
    const conn = db.getConnection ? db.getConnection(connectionId) : null;
    if (!conn) return;
    const meta = conn.metadata || {};
    meta.clonePath = clonePath;
    meta.clonedAt = new Date().toISOString();
    meta.cloneError = null;
    meta.cloneJob = {
      state: 'completed',
      phase: 'done',
      progress: 100,
      startedAt: meta.cloneJob ? meta.cloneJob.startedAt : new Date().toISOString(),
      completedAt: new Date().toISOString(),
      error: null,
    };
    db.updateConnection(connectionId, { metadata: meta });
    _resyncAgentToolsForConnection(db, connectionId);
  } catch (e) {
    console.warn(`[github-clone] persist result failed for ${connectionId}: ${e.message}`);
  }
}

/**
 * Re-render TOOLS.md (connections context block) for every agent that has
 * this connection bound. Called after clone completes or unclone happens so
 * the rendered action list (`_buildGithubSection`) reflects the new cloned
 * state. Without this, a Telegram/WhatsApp message arriving 1s after a
 * clone would still see stale TOOLS.md (no cloned-mode actions advertised).
 */
function _resyncAgentToolsForConnection(db, connectionId) {
  try {
    const lib = require('../index.cjs');
    const { syncAgentConnectionsContext, getAgentFile, saveAgentFile } = lib;
    if (typeof syncAgentConnectionsContext !== 'function') return;
    const agentIds = (db.getConnectionAgentIds ? db.getConnectionAgentIds(connectionId) : []) || [];
    if (agentIds.length === 0) return;
    const allConns = db.getAllConnections ? db.getAllConnections() : [];
    for (const { agentId, ownerId } of agentIds) {
      try {
        const assigned = (db.getAgentConnectionIds ? db.getAgentConnectionIds(agentId, ownerId) : [])
          .map(id => allConns.find(c => c.id === id))
          .filter(Boolean);
        const getFn = (_id, name) => getAgentFile ? getAgentFile(agentId, name) : { content: '' };
        const saveFn = (_id, name, content) => saveAgentFile && saveAgentFile(agentId, name, content);
        syncAgentConnectionsContext(agentId, assigned, getFn, saveFn);
      } catch (e) {
        console.warn(`[github-clone] resync TOOLS.md for agent ${agentId} failed: ${e.message}`);
      }
    }
  } catch (e) {
    console.warn(`[github-clone] _resyncAgentToolsForConnection skipped: ${e.message}`);
  }
}

/**
 * Sync an already-cloned repo from remote. Equivalent to `git fetch && git rebase`.
 */
async function syncClone({ connection, db }) {
  const meta = connection.metadata || {};
  const clonePath = meta.clonePath;
  if (!clonePath || !fs.existsSync(path.join(clonePath, '.git'))) {
    throw new Error('not cloned — call clone-to-local first');
  }
  const pat = connection.credentials || '';
  await _withAskpass(pat, async (env) => {
    await _runGit(['-C', clonePath, 'fetch', '--prune'], { env, timeoutMs: 60_000 });
  });
  // Get current branch + behind/ahead counts
  const { stdout: head } = await _runGit(['-C', clonePath, 'rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: 5_000 });
  const branch = head.trim();
  let behind = 0, ahead = 0;
  try {
    const { stdout } = await _runGit(['-C', clonePath, 'rev-list', '--left-right', '--count', `origin/${branch}...HEAD`], { timeoutMs: 5_000 });
    [behind, ahead] = stdout.trim().split(/\s+/).map(Number);
  } catch {}
  // Persist metadata
  try {
    const conn = db.getConnection(connection.id);
    if (conn) {
      const m = conn.metadata || {};
      m.lastSyncAt = new Date().toISOString();
      db.updateConnection(connection.id, { metadata: m });
    }
  } catch {}
  return { branch, behind, ahead };
}

/**
 * Remove the local clone. Destructive — caller must have confirmed.
 */
async function unclone({ connection, db }) {
  const meta = connection.metadata || {};
  const clonePath = meta.clonePath;
  if (!clonePath) return { removed: false, reason: 'not cloned' };
  // Safety: clonePath must be under the owning user's repository root.
  const expectedRoot = repositoryRootFor(connection.created_by ?? connection.createdBy);
  const rel = path.relative(expectedRoot, clonePath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`refused to remove ${clonePath}: not inside owner's repository root ${expectedRoot}`);
  }
  if (fs.existsSync(clonePath)) {
    await fsp.rm(clonePath, { recursive: true, force: true });
  }
  // Clear metadata
  try {
    const conn = db.getConnection(connection.id);
    if (conn) {
      const m = conn.metadata || {};
      delete m.clonePath;
      delete m.clonedAt;
      delete m.cloneJob;
      delete m.lastSyncAt;
      db.updateConnection(connection.id, { metadata: m });
    }
  } catch {}
  // Re-render TOOLS.md so cloned-mode action list disappears immediately.
  _resyncAgentToolsForConnection(db, connection.id);
  return { removed: true, clonePath };
}

module.exports = {
  repositoryRootFor,
  resolveClonePath,
  slugifyRepo,
  startCloneJob,
  getJobState,
  syncClone,
  unclone,
};
