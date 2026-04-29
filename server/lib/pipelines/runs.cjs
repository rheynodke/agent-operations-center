// Workflow Run lifecycle — minimal executor.
//
// Phase R4/R5 scope: create runs, track step state, handle approvals.
// Phase R6 will wire actual gateway dispatch; for now agent steps transition
// from pending → running → done via a deterministic "fake" progression so the
// UI can demo the end-to-end flow. When an executor is wired, we swap the
// `advanceAgentStep` behavior.

const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { execSync } = require('node:child_process');
const db = require('../db.cjs');
const cfg = require('../config.cjs');
// Gateway is injected at wire-up time (avoid circular require at module load).
let gatewayProxy = null;
function setGatewayProxy(proxy) {
  gatewayProxy = proxy;
  _attachListener();
}

// ─── Active dispatch tracking ───────────────────────────────────────────────
// Module-level map: sessionKey → { runId, stepId, artifactKey, lastText }.
// Populated on dispatch, drained on gateway chat:done. Lost on server restart
// (acceptable for MVP — stuck runs can be cancelled manually).
const activeDispatches = new Map();

let _broadcastFn = null;
let _listenerAttached = false;
function _attachListener() {
  if (_listenerAttached || !gatewayProxy || typeof gatewayProxy.addListener !== 'function') return;
  gatewayProxy.addListener((event) => {
    if (!event || !event.payload) return;
    const sk = event.payload.sessionKey;
    if (!sk) return;
    const entry = activeDispatches.get(sk);
    if (!entry) return;

    // Cache final assistant text as it arrives (gateway emits replace=true snapshots).
    if (event.type === 'chat:message' && event.payload.role === 'assistant') {
      if (event.payload.text) entry.lastText = event.payload.text;
    }

    if (event.type === 'chat:done') {
      // Defer artifact write to end-of-tick so the final chat:message (which
      // may arrive immediately before chat:done) has already been processed.
      setImmediate(() => _onSessionComplete(sk));
    }
  });
  _listenerAttached = true;
}

function _onSessionComplete(sessionKey) {
  const entry = activeDispatches.get(sessionKey);
  if (!entry) return;
  activeDispatches.delete(sessionKey);
  try {
    const { runId, stepId, artifactKey, lastText } = entry;
    // Persist artifact to disk under the mission artifact folder.
    const step = getStep(stepId);
    if (!step) return;
    if (lastText && artifactKey) {
      try {
        const run = getRun(runId);
        const missionDir = path.join(cfg.OPENCLAW_HOME, 'missions', runId);
        const artifactsDir = path.join(missionDir, 'artifacts');
        fs.mkdirSync(artifactsDir, { recursive: true });
        const filename = `${stepId}__${artifactKey}.md`;
        const fullPath = path.join(artifactsDir, filename);
        fs.writeFileSync(fullPath, lastText, 'utf8');
        _insertArtifact({
          runId, stepId, key: artifactKey,
          contentRef: path.relative(missionDir, fullPath),
          mimeType: 'text/markdown',
          sizeBytes: Buffer.byteLength(lastText, 'utf8'),
        });
        void run;
      } catch (err) {
        console.error(`[runs] Failed to persist artifact for step ${stepId}:`, err.message);
      }
    }
    // Mark step done + advance.
    completeAgentStep({ runId, stepId, output: lastText }, _broadcastFn);
  } catch (err) {
    console.error('[runs] session complete handler error:', err);
  }
}

