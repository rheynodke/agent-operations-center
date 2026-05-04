/**
 * routes/tasks.cjs
 *
 * Tasks (ticketing) CRUD + Task Attachments + Task Outputs +
 * Task Comments (free-form discussion thread).
 * Step 8a of server modularization.
 */
'use strict';

const { parseOwnerParam } = require('../helpers/access-control.cjs');
const { gatewayForReq } = require('../helpers/gateway-context.cjs');

module.exports = function tasksRouter(deps) {
  const {
    db, parsers, broadcast, broadcastTasksUpdate,
    outputsLib, vSave,
    checkTaskAccess, dispatchTaskToAgent,
    emitTaskRoomSystemMessage, getAgentDisplayName,
    attachmentsLib, integrations, uploadAttachments, projectWs,
  } = deps;
  const router = require('express').Router();
  const taskDispatchHook = require('../hooks/task-dispatch.cjs');

  function _buildDispatchDeps(req) {
    return { db, outputsLib, projectWs, parsers, broadcastTasksUpdate, userId: req.user.userId };
  }

  // Local wrappers — the DI `dispatchTaskToAgent` from index.cjs is the same function,
  // but we also need analyzeTaskForAgent which isn't in the DI bag.
  function analyzeTaskForAgent(task) {
    return taskDispatchHook.analyzeTaskForAgent(task, { db, parsers });
  }

// ─── Tasks (ticketing) ────────────────────────────────────────────────────────

  router.get('/tasks', db.authMiddleware, (req, res) => {
  try {
    const { agentId, status, priority, tag, q, projectId } = req.query;
    const tasks = db.getAllTasks({ agentId, status, priority, tag, q, projectId });

    // Scope by project ownership (per-user resource).
    // admin without ?owner= sees all; non-admin sees only own projects' tasks.
    const scope = parseOwnerParam(req);
    const isAdmin = req.user?.role === 'admin';
    const uid = req.user?.userId;

    const filtered = tasks.filter((task) => {
      const pid = task.projectId || 'general';
      const proj = db.getProject(pid);
      const ownerId = proj?.createdBy ?? null;
      // 'general' project (ownerId == null) is shared — visible to all
      if (ownerId == null) return true;
      if (isAdmin) {
        if (scope === 'all') return true;
        if (scope === 'me') return ownerId === uid;
        if (typeof scope === 'number') return ownerId === scope;
        return true;
      }
      return ownerId === uid;
    });

    res.json({ tasks: filtered });
  } catch (err) {
    console.error('[api/tasks GET]', err);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

  router.post('/tasks', db.authMiddleware, (req, res) => {
  try {
    const { title, description, status, priority, agentId, tags, requestFrom, projectId, stage, role, epicId } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'title is required' });

    // Orchestrator guardrail: when an agent (service token) creates a task and
    // its `requestFrom` is the orchestrator (`main`) itself, refuse to assign
    // the task back to `main`. The orchestrator delegates — it does not
    // execute. This is enforced server-side so a misbehaving LLM cannot bypass
    // the prompt instruction. The task is still created (unassigned) so user
    // can manually assign or specialists can pick it up.
    let safeAgentId = agentId;
    if (req.user?.role === 'agent' && requestFrom === 'main' && agentId === 'main') {
      console.warn(`[tasks/create] orchestrator tried to self-assign task "${title}" — clearing assignee`);
      safeAgentId = null;
    }

    if (safeAgentId && !db.userOwnsAgent(req, safeAgentId)) {
      return res.status(403).json({ error: 'You can only assign tasks to agents you own' });
    }
    // Project ownership: tasks must be created inside a project the user owns
    // (or admin/agent-token bypass; null/legacy projects treated as shared).
    const targetProjectId = projectId || 'general';
    if (!db.userOwnsProject(req, targetProjectId)) {
      return res.status(403).json({ error: 'You can only create tasks in projects you own' });
    }
    const task = db.createTask({
      title: title.trim(), description, status, priority,
      agentId: safeAgentId, tags, requestFrom, projectId: targetProjectId,
      stage, role, epicId,
    });
    db.addTaskActivity({ taskId: task.id, type: 'created', toValue: task.status, actor: 'user' });
    const assignee = task.agentId ? getAgentDisplayName(task.agentId) : 'unassigned';
    emitTaskRoomSystemMessage(task, `Task created: ${task.title} · assigned to ${assignee}`);
    broadcastTasksUpdate();
    res.status(201).json({ task });
  } catch (err) {
    console.error('[api/tasks POST]', err);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

  router.patch('/tasks/:id', db.authMiddleware, db.requireProjectOwnershipForTask, (req, res) => {
  try {
    const { id } = req.params;
    const gate = checkTaskAccess(req, id);
    if (gate) return res.status(403).json({ error: gate });
    // agentId in body = actor identifier (from agent script); assignTo = new assignment (from UI)
    const { agentId: actorAgentId, assignTo, note, status, priority, title, description, tags, cost, sessionId, inputTokens, outputTokens, requestFrom, newAttachmentIds } = req.body;
    const before = db.getTask(id);
    if (!before) return res.status(404).json({ error: 'Task not found' });

    const actor = actorAgentId || 'user';
    const patch = {};
    if (title       !== undefined) patch.title       = title;
    if (description !== undefined) patch.description = description;
    if (status      !== undefined) patch.status      = status;
    if (priority    !== undefined) patch.priority    = priority;
    if (tags         !== undefined) patch.tags         = tags;
    if (cost         !== undefined) patch.cost         = cost;
    if (inputTokens  !== undefined && inputTokens  !== '') patch.inputTokens  = inputTokens;
    if (outputTokens !== undefined && outputTokens !== '') patch.outputTokens = outputTokens;
    // Only update sessionId if a non-empty value is provided — empty string from
    // update_task.sh (missing 4th param) must not erase the existing sessionId.
    if (sessionId !== undefined && sessionId !== '') patch.sessionId = sessionId;
    if (assignTo    !== undefined) patch.agentId     = assignTo || null;
    if (requestFrom !== undefined) patch.requestFrom = requestFrom;

    // Auto-transition: assigning a backlog task to an agent moves it to `todo`
    // (queued, ready to dispatch). User/orchestrator must explicitly dispatch
    // to push it into in_progress — gives a chance to batch dispatches.
    // Skipped if the caller is explicitly setting status in the same patch.
    if (
      assignTo && assignTo !== before.agentId &&
      patch.status === undefined &&
      before.status === 'backlog'
    ) {
      patch.status = 'todo';
    }

    const after = db.updateTask(id, patch);

    // Use the resolved patch.status (covers both explicit body.status AND the
    // backlog→todo auto-transition above) when deciding whether to log an
    // activity / emit a lifecycle message.
    const effectiveStatus = patch.status;

    // Write activity entries for all meaningful changes (independent, not mutually exclusive)
    if (effectiveStatus !== undefined && effectiveStatus !== before.status) {
      db.addTaskActivity({ taskId: id, type: 'status_change', fromValue: before.status, toValue: effectiveStatus, actor, note });
    }
    if (assignTo !== undefined && assignTo !== before.agentId) {
      db.addTaskActivity({ taskId: id, type: 'assignment', fromValue: before.agentId || null, toValue: assignTo || null, actor });
    }

    if (effectiveStatus !== undefined && effectiveStatus !== before.status) {
      const lifecycleBodies = {
        todo: `Task queued: ${after.title}${after.agentId ? ` · assigned to ${getAgentDisplayName(after.agentId)}` : ''}`,
        in_progress: `Task started: ${after.title}`,
        in_review: `Task moved to review: ${after.title}`,
        done: `Task completed: ${after.title}`,
        cancelled: `Task cancelled: ${after.title}`,
      };
      if (lifecycleBodies[effectiveStatus]) emitTaskRoomSystemMessage(after, lifecycleBodies[effectiveStatus]);
    }

    // Auto-analyze: when agent assigned to a backlog ticket, run pre-flight analysis
    const shouldAutoAnalyze =
      assignTo && assignTo !== before.agentId &&
      (after.status === 'backlog') &&
      !after.analysis; // don't re-analyze if already done
    if (shouldAutoAnalyze) {
      analyzeTaskForAgent(after).then(analysis => {
        db.updateTask(id, { analysis });
        broadcastTasksUpdate();
        console.log(`[auto-analyze] Task ${id} analyzed for agent ${assignTo}`);
      }).catch(err => console.warn('[auto-analyze]', id, err.message));
    }

    if (note && status === undefined) {
      db.addTaskActivity({ taskId: id, type: 'comment', actor, note });
    }

    // Auto-dispatch: ticket moved to actionable status with an assigned agent
    // Cases: backlog→todo, blocked→todo, blocked→in_progress, in_review→in_progress (change request)
    const isMovingToTodo = status === 'todo';
    const isChangeRequest = status === 'in_progress' && before.status === 'in_review';
    const isBlockerResolved = (status === 'in_progress' || status === 'todo') && before.status === 'blocked';
    const shouldAutoDispatch =
      status !== undefined &&
      (isMovingToTodo || isChangeRequest || isBlockerResolved) &&
      before.status !== status &&
      after.agentId &&
      gatewayForReq(req).isConnected;
    if (shouldAutoDispatch) {
      const dispatchOpts = {};
      if (isChangeRequest) {
        dispatchOpts.changeRequestNote = note || null;
      } else if (isBlockerResolved) {
        dispatchOpts.blockerResolvedNote = note || null;
      } else if (isMovingToTodo) {
        dispatchOpts.additionalContext = note || null;
      }
      if (Array.isArray(newAttachmentIds) && newAttachmentIds.length) {
        dispatchOpts.newAttachmentIds = newAttachmentIds;
      }
      dispatchTaskToAgent(after, dispatchOpts, req.user.userId).catch(err =>
        console.warn('[auto-dispatch]', after.id, err.message)
      );
    }

    // Phase A2.1 — Closing memory reflection.
    // When the agent closes a task (status → done|in_review) and the project
    // has a workspace bound, fire a follow-up dispatch asking the agent to
    // log any decisions / questions / risks / glossary terms before fully
    // moving on. Only triggers once per task (memory_reviewed_at guard) and
    // only when the task has a session (i.e. an agent actually worked on it).
    const isClosing = (status === 'done' || status === 'in_review') && before.status !== status;
    const shouldReflect = (
      isClosing &&
      after.sessionId &&
      after.projectId && after.projectId !== 'general' &&
      !after.memoryReviewedAt &&
      gatewayForReq(req).isConnected
    );
    if (shouldReflect) {
      // Delay slightly so the agent's closing turn fully settles before we
      // dispatch the reflection prompt — avoids interleaving with their
      // active generation.
      const reflectUserId = req.user.userId;
      setTimeout(() => {
        const fresh = db.getTask(after.id);
        if (!fresh || fresh.memoryReviewedAt) return;
        // Mark first to prevent duplicate triggers if the user toggles status quickly.
        db.updateTask(after.id, { memoryReviewedAt: new Date().toISOString() });
        dispatchTaskToAgent(fresh, { memoryReflection: true, force: true }, reflectUserId).catch(err =>
          console.warn('[memory-reflection]', after.id, err.message)
        );
      }, 1500);
    }

    broadcastTasksUpdate();
    res.json({ task: after });

    // Fire-and-forget: push status change to external source if applicable
    if (patch.status && patch.status !== before.status && after.externalId && after.externalSource) {
      const projectIntegrationsList = db.getProjectIntegrations(after.projectId || 'general');
      const integration = projectIntegrationsList.find(i => i.type === after.externalSource);
      if (integration) {
        const raw = db.getIntegrationRaw(integration.id);
        if (raw) {
          const adapter = integrations.getAdapter(raw.type);
          adapter.pushStatus(raw.config, after.externalId, patch.status).catch(err => {
            console.error('[integrations] pushStatus failed:', err.message);
          });
        }
      }
    }
  } catch (err) {
    console.error('[api/tasks PATCH]', err);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

  router.delete('/tasks/:id', db.authMiddleware, db.requireProjectOwnershipForTask, (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.getTask(id);
    if (!existing) return res.status(404).json({ error: 'Task not found' });
    const gate = checkTaskAccess(req, id);
    if (gate) return res.status(403).json({ error: gate });
    // Clean up any uploaded attachment files before deleting the row
    for (const att of (existing.attachments || [])) {
      if (att.source === 'upload') {
        try { attachmentsLib.deleteAttachmentFile(id, att.id); } catch {}
      }
    }
    db.deleteTask(id);
    broadcastTasksUpdate();
    res.json({ ok: true });
  } catch (err) {
    console.error('[api/tasks DELETE]', err);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

// ─── Task Attachments ─────────────────────────────────────────────────────────

// Upload one or more files to a task
router.post(
  '/tasks/:id/attachments',
  db.authMiddleware,
  db.requireProjectOwnershipForTask,
  uploadAttachments.array('files', 5),
  (req, res) => {
    try {
      const { id } = req.params;
      const task = db.getTask(id);
      if (!task) return res.status(404).json({ error: 'Task not found' });
      const gate = checkTaskAccess(req, id);
      if (gate) return res.status(403).json({ error: gate });

      const files = req.files || [];
      if (!files.length) return res.status(400).json({ error: 'No files uploaded (field: files)' });

      const existing = Array.isArray(task.attachments) ? task.attachments : [];
      if (existing.length + files.length > attachmentsLib.MAX_PER_TASK) {
        return res.status(400).json({ error: `Max ${attachmentsLib.MAX_PER_TASK} attachments per task` });
      }

      const added = [];
      for (const f of files) {
        const rec = attachmentsLib.storeUpload({
          taskId: id,
          originalName: f.originalname,
          buffer: f.buffer,
          mimeType: f.mimetype,
        });
        added.push(rec);
      }

      const updated = db.updateTask(id, { attachments: [...existing, ...added] });
      db.addTaskActivity({ taskId: id, type: 'comment', actor: 'user', note: `Uploaded ${added.length} attachment(s)` });
      broadcastTasksUpdate();
      res.status(201).json({ task: updated, added });
    } catch (err) {
      console.error('[api/tasks/:id/attachments POST]', err);
      res.status(400).json({ error: err.message || 'Upload failed' });
    }
  }
);

// Delete a single attachment from a task
  router.delete('/tasks/:id/attachments/:attachmentId', db.authMiddleware, db.requireProjectOwnershipForTask, (req, res) => {
  try {
    const { id, attachmentId } = req.params;
    const task = db.getTask(id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    const gate = checkTaskAccess(req, id);
    if (gate) return res.status(403).json({ error: gate });

    const existing = Array.isArray(task.attachments) ? task.attachments : [];
    const target = existing.find(a => a.id === attachmentId);
    if (!target) return res.status(404).json({ error: 'Attachment not found' });

    if (target.source === 'upload') {
      attachmentsLib.deleteAttachmentFile(id, attachmentId);
    }
    const remaining = existing.filter(a => a.id !== attachmentId);
    const updated = db.updateTask(id, { attachments: remaining });
    broadcastTasksUpdate();
    res.json({ task: updated });
  } catch (err) {
    console.error('[api/tasks/:id/attachments DELETE]', err);
    res.status(500).json({ error: 'Failed to delete attachment' });
  }
});

// Serve an uploaded attachment file. Auth required (token in header or ?token= query
// for direct <img src> / browser download usage).
function attachmentAuthMiddleware(req, res, next) {
  const queryToken = typeof req.query.token === 'string' ? req.query.token : null;
  if (queryToken && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${queryToken}`;
  }
  return db.authMiddleware(req, res, next);
}
  router.get('/attachments/:taskId/:attachmentId', attachmentAuthMiddleware, (req, res) => {
  try {
    const { taskId, attachmentId } = req.params;
    const task = db.getTask(taskId);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    // Read access is allowed for any authenticated user (matches GET /api/tasks behavior).
    const resolved = attachmentsLib.resolveAttachmentFile(taskId, attachmentId, task.attachments || []);
    if (!resolved) return res.status(404).json({ error: 'Attachment not found' });
    if (resolved.att.mimeType) res.setHeader('Content-Type', resolved.att.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(resolved.att.filename)}"`);
    // Express 5's send() rejects absolute paths without the root option — use the
    // containing directory as root and the basename as the relative path.
    const path = require('path');
    res.sendFile(path.basename(resolved.absPath), { root: path.dirname(resolved.absPath) });
  } catch (err) {
    console.error('[api/attachments GET]', err);
    res.status(500).json({ error: 'Failed to serve attachment' });
  }
});

// ─── Task Outputs (agent-produced deliverables) ───────────────────────────────

// List outputs for a task — scans {agentWorkspace}/outputs/{taskId}/
  router.get('/tasks/:id/outputs', db.authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const task = db.getTask(id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (!task.agentId) return res.json({ outputs: [] });
    const outputs = outputsLib.listOutputs(task.agentId, id);
    res.json({ outputs });
  } catch (err) {
    console.error('[api/tasks/:id/outputs GET]', err);
    res.status(500).json({ error: 'Failed to list outputs' });
  }
});

// ─── Task Comments (free-form discussion thread) ──────────────────────────────
// Any authenticated user can read + post. Agents (DASHBOARD_TOKEN) may also
// post — they identify themselves via `agentId` in the body. Edit/delete is
// restricted to the original author or an admin.

function commentBroadcast(type, taskId, comment) {
  try {
    broadcast({ type, payload: { taskId, comment } });
  } catch (err) {
    console.warn('[comment] broadcast failed:', err.message);
  }
}

// List comments for a task
  router.get('/tasks/:id/comments', db.authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const task = db.getTask(id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    const comments = db.listTaskComments(id);
    res.json({ comments });
  } catch (err) {
    console.error('[api/tasks/:id/comments GET]', err);
    res.status(500).json({ error: 'Failed to list comments' });
  }
});

// Post a comment. Body: { body: string, agentId?: string }
// - If the caller is the agent service token (role=agent), `agentId` must be provided.
// - Otherwise author is the authenticated user.
  router.post('/tasks/:id/comments', db.authMiddleware, db.requireProjectOwnershipForTask, (req, res) => {
  try {
    const { id } = req.params;
    const { body, agentId } = req.body || {};
    if (!body || !String(body).trim()) return res.status(400).json({ error: 'body is required' });
    const task = db.getTask(id);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    let comment;
    if (req.user?.role === 'agent') {
      // Service-token / agent post — require an explicit agent id
      if (!agentId) return res.status(400).json({ error: 'agentId is required when posting as an agent' });
      const agentName = (() => {
        try {
          const agents = parsers.parseAgentRegistry();
          const a = agents.find(x => x.id === agentId);
          return a?.name || agentId;
        } catch { return agentId; }
      })();
      comment = db.addTaskComment({
        taskId: id,
        authorType: 'agent',
        authorId: agentId,
        authorName: agentName,
        body: String(body).trim(),
      });
    } else {
      // Authenticated user
      const u = req.user;
      if (!u?.userId) return res.status(401).json({ error: 'Unauthorized' });
      const full = db.getUserById(u.userId);
      const name = full?.display_name || full?.username || u.username || `user-${u.userId}`;
      comment = db.addTaskComment({
        taskId: id,
        authorType: 'user',
        authorId: u.userId,
        authorName: name,
        body: String(body).trim(),
      });
    }

    commentBroadcast('task:comment_added', id, comment);
    res.status(201).json({ comment });
  } catch (err) {
    console.error('[api/tasks/:id/comments POST]', err);
    res.status(400).json({ error: err.message || 'Failed to post comment' });
  }
});

function resolveCommentAuthorGate(req, comment) {
  if (!comment) return 'Comment not found';
  if (comment.deletedAt) return 'Comment already deleted';
  if (req.user?.role === 'admin') return null;
  if (req.user?.role === 'agent') {
    // Agent token may modify only its own agent comments — agent id passed via header or body
    const agentId = req.body?.agentId || req.get('X-Agent-Id');
    if (comment.authorType === 'agent' && agentId && String(comment.authorId) === String(agentId)) return null;
    return 'You can only modify comments you authored';
  }
  // Regular user
  const userId = req.user?.userId;
  if (comment.authorType === 'user' && String(comment.authorId) === String(userId)) return null;
  return 'You can only modify comments you authored';
}

// Edit a comment (body only)
  router.patch('/tasks/:id/comments/:cid', db.authMiddleware, db.requireProjectOwnershipForTask, (req, res) => {
  try {
    const { id, cid } = req.params;
    const { body } = req.body || {};
    const task = db.getTask(id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    const existing = db.getTaskComment(cid);
    if (!existing || existing.taskId !== id) return res.status(404).json({ error: 'Comment not found' });
    const gate = resolveCommentAuthorGate(req, existing);
    if (gate) return res.status(403).json({ error: gate });
    if (!body || !String(body).trim()) return res.status(400).json({ error: 'body is required' });
    const updated = db.updateTaskComment(cid, { body: String(body).trim() });
    commentBroadcast('task:comment_edited', id, updated);
    res.json({ comment: updated });
  } catch (err) {
    console.error('[api/tasks/:id/comments/:cid PATCH]', err);
    res.status(500).json({ error: 'Failed to update comment' });
  }
});

// Soft-delete a comment
  router.delete('/tasks/:id/comments/:cid', db.authMiddleware, db.requireProjectOwnershipForTask, (req, res) => {
  try {
    const { id, cid } = req.params;
    const task = db.getTask(id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    const existing = db.getTaskComment(cid);
    if (!existing || existing.taskId !== id) return res.status(404).json({ error: 'Comment not found' });
    const gate = resolveCommentAuthorGate(req, existing);
    if (gate) return res.status(403).json({ error: gate });
    const updated = db.deleteTaskComment(cid);
    commentBroadcast('task:comment_deleted', id, updated);
    res.json({ ok: true });
  } catch (err) {
    console.error('[api/tasks/:id/comments/:cid DELETE]', err);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

// Serve a single output file. Same auth pattern as attachments (supports ?token=).
  router.get('/tasks/:id/outputs/:filename', attachmentAuthMiddleware, (req, res) => {
  try {
    const { id, filename } = req.params;
    const task = db.getTask(id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (!task.agentId) return res.status(404).json({ error: 'Task has no assigned agent' });
    const resolved = outputsLib.resolveOutputFile(task.agentId, id, filename);
    if (!resolved) return res.status(404).json({ error: 'Output not found' });
    if (resolved.mimeType) res.setHeader('Content-Type', resolved.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(resolved.filename)}"`);
    // Express 5's send() rejects absolute paths without the root option — pass the
    // task's outputs dir as root and the resolved filename as the relative path.
    res.sendFile(resolved.filename, { root: outputsLib.outputsDir(task.agentId, id) });
  } catch (err) {
    console.error('[api/tasks/:id/outputs/:filename GET]', err);
    res.status(500).json({ error: 'Failed to serve output' });
  }
});

  router.get('/tasks/:id/activity', db.authMiddleware, (req, res) => {
  try {
    if (!db.getTask(req.params.id)) return res.status(404).json({ error: 'Task not found' });
    const activity = db.getTaskActivity(req.params.id);
    res.json({ activity });
  } catch (err) {
    console.error('[api/tasks/:id/activity GET]', err);
    res.status(500).json({ error: 'Failed to fetch activity' });
  }
});

// Task dispatch is injected via DI (dispatchTaskToAgent)
// analyzeTaskForAgent is resolved at module top from hooks/task-dispatch.cjs

  router.post('/tasks/:id/analyze', db.authMiddleware, db.requireProjectOwnershipForTask, async (req, res) => {
  try {
    const task = db.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (!task.agentId) return res.status(400).json({ error: 'Task must be assigned to an agent first' });
    const gate = checkTaskAccess(req, task.id);
    if (gate) return res.status(403).json({ error: gate });

    const analysis = await analyzeTaskForAgent(task);
    db.updateTask(task.id, { analysis });
    broadcastTasksUpdate();
    res.json({ ok: true, analysis });
  } catch (err) {
    console.error('[api/tasks/analyze]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Approve / Request-change actions ─────────────────────────────────────
// `approve` and `request-change` close the in_review loop:
//   - approve         → status: in_review → done, emit lifecycle msg
//   - request-change  → append comment + status: in_review → in_progress
//                       + (best-effort) re-dispatch as continue + lifecycle msg
//
// Both are no-ops outside in_review (returns 409). Callable by users (UI button)
// AND by agent service token (orchestrator helper script).
  router.post('/tasks/:id/approve', db.authMiddleware, db.requireProjectOwnershipForTask, async (req, res) => {
  try {
    const task = db.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (task.status !== 'in_review') {
      return res.status(409).json({ error: `Cannot approve a task in '${task.status}' state — must be 'in_review'` });
    }
    const actor = req.user?.role === 'agent' ? (req.body?.agentId || 'agent') : (req.user?.username ? `user:${req.user.username}` : 'user');
    const note = String(req.body?.note || 'Approved').slice(0, 500);

    const after = db.updateTask(task.id, { status: 'done' });
    db.addTaskActivity({ taskId: task.id, type: 'status_change', fromValue: 'in_review', toValue: 'done', actor, note });
    if (note && note !== 'Approved') {
      db.addTaskActivity({ taskId: task.id, type: 'comment', actor, note: `✅ ${note}` });
    }
    emitTaskRoomSystemMessage(after, `Task approved · ${after.title}`);
    broadcastTasksUpdate();
    res.json({ ok: true, task: after });
  } catch (err) {
    console.error('[api/tasks/approve]', err);
    res.status(500).json({ error: err.message });
  }
});

  router.post('/tasks/:id/request-change', db.authMiddleware, db.requireProjectOwnershipForTask, async (req, res) => {
  try {
    const task = db.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    const reason = String(req.body?.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'reason is required' });
    if (task.status !== 'in_review') {
      return res.status(409).json({ error: `Cannot request-change on a task in '${task.status}' state — must be 'in_review'` });
    }
    const actor = req.user?.role === 'agent' ? (req.body?.agentId || 'agent') : (req.user?.username ? `user:${req.user.username}` : 'user');

    // 1. Append change request as a comment so it shows up in the task's
    //    activity log AND gets injected into the next dispatch's `commentsContext`.
    db.addTaskActivity({ taskId: task.id, type: 'comment', actor, note: `[change_request] ${reason}` });

    // 2. Status: in_review → in_progress (loop back). NO new session created —
    //    the same task session is resumed via continue dispatch below.
    const after = db.updateTask(task.id, { status: 'in_progress' });
    db.addTaskActivity({ taskId: task.id, type: 'status_change', fromValue: 'in_review', toValue: 'in_progress', actor, note: 'change requested' });

    // 3. Lifecycle msg in room
    emitTaskRoomSystemMessage(after, `Change requested for ${after.title}: ${reason}`);

    // 4. Best-effort re-dispatch (continue). Reuses the existing task.sessionId
    //    so the agent receives the new comment as part of the continue context.
    //    Fails silently — user can manually re-dispatch from UI if needed.
    if (gatewayForReq(req).isConnected && after.agentId) {
      dispatchTaskToAgent(after, {}, req.user.userId).catch(err => console.warn('[request-change] re-dispatch failed:', err.message));
    }

    broadcastTasksUpdate();
    res.json({ ok: true, task: after });
  } catch (err) {
    console.error('[api/tasks/request-change]', err);
    res.status(500).json({ error: err.message });
  }
});

  router.post('/tasks/:id/dispatch', db.authMiddleware, db.requireProjectOwnershipForTask, async (req, res) => {
  try {
    const task = db.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (!task.agentId) return res.status(400).json({ error: 'Task must be assigned to an agent first' });

    // Orchestrator guardrail: refuse to dispatch a `main`-assigned task when
    // the dispatch is initiated by the orchestrator itself. Main is the
    // delegator, never the executor — this is the same invariant as the
    // create-task self-assign guard. User can still dispatch manually from UI.
    if (task.agentId === 'main' && req.user?.role === 'agent') {
      console.warn(`[tasks/dispatch] orchestrator tried to dispatch main-assigned task ${task.id} — refused`);
      return res.status(409).json({
        error: 'Refused: orchestrator cannot dispatch a task assigned to itself. Re-assign the task to a specialist first.',
        code: 'ORCHESTRATOR_SELF_DISPATCH',
      });
    }

    const gate = checkTaskAccess(req, task.id);
    if (gate) return res.status(403).json({ error: gate });
    if (!gatewayForReq(req).isConnected) return res.status(503).json({ error: 'Gateway not connected' });
    const result = await dispatchTaskToAgent(task, {}, req.user.userId);
    res.json({ ok: true, ...result });
  } catch (err) {
    if (err.code === 'TASK_BLOCKED') {
      return res.status(409).json({ error: err.message, code: err.code, unmetBlockers: err.unmetBlockers });
    }
    console.error('[api/tasks/dispatch]', err);
    res.status(500).json({ error: err.message });
  }
})

/**
 * POST /api/tasks/:id/interrupt — soft-abort the agent's in-flight work.
 *
 * Calls the gateway's chat.abort RPC, which stops the current generation
 * (model inference + tool loop) but keeps the session alive. The user can
 * re-dispatch later with change-request/continue context — prior messages
 * are preserved.
 *
 * Task status is left as-is so the user explicitly decides what to do next
 * (Resume / Mark Blocked / Request Changes). An activity row is logged so
 * the reason is visible in the history.
 */
  router.post('/tasks/:id/interrupt', db.authMiddleware, db.requireProjectOwnershipForTask, async (req, res) => {
  try {
    const task = db.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    const gate = checkTaskAccess(req, task.id);
    if (gate) return res.status(403).json({ error: gate });
    if (!task.sessionId) return res.status(400).json({ error: 'Task has no active session to interrupt' });
    if (!gatewayForReq(req).isConnected) return res.status(503).json({ error: 'Gateway not connected' });

    let abortResult = null;
    try {
      abortResult = await gatewayForReq(req).chatAbort(task.sessionId);
    } catch (rpcErr) {
      // Gateway may not implement chat.abort on older versions — surface a clear error
      console.error('[api/tasks/interrupt] chat.abort RPC failed:', rpcErr.message);
      return res.status(502).json({ error: `Gateway abort failed: ${rpcErr.message}` });
    }

    const note = typeof req.body?.note === 'string' && req.body.note.trim()
      ? req.body.note.trim().slice(0, 500)
      : 'Interrupted by user';
    const actor = req.user?.username ? `user:${req.user.username}` : 'user';
    db.addTaskActivity({ taskId: task.id, type: 'comment', actor, note: `🛑 ${note}` });

    broadcast({ type: 'task:interrupted', payload: { taskId: task.id, sessionKey: task.sessionId, note } });
    broadcastTasksUpdate();
    res.json({ ok: true, sessionKey: task.sessionId, abortResult });
  } catch (err) {
    console.error('[api/tasks/interrupt]', err);
    res.status(500).json({ error: err.message });
  }
});



  return router;
};