function _insertArtifact({ runId, stepId, key, contentRef, mimeType, sizeBytes }) {
  const id = uid('art');
  execOne(
    `INSERT INTO pipeline_artifacts
      (id, run_id, step_id, key, content_ref, mime_type, size_bytes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, runId, stepId, key, contentRef, mimeType, sizeBytes, now()],
  );
  db.persist();
}

function uid(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function now() { return new Date().toISOString(); }

// ─── DB helpers (row-level) ─────────────────────────────────────────────────
function sqlitedb() {
  return db.getRawDb ? db.getRawDb() : null;
}

function execOne(sql, params = []) {
  const raw = sqlitedb();
  if (!raw) throw new Error('DB not initialized');
  raw.run(sql, params);
}

function selectRows(sql, params = []) {
  const raw = sqlitedb();
  if (!raw) return [];
  const r = raw.exec(sql, params);
  if (!r.length) return [];
  const cols = r[0].columns;
  return r[0].values.map((vals) => {
    const obj = {};
    cols.forEach((c, i) => { obj[c] = vals[i]; });
    return obj;
  });
}

// ─── Display ID generation — global sequential MIS-XXX ──────────────────────
// Missions use a single global counter rather than per-playbook namespaces so
// IDs are always recognizable and unique at a glance.
function nextDisplayId() {
  const existing = selectRows(
    `SELECT trigger_payload_json FROM pipeline_runs`,
  );
  let maxSeq = 0;
  for (const row of existing) {
    try {
      const payload = row.trigger_payload_json ? JSON.parse(row.trigger_payload_json) : {};
      if (payload?._displayId) {
        const m = String(payload._displayId).match(/^MIS-(\d+)$/);
        if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
      }
    } catch {}
  }
  return `MIS-${String(maxSeq + 1).padStart(3, '0')}`;
}

// ─── Snapshot helpers ───────────────────────────────────────────────────────
/**
 * Given a pipeline graph snapshot + user-supplied agent resolution map, expand
 * into pipeline_steps rows. One row per agent + approval node (skip trigger/output).
 */
function buildStepsFromGraph(runId, graphSnapshot, agentResolution = {}) {
  const nodes = graphSnapshot.nodes || [];
  const steps = [];
  for (const n of nodes) {
    if (n.type === 'agent' || n.type === 'human_approval') {
      const data = n.data || {};
      const agentId = n.type === 'agent'
        ? (agentResolution[n.id] || data.agentId || null)
        : null;
      steps.push({
        id: uid('step'),
        runId,
        nodeId: n.id,
        nodeType: n.type,
        agentId,
        status: 'pending',
        attemptCount: 0,
      });
    }
  }
  return steps;
}

/**
 * Return step display metadata the UI needs to render a timeline: role emoji,
 * label, agent name, approval message. Derived from graph snapshot + step rows.
 */
function buildStepDisplay(graphSnapshot, stepsRows) {
  const nodesById = new Map();
  for (const n of graphSnapshot.nodes || []) nodesById.set(n.id, n);
  const ROLE_EMOJI = {
    'pm-analyst': '📊',
    'ux-designer': '🎨',
    'em-architect': '🏗',
    'swe': '💻',
    'qa-engineer': '🧪',
    'doc-writer': '📝',
    'biz-analyst': '📈',
    'data-analyst': '📊',
  };
  return stepsRows.map((step) => {
    const node = nodesById.get(step.nodeId);
    const data = (node?.data) || {};
    const roleId = data.adlcRole;
    const profile = step.agentId ? db.getAgentProfile(step.agentId) : null;
    return {
      stepId: step.id,
      nodeId: step.nodeId,
      label: data.label || step.nodeId,
      roleId,
      emoji: node?.type === 'human_approval' ? '✋' : (roleId ? ROLE_EMOJI[roleId] : '🤖'),
      agentName: profile?.display_name || step.agentId || null,
      approvalMessage: node?.type === 'human_approval' ? data.approvalMessage : undefined,
    };
  });
}

// ─── Progression logic ──────────────────────────────────────────────────────
/**
 * Find the next step to activate. Walks graph edges from completed steps.
 * For MVP: strict linear expectation — step i+1 activates after step i done.
 */
function nextPendingStep(stepsRows) {
  // Find first step that isn't done/skipped/cancelled.
  return stepsRows.find((s) => ['pending', 'queued'].includes(s.status)) || null;
}

function updateStep(stepId, patch) {
  const fields = [];
  const vals = [];
  if (patch.status !== undefined)        { fields.push('status = ?');        vals.push(patch.status); }
  if (patch.sessionKey !== undefined)    { fields.push('session_key = ?');   vals.push(patch.sessionKey); }
  if (patch.attemptCount !== undefined)  { fields.push('attempt_count = ?'); vals.push(patch.attemptCount); }
  if (patch.queuedAt !== undefined)      { fields.push('queued_at = ?');     vals.push(patch.queuedAt); }
  if (patch.dispatchedAt !== undefined)  { fields.push('dispatched_at = ?'); vals.push(patch.dispatchedAt); }
  if (patch.startedAt !== undefined)     { fields.push('started_at = ?');    vals.push(patch.startedAt); }
  if (patch.endedAt !== undefined)       { fields.push('ended_at = ?');      vals.push(patch.endedAt); }
  if (patch.error !== undefined)         { fields.push('error = ?');         vals.push(patch.error); }
  if (fields.length === 0) return;
  vals.push(stepId);
  execOne(`UPDATE pipeline_steps SET ${fields.join(', ')} WHERE id = ?`, vals);
  db.persist();
}

function updateRun(runId, patch) {
  const fields = [];
  const vals = [];
  if (patch.status !== undefined)  { fields.push('status = ?');   vals.push(patch.status); }
  if (patch.endedAt !== undefined) { fields.push('ended_at = ?'); vals.push(patch.endedAt); }
  if (patch.error !== undefined)   { fields.push('error = ?');    vals.push(patch.error); }
  if (fields.length === 0) return;
  vals.push(runId);
  execOne(`UPDATE pipeline_runs SET ${fields.join(', ')} WHERE id = ?`, vals);
  db.persist();
}

/**
 * Mark a step running. For approval steps we pause for human input; for agent
 * steps we dispatch to the gateway (if configured) or leave in a "waiting for
 * manual mark-done" state when the gateway is unavailable.
 */
function activateStep(runId, stepId, broadcast) {
  _broadcastFn = broadcast || _broadcastFn;
  const step = getStep(stepId);
  if (!step) return;
  if (step.node_type === 'human_approval') {
    updateStep(stepId, { status: 'running', startedAt: now() });
    updateRun(runId, { status: 'waiting_approval' });
    if (broadcast) broadcast({ type: 'workflow:approval_needed', payload: { runId, stepId } });
    return;
  }
  // Agent step — try real gateway dispatch. Falls back to "wait for manual
  // complete" if the gateway isn't connected or the agent has no id yet.
  updateStep(stepId, { status: 'running', startedAt: now(), dispatchedAt: now() });
  updateRun(runId, { status: 'running' });
  if (broadcast) broadcast({ type: 'workflow:step_start', payload: { runId, stepId } });

  _dispatchAgentStep({ runId, stepId }).catch((err) => {
    console.error(`[runs] Dispatch failed for step ${stepId}:`, err.message || err);
    updateStep(stepId, { status: 'failed', endedAt: now(), error: err.message || String(err) });
    updateRun(runId, { status: 'failed', endedAt: now(), error: err.message || String(err) });
    if (broadcast) broadcast({ type: 'workflow:step_failed', payload: { runId, stepId, reason: err.message } });
  });
}

// ─── Real gateway dispatch ──────────────────────────────────────────────────
function _buildPromptForStep({ run, step, graph, stepsRows }) {
  // Locate node definition inside the snapshot.
  const node = (graph.nodes || []).find((n) => n.id === step.node_id);
  const data = node?.data || {};
  const template = String(data.promptTemplate || '').trim()
    || `Proceed with your role's default task using the inputs below.`;

  // Resolve {{artifact.<nodeId>.<outputKey>}} references from produced artifacts.
  // For MVP: read artifact content_ref from disk (markdown). Missing refs
  // substitute empty string + we append a warning to the prompt.
  const warnings = [];
  const resolved = template.replace(
    /\{\{\s*artifact\.([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)\s*\}\}/g,
    (_m, srcNodeId, outputKey) => {
      const content = _readArtifact(run.id, srcNodeId, outputKey);
      if (content == null) {
        warnings.push(`missing artifact.${srcNodeId}.${outputKey}`);
        return `[[missing artifact: ${srcNodeId}.${outputKey}]]`;
      }
      return content;
    },
  );

  // Preamble — gives the agent context of its role in the mission + artifact
  // write path convention. Matches docs/pipelines-design.md §D3.
  const displayId = (run.displayId || run.id);
  const missionDir = path.join(cfg.OPENCLAW_HOME, 'missions', run.id);
  const artifactsDir = path.join(missionDir, 'artifacts');
  const outputKey = (data.outputs || [])[0]?.key || 'output';
  const artifactPath = path.join(artifactsDir, `${step.id}__${outputKey}.md`);

  const worktreeNote = run.worktree?.path
    ? `\n- Working directory: ${run.worktree.path} (branch ${run.worktree.branch})`
    : '';

  const preamble = `<mission-context>
You are executing step "${data.label || step.node_id}" of mission ${displayId}.
- Mission title: ${run.title || '(untitled)'}
- Your role: ${data.adlcRole || 'generic agent'}${worktreeNote}
- Produce your output as the artifact "${outputKey}".
- When done, write your final output to: ${artifactPath}
  (the mission executor also captures your last assistant message as fallback)
- After producing the output, your session will end.
</mission-context>`;

  const warningsBlock = warnings.length > 0
    ? `\n\n<warnings>\n${warnings.map((w) => `- ${w}`).join('\n')}\n</warnings>`
    : '';

  void stepsRows;
  return { text: `${preamble}\n\n${resolved}${warningsBlock}`, outputKey };
}

function _readArtifact(runId, srcNodeId, outputKey) {
  // Look up by (run_id, stepNodeId = node_id) + key. The step id differs
  // from node_id, so join.
  const rows = selectRows(
    `SELECT a.content_ref FROM pipeline_artifacts a
     JOIN pipeline_steps s ON a.step_id = s.id
     WHERE a.run_id = ? AND s.node_id = ? AND a.key = ?
     LIMIT 1`,
    [runId, srcNodeId, outputKey],
  );
  if (!rows.length) return null;
  try {
    const missionDir = path.join(cfg.OPENCLAW_HOME, 'missions', runId);
    const full = path.join(missionDir, rows[0].content_ref);
    return fs.readFileSync(full, 'utf8');
  } catch {
    return null;
  }
}

async function _dispatchAgentStep({ runId, stepId }) {
  if (!gatewayProxy || !gatewayProxy.isConnected) {
    // No gateway — leave step running, user can "Mark done (demo)" manually.
    console.warn(`[runs] Gateway not connected — step ${stepId} needs manual completion`);
    return;
  }
  const step = getStep(stepId);
  if (!step) throw new Error(`Step ${stepId} not found`);
  const agentId = step.agent_id;
  if (!agentId) throw new Error(`Step has no agentId — assign an agent before running`);

  const run = getRun(runId);
  if (!run) throw new Error(`Run ${runId} not found`);
  const runRow = selectRows(`SELECT graph_snapshot_json FROM pipeline_runs WHERE id = ?`, [runId])[0];
  let graph = { nodes: [], edges: [] };
  try { graph = JSON.parse(runRow.graph_snapshot_json); } catch {}
  const stepsRows = getStepsForRun(runId);

  const { text, outputKey } = _buildPromptForStep({ run, step, graph, stepsRows });

  // Create session then send.
  const sessionResult = await gatewayProxy.sessionsCreate(agentId);
  const sessionKey = sessionResult.key || sessionResult.session_key || sessionResult.id;
  if (!sessionKey) throw new Error('Gateway did not return a session key');
  updateStep(stepId, { sessionKey });

  activeDispatches.set(sessionKey, {
    runId,
    stepId,
    artifactKey: outputKey,
    lastText: '',
  });

  await gatewayProxy.chatSend(sessionKey, text);
  // Completion handled asynchronously by gateway listener → _onSessionComplete.
}

function advanceRun(runId, broadcast) {
  const stepsRows = getStepsForRun(runId);
  const nextStep = nextPendingStep(stepsRows);
  if (!nextStep) {
    // No more pending — run complete.
    updateRun(runId, { status: 'completed', endedAt: now() });
    if (broadcast) broadcast({ type: 'workflow:run_complete', payload: { runId, status: 'completed' } });
    return;
  }
  activateStep(runId, nextStep.id, broadcast);
}

// ─── Git worktree provisioning ──────────────────────────────────────────────
// Each mission optionally gets an isolated git worktree so agents can read/
// edit real project files without stepping on other missions. Worktree lives
// at {OPENCLAW_HOME}/missions/{runId}/worktree/. Silent no-op if the playbook
// doesn't configure a repo.
function provisionWorktree({ runId, displayId, repo }) {
  if (!repo || !repo.path) return null;
  const repoPath = repo.path.trim();
  if (!repoPath) return null;
  // Sanity check — must be a git checkout.
  if (!fs.existsSync(path.join(repoPath, '.git'))) {
    console.warn(`[runs] Repo path ${repoPath} is not a git checkout — skipping worktree`);
    return null;
  }
  const missionsRoot = path.join(cfg.OPENCLAW_HOME, 'missions', runId);
  const worktreePath = path.join(missionsRoot, 'worktree');
  fs.mkdirSync(missionsRoot, { recursive: true });
  const base = (repo.baseBranch || '').trim() || 'HEAD';
  const autoBranch = repo.autoBranch !== false;
  const branch = autoBranch ? `mission/${displayId.toLowerCase()}` : base;
  try {
    if (autoBranch) {
      execSync(
        `git -C ${JSON.stringify(repoPath)} worktree add -b ${JSON.stringify(branch)} ${JSON.stringify(worktreePath)} ${JSON.stringify(base)}`,
        { stdio: 'pipe' },
      );
    } else {
      execSync(
        `git -C ${JSON.stringify(repoPath)} worktree add ${JSON.stringify(worktreePath)} ${JSON.stringify(base)}`,
        { stdio: 'pipe' },
      );
    }
    return {
      path: worktreePath,
      branch,
      baseBranch: base,
      repoPath,
      repoUrl: repo.url || undefined,
    };
  } catch (err) {
    const stderr = err && err.stderr ? err.stderr.toString() : String(err);
    console.error(`[runs] Worktree creation failed for ${runId}:`, stderr);
    return { error: stderr };
  }
}

function teardownWorktree(worktree) {
  if (!worktree?.path || !worktree?.repoPath) return;
  try {
    execSync(
      `git -C ${JSON.stringify(worktree.repoPath)} worktree remove ${JSON.stringify(worktree.path)} --force`,
      { stdio: 'pipe' },
    );
  } catch (err) {
    console.warn(`[runs] Worktree teardown failed:`, err.message || err);
  }
}

// ─── Accessors ──────────────────────────────────────────────────────────────
function rowToRun(row) {
  if (!row) return null;
  let payload = null;
  try { payload = row.trigger_payload_json ? JSON.parse(row.trigger_payload_json) : null; } catch {}
  return {
    id: row.id,
    displayId: payload?._displayId || null,
    pipelineId: row.pipeline_id,
    title: payload?._title || null,
    description: payload?._description || null,
    status: row.status,
    triggerType: row.trigger_type,
    triggeredBy: row.triggered_by,
    concurrencyKey: row.concurrency_key,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    error: row.error,
    worktree: payload?._worktree || null,
    worktreeError: payload?._worktreeError || null,
  };
}

function rowToStep(row) {
  if (!row) return null;
  return {
    id: row.id,
    runId: row.run_id,
    nodeId: row.node_id,
    nodeType: row.node_type,
    agentId: row.agent_id,
    sessionKey: row.session_key,
    status: row.status,
    attemptCount: row.attempt_count,
    queuedAt: row.queued_at,
    dispatchedAt: row.dispatched_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    error: row.error,
  };
}

function getRun(runId) {
  const rows = selectRows(`SELECT * FROM pipeline_runs WHERE id = ?`, [runId]);
  return rows.length ? rowToRun(rows[0]) : null;
}

function getStep(stepId) {
  const rows = selectRows(`SELECT * FROM pipeline_steps WHERE id = ?`, [stepId]);
  return rows.length ? rows[0] : null;
}

function getStepsForRun(runId) {
  return selectRows(
    `SELECT * FROM pipeline_steps WHERE run_id = ? ORDER BY rowid ASC`,
    [runId],
  );
}

function getAllRuns() {
  const rows = selectRows(`SELECT * FROM pipeline_runs ORDER BY started_at DESC LIMIT 200`);
  // Enrich with pipeline name
  const pipelinesById = new Map(db.getAllPipelines().map((p) => [p.id, p]));
  return rows.map(rowToRun).map((run) => {
    const pipeline = pipelinesById.get(run.pipelineId);
    const stepsRows = getStepsForRun(run.id).map(rowToStep);
    const total = stepsRows.length;
    const done = stepsRows.filter((s) => s.status === 'done').length;
    const failed = stepsRows.filter((s) => s.status === 'failed').length;
    const awaiting = stepsRows.find((s) => s.status === 'running' && s.nodeType === 'human_approval');
    const running = stepsRows.find((s) => s.status === 'running' && s.nodeType !== 'human_approval');
    return {
      ...run,
      pipelineName: pipeline?.name,
      progress: {
        total,
        done,
        failed,
        awaitingApprovalStepId: awaiting?.id,
        runningStepId: running?.id,
      },
    };
  });
}

function getRunDetail(runId) {
  const run = getRun(runId);
  if (!run) return null;
  const pipeline = db.getPipeline(run.pipelineId);
  const stepsRows = getStepsForRun(runId);
  const steps = stepsRows.map(rowToStep);
  // We persisted the graph snapshot inside the run row; load it.
  const runRow = selectRows(`SELECT graph_snapshot_json FROM pipeline_runs WHERE id = ?`, [runId])[0];
  let graphSnapshot = { nodes: [], edges: [] };
  try { graphSnapshot = JSON.parse(runRow.graph_snapshot_json || '{"nodes":[],"edges":[]}'); } catch {}
  const stepDisplay = buildStepDisplay(graphSnapshot, stepsRows);
  const total = steps.length;
  const done = steps.filter((s) => s.status === 'done').length;
  const failed = steps.filter((s) => s.status === 'failed').length;
  const awaiting = steps.find((s) => s.status === 'running' && s.nodeType === 'human_approval');
  const running = steps.find((s) => s.status === 'running' && s.nodeType !== 'human_approval');
  return {
    ...run,
    pipelineName: pipeline?.name,
    steps,
    artifacts: [], // TODO R6
    stepDisplay,
    progress: {
      total,
      done,
      failed,
      awaitingApprovalStepId: awaiting?.id,
      runningStepId: running?.id,
    },
  };
}

// ─── Public API ─────────────────────────────────────────────────────────────
function createRun({ pipelineId, title, description, agentResolution, triggeredBy, triggerType = 'manual' }, broadcast) {
  const pipeline = db.getPipeline(pipelineId);
  if (!pipeline) throw new Error(`Pipeline ${pipelineId} not found`);
  const runId = uid('mis');
  const displayId = nextDisplayId();
  const graphSnapshot = pipeline.graph || { nodes: [], edges: [] };

  // Provision a git worktree if the playbook has repo config.
  const repoMeta = graphSnapshot.metadata?.repo;
  const worktree = provisionWorktree({ runId, displayId, repo: repoMeta });

  const payload = {
    _displayId: displayId,
    _title: title || 'Untitled',
    _description: description || '',
    ...(worktree && !worktree.error ? { _worktree: worktree } : {}),
    ...(worktree?.error ? { _worktreeError: worktree.error } : {}),
  };

  execOne(
    `INSERT INTO pipeline_runs
      (id, pipeline_id, graph_snapshot_json, status, trigger_type, trigger_payload_json,
       triggered_by, concurrency_key, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      runId,
      pipelineId,
      JSON.stringify(graphSnapshot),
      'queued',
      triggerType,
      JSON.stringify(payload),
      triggeredBy || null,
      null,
      now(),
    ],
  );

  const stepsRows = buildStepsFromGraph(runId, graphSnapshot, agentResolution || {});
  for (const s of stepsRows) {
    execOne(
      `INSERT INTO pipeline_steps
        (id, run_id, node_id, node_type, agent_id, status, attempt_count, queued_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [s.id, s.runId, s.nodeId, s.nodeType, s.agentId, s.status, s.attemptCount, now()],
    );
  }
  db.persist();

  if (broadcast) {
    broadcast({ type: 'workflow:run_start', payload: { runId, pipelineId, displayId } });
  }

  // Activate the first step immediately.
  advanceRun(runId, broadcast);
  return getRunDetail(runId);
}

function approveStep({ runId, stepId, comment }, broadcast) {
  const step = getStep(stepId);
  if (!step) throw new Error(`Step ${stepId} not found`);
  if (step.run_id !== runId) throw new Error('Step does not belong to run');
  if (step.node_type !== 'human_approval') throw new Error('Only approval steps can be approved');
  if (step.status !== 'running') throw new Error(`Step is ${step.status}, not running`);
  updateStep(stepId, { status: 'done', endedAt: now() });
  if (broadcast) broadcast({ type: 'workflow:step_complete', payload: { runId, stepId, approved: true, comment } });
  advanceRun(runId, broadcast);
  return getRunDetail(runId);
}

function rejectStep({ runId, stepId, reason }, broadcast) {
  const step = getStep(stepId);
  if (!step) throw new Error(`Step ${stepId} not found`);
  if (step.node_type !== 'human_approval') throw new Error('Only approval steps can be rejected');
  updateStep(stepId, { status: 'failed', endedAt: now(), error: reason || 'Rejected by user' });
  updateRun(runId, { status: 'failed', endedAt: now(), error: `Approval rejected: ${reason || 'no reason given'}` });
  if (broadcast) {
    broadcast({ type: 'workflow:step_failed', payload: { runId, stepId, reason } });
    broadcast({ type: 'workflow:run_complete', payload: { runId, status: 'failed' } });
  }
  return getRunDetail(runId);
}

/**
 * MVP helper: mark a running agent step as complete with provided output text.
 * Real executor (Phase R6) will produce this through session completion.
 */
function completeAgentStep({ runId, stepId, output }, broadcast) {
  const step = getStep(stepId);
  if (!step) throw new Error(`Step ${stepId} not found`);
  if (step.node_type !== 'agent') throw new Error('Only agent steps accept completion');
  if (step.status !== 'running') throw new Error(`Step is ${step.status}, not running`);
  updateStep(stepId, { status: 'done', endedAt: now() });
  // (Skipping artifact persist in MVP — placeholder for R6.)
  void output;
  if (broadcast) broadcast({ type: 'workflow:step_complete', payload: { runId, stepId } });
  advanceRun(runId, broadcast);
  return getRunDetail(runId);
}

function cancelRun({ runId, reason }, broadcast) {
  const run = getRun(runId);
  if (!run) throw new Error(`Run ${runId} not found`);
  if (['completed', 'cancelled', 'failed'].includes(run.status)) return getRunDetail(runId);
  const stepsRows = getStepsForRun(runId);
  for (const s of stepsRows) {
    if (['pending', 'queued', 'running'].includes(s.status)) {
      updateStep(s.id, { status: 'cancelled', endedAt: now() });
    }
  }
  updateRun(runId, { status: 'cancelled', endedAt: now(), error: reason || null });
  // Tear down worktree so the mission doesn't leave stale branches around.
  if (run.worktree) teardownWorktree(run.worktree);
  if (broadcast) broadcast({ type: 'workflow:run_complete', payload: { runId, status: 'cancelled' } });
  return getRunDetail(runId);
}

module.exports = {
  createRun,
  approveStep,
  rejectStep,
  completeAgentStep,
  cancelRun,
  getRun,
  getRunDetail,
  getAllRuns,
  setGatewayProxy,
  // internal
  _buildStepsFromGraph: buildStepsFromGraph,
};
