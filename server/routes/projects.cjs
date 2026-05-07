/**
 * routes/projects.cjs
 *
 * Projects CRUD + workspace binding + git ops + integrations + epics +
 * task dependencies + project memory + filesystem browser.
 * Step 7b of server modularization.
 */
'use strict';

const { parseOwnerParam, checkCronAccess } = require('../helpers/access-control.cjs');
const { gatewayForReq } = require('../helpers/gateway-context.cjs');

module.exports = function projectsRouter(deps) {
  const { db, parsers, projectGit, projectWs, vSave, integrations } = deps;
  const router = require('express').Router();

// ─── Projects ─────────────────────────────────────────────────────────────────

// Helpers (workspace + repo) — must register BEFORE `/:id` to avoid path collision.
//
// POST /api/projects/_validate-path
//   body: { path, mode: 'greenfield'|'brownfield', name? }
//   returns: { ok, mode, resolvedPath, parent?, repo: { isRepo, ... } | null,
//              existingBinding: {id,name,kind,mode}|null, warnings: [] }
  router.post('/projects/_validate-path', db.authMiddleware, async (req, res) => {
  try {
    const { path: rawPath, mode, name } = req.body || {};
    if (!rawPath) return res.status(400).json({ ok: false, error: 'path is required' });
    if (mode !== 'greenfield' && mode !== 'brownfield') {
      return res.status(400).json({ ok: false, error: "mode must be 'greenfield' or 'brownfield'" });
    }

    let validation;
    if (mode === 'brownfield') {
      validation = projectWs.validateBrownfieldPath(rawPath);
    } else {
      validation = projectWs.validateGreenfieldPath(rawPath, name || '');
    }
    if (!validation.ok) {
      return res.json({ ok: false, mode, error: validation.reason, ...validation });
    }

    const resolvedPath = validation.path;
    const warnings = [];

    // Brownfield-specific: detect existing binding + repo state
    let repo = null;
    let existingBinding = null;
    let pathBoundToOtherProject = null;

    if (mode === 'brownfield') {
      // Existing .aoc binding
      existingBinding = projectWs.readAocBinding(resolvedPath);
      if (existingBinding && existingBinding.id) {
        // Check if a row exists for that ID
        const owned = db.getProject(existingBinding.id);
        const byPath = db.getProjectByPath(resolvedPath);
        if (byPath && byPath.id !== existingBinding.id) {
          warnings.push(`Path bound to project '${byPath.id}' in DB, but .aoc/project.json says '${existingBinding.id}'`);
        }
        if (owned) pathBoundToOtherProject = { id: owned.id, name: owned.name };
      } else {
        const byPath = db.getProjectByPath(resolvedPath);
        if (byPath) pathBoundToOtherProject = { id: byPath.id, name: byPath.name };
      }

      // Repo inspection
      const insp = await projectGit.inspectRepo(resolvedPath);
      if (insp.isRepo) {
        if (insp.isSubmodule) {
          warnings.push('Path is a git submodule — choose the superproject root instead.');
        }
        if (insp.isDetached) {
          warnings.push('Repo is in detached HEAD state — checkout a branch before binding.');
        }
        repo = insp;
      }
    }

    res.json({
      ok: true,
      mode,
      resolvedPath,
      parent: validation.parent || null,
      repo,
      existingBinding,
      pathBoundToOtherProject,
      warnings,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/projects/_fetch-branches
//   body: { path, projectId? }   (projectId optional — used to bump last_fetched_at)
//   returns: { ok, fetchSucceeded, fetchError?, branches, currentBranch, isDirty, uncommittedFiles }
  router.post('/projects/_fetch-branches', db.authMiddleware, async (req, res) => {
  try {
    const { path: rawPath, projectId } = req.body || {};
    if (!rawPath) return res.status(400).json({ ok: false, error: 'path is required' });
    const validation = projectWs.validateBrownfieldPath(rawPath);
    if (!validation.ok) return res.status(400).json({ ok: false, error: validation.reason });
    const cwd = validation.path;

    const isRepo = await projectGit.isGitRepo(cwd);
    if (!isRepo) return res.json({ ok: true, isRepo: false, branches: [] });

    const remotes = await projectGit.getRemotes(cwd);
    const remoteName = (remotes.find((r) => r.name === 'origin') || remotes[0])?.name;

    let fetch = { succeeded: false, error: 'no remote configured', durationMs: 0 };
    if (remoteName) fetch = await projectGit.fetchRemote(cwd, remoteName);

    const [branches, currentBranch, status] = await Promise.all([
      projectGit.listBranches(cwd),
      projectGit.getCurrentBranch(cwd),
      projectGit.getStatus(cwd),
    ]);

    if (projectId && fetch.succeeded) {
      try { db.bumpProjectFetchedAt(projectId); } catch {}
    }

    res.json({
      ok: true,
      isRepo: true,
      fetchSucceeded: fetch.succeeded,
      fetchError: fetch.succeeded ? null : fetch.error,
      fetchDurationMs: fetch.durationMs,
      remoteName: remoteName || null,
      currentBranch,
      isDirty: status.isDirty,
      uncommittedFiles: status.uncommittedFiles,
      branches,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

  router.get('/projects', db.authMiddleware, (req, res) => {
  const allProjects = db.getAllProjects();
  // Admin default = own projects only. Cross-tenant monitoring requires explicit ?owner=all|<id>.
  const hasOwnerParam = req.query?.owner != null && req.query.owner !== '';
  const scope = hasOwnerParam ? parseOwnerParam(req) : 'me';
  const isAdmin = req.user?.role === 'admin';
  const uid = req.user?.userId;

  const projects = allProjects.filter((project) => {
    const ownerId = project.createdBy ?? null;
    // unowned projects (ownerId == null) treated as shared — visible to all
    if (ownerId == null) return true;
    if (isAdmin) {
      if (scope === 'all') return true;
      if (scope === 'me') return ownerId === uid;
      if (typeof scope === 'number') return ownerId === scope;
      return true;
    }
    return ownerId === uid;
  });

  res.json({ projects });
});

// POST /api/projects
//   body: { name, color?, description?, kind?,
//           workspaceMode?: 'greenfield'|'brownfield',
//           workspacePath?, parentPath?,         // greenfield: parentPath+name; brownfield: workspacePath
//           branch?,                              // brownfield: which branch to checkout
//           initGit?, addRemoteUrl? }            // greenfield options
//
//  - No workspaceMode → behaves exactly like the legacy endpoint (creates an unbound project row).
//  - greenfield → scaffolds folder, optional `git init`, binds .aoc/.
//  - brownfield → checks dirty, optional checkout branch, binds .aoc/ + appends .gitignore block.
  router.post('/projects', db.authMiddleware, async (req, res) => {
  try {
    const {
      name, color, description, kind,
      workspaceMode, workspacePath, parentPath,
      branch, initGit, addRemoteUrl,
    } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });

    const createdBy = req.user?.userId ?? null;

    // Legacy / unbound path
    if (!workspaceMode) {
      const project = db.createProject({ name, color, description, kind, createdBy });
      return res.json({ project });
    }

    if (workspaceMode !== 'greenfield' && workspaceMode !== 'brownfield') {
      return res.status(400).json({ error: "workspaceMode must be 'greenfield' or 'brownfield'" });
    }

    // ── Greenfield ──
    if (workspaceMode === 'greenfield') {
      if (!parentPath) return res.status(400).json({ error: 'parentPath is required for greenfield' });
      const validation = projectWs.validateGreenfieldPath(parentPath, name);
      if (!validation.ok) return res.status(400).json({ error: validation.reason });
      const targetPath = validation.path;

      // Create DB row first (gets id), then scaffold using that id.
      const project = db.createProject({
        name, color, description, kind: kind || 'ops',
        workspacePath: targetPath, workspaceMode: 'greenfield',
        createdBy,
      });

      try {
        projectWs.scaffoldGreenfield({
          workspacePath: targetPath, projectId: project.id, name, kind: kind || 'ops',
        });
      } catch (e) {
        // scaffold failed — best-effort cleanup of the DB row and target dir
        try { db.deleteProject(project.id); } catch {}
        try { require('fs').rmSync(targetPath, { recursive: true, force: true }); } catch {}
        return res.status(500).json({ error: `scaffold failed: ${e.message}` });
      }

      // Optional git init
      let repoUrl = null, repoBranch = null, repoRemoteName = null;
      if (initGit) {
        const initResult = await projectGit._run(['init', '-b', 'main'], { cwd: targetPath });
        if (!initResult.ok) {
          // Don't fail the whole project — just warn
          console.warn(`[projects] git init failed for ${targetPath}: ${initResult.stderr}`);
        } else {
          repoBranch = 'main';
          if (addRemoteUrl) {
            const r = await projectGit._run(['remote', 'add', 'origin', String(addRemoteUrl)], { cwd: targetPath });
            if (r.ok) { repoUrl = String(addRemoteUrl); repoRemoteName = 'origin'; }
          }
        }
      }
      const updated = db.setProjectWorkspace(project.id, {
        repoUrl, repoBranch, repoRemoteName, boundAt: Date.now(),
      });
      return res.json({ project: updated });
    }

    // ── Brownfield ──
    if (!workspacePath) return res.status(400).json({ error: 'workspacePath is required for brownfield' });
    const validation = projectWs.validateBrownfieldPath(workspacePath);
    if (!validation.ok) return res.status(400).json({ error: validation.reason });
    const targetPath = validation.path;

    // Refuse if path already bound to another project
    const existingByPath = db.getProjectByPath(targetPath);
    if (existingByPath) {
      return res.status(409).json({
        error: 'path already bound to another project',
        boundProjectId: existingByPath.id,
        boundProjectName: existingByPath.name,
      });
    }

    // Repo inspect + dirty/branch handling
    const insp = await projectGit.inspectRepo(targetPath);
    let repoUrl = null, repoBranch = null, repoRemoteName = null;
    if (insp.isRepo) {
      if (insp.isSubmodule) return res.status(400).json({ error: 'path is a git submodule — choose superproject root instead' });
      if (insp.isDetached) return res.status(400).json({ error: 'repo is in detached HEAD; checkout a branch first' });
      if (insp.isDirty) {
        return res.status(409).json({
          error: 'working tree dirty — commit or stash before binding',
          uncommittedFiles: insp.uncommittedFiles,
        });
      }

      // Switch branch if requested + different from current
      if (branch && branch !== insp.currentBranch) {
        const isRemoteRef = branch.includes('/') && (insp.remotes || []).some((r) => branch.startsWith(r.name + '/'));
        const co = await projectGit.checkoutBranch(targetPath, branch, { createLocalFromRemote: isRemoteRef });
        if (!co.ok) {
          return res.status(409).json({ error: `checkout failed: ${co.error}`, uncommittedFiles: co.uncommittedFiles });
        }
        repoBranch = co.currentBranch;
      } else {
        repoBranch = insp.currentBranch;
      }

      const origin = (insp.remotes || []).find((r) => r.name === 'origin') || insp.remotes?.[0];
      if (origin) { repoUrl = origin.url; repoRemoteName = origin.name; }
    }

    // Create DB row (uses generated id) then bind
    const project = db.createProject({
      name, color, description, kind: kind || 'ops',
      workspacePath: targetPath, workspaceMode: 'brownfield',
      repoUrl, repoBranch, repoRemoteName,
      createdBy,
    });
    try {
      projectWs.bindBrownfield({
        workspacePath: targetPath, projectId: project.id, name, kind: kind || 'ops',
      });
    } catch (e) {
      try { db.deleteProject(project.id); } catch {}
      return res.status(500).json({ error: `bind failed: ${e.message}` });
    }

    res.json({ project: db.getProject(project.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

  router.patch('/projects/:id', db.authMiddleware, db.requireProjectOwnership, (req, res) => {
  try {
    const { name, color, description, kind } = req.body;
    const project = db.updateProject(req.params.id, { name, color, description, kind });
    if (!project) return res.status(404).json({ error: 'not found' });
    res.json({ project });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/projects/:id
//   query: ?unbind=true   → remove .gitignore block + project.json (soft, keeps .aoc dir)
//          ?unbind=true&hard=true  → also rm -rf .aoc/ directory
//   default: leave workspace untouched (paranoid — DB row deleted only)
  router.delete('/projects/:id', db.authMiddleware, db.requireProjectOwnership, (req, res) => {
  try {
    if (req.params.id === 'general') return res.status(403).json({ error: 'Cannot delete the default project' });
    const project = db.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not found' });

    const unbind = String(req.query.unbind || '') === 'true';
    const hard   = String(req.query.hard   || '') === 'true';
    let unbindResult = null;
    if (unbind && project.workspacePath) {
      try {
        unbindResult = projectWs.unbindWorkspace(project.workspacePath, { removeAocDir: hard });
      } catch (e) {
        unbindResult = { error: e.message };
      }
    }
    db.deleteProject(req.params.id);
    res.json({ ok: true, unbindResult });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/projects/:id/branch — switch active branch on a brownfield-bound project.
//   body: { branch }
  router.patch('/projects/:id/branch', db.authMiddleware, db.requireProjectOwnership, async (req, res) => {
  try {
    const { branch } = req.body || {};
    if (!branch) return res.status(400).json({ error: 'branch is required' });
    const project = db.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not found' });
    if (!project.workspacePath) return res.status(400).json({ error: 'project has no workspace bound' });

    const insp = await projectGit.inspectRepo(project.workspacePath);
    if (!insp.isRepo) return res.status(400).json({ error: 'workspace is not a git repo' });
    if (insp.isDirty) {
      return res.status(409).json({ error: 'working tree dirty', uncommittedFiles: insp.uncommittedFiles });
    }
    const isRemoteRef = branch.includes('/') && (insp.remotes || []).some((r) => branch.startsWith(r.name + '/'));
    const co = await projectGit.checkoutBranch(project.workspacePath, branch, { createLocalFromRemote: isRemoteRef });
    if (!co.ok) return res.status(409).json({ error: co.error, uncommittedFiles: co.uncommittedFiles });

    const updated = db.setProjectWorkspace(project.id, { repoBranch: co.currentBranch });
    projectWs.appendActivityLog(
      project.workspacePath,
      `switch-branch project=${project.id} from=${insp.currentBranch} to=${co.currentBranch}`
    );
    res.json({ project: updated, switched: co.switched, headSha: co.headSha });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:id/refetch — manual fetch trigger; returns latest branch list.
  router.post('/projects/:id/refetch', db.authMiddleware, db.requireProjectOwnership, async (req, res) => {
  try {
    const project = db.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not found' });
    if (!project.workspacePath) return res.status(400).json({ error: 'project has no workspace bound' });

    const isRepo = await projectGit.isGitRepo(project.workspacePath);
    if (!isRepo) return res.json({ ok: true, isRepo: false, branches: [] });

    const remoteName = project.repoRemoteName || 'origin';
    const fetch = await projectGit.fetchRemote(project.workspacePath, remoteName);
    if (fetch.succeeded) db.bumpProjectFetchedAt(project.id);

    const [branches, currentBranch, status] = await Promise.all([
      projectGit.listBranches(project.workspacePath),
      projectGit.getCurrentBranch(project.workspacePath),
      projectGit.getStatus(project.workspacePath),
    ]);
    res.json({
      ok: true,
      isRepo: true,
      fetchSucceeded: fetch.succeeded,
      fetchError: fetch.succeeded ? null : fetch.error,
      currentBranch,
      isDirty: status.isDirty,
      uncommittedFiles: status.uncommittedFiles,
      branches,
      project: db.getProject(project.id),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Project Integrations ──────────────────────────────────────────────────────
// ─── Epics (Phase B — ADLC grouping) ────────────────────────────────────────
//
// Epics group related tasks within a project. Visible/usable across all
// project kinds, but the wizard surfaces them mostly for `kind=adlc`. Read
// access is open (any logged-in user can list); writes require project
// ownership (mirrors the project mutation rules).

  router.get('/projects/:id/epics', db.authMiddleware, (req, res) => {
  try { res.json({ epics: db.listEpics(req.params.id) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

  router.post('/projects/:id/epics', db.authMiddleware, db.requireProjectOwnership, (req, res) => {
  try {
    const { title, description, status, color } = req.body || {};
    if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
    const epic = db.createEpic({
      projectId: req.params.id,
      title: title.trim(),
      description, status, color,
      createdBy: req.user?.userId ?? null,
    });
    res.status(201).json({ epic });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// :id here refers to the EPIC id; ownership is checked via the parent project.
  router.patch('/epics/:id', db.authMiddleware, (req, res) => {
  try {
    const epic = db.getEpic(req.params.id);
    if (!epic) return res.status(404).json({ error: 'epic not found' });
    if (!db.userOwnsProject(req, epic.projectId)) {
      return res.status(403).json({ error: 'You do not have permission to modify this epic' });
    }
    const updated = db.updateEpic(req.params.id, req.body || {});
    res.json({ epic: updated });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

  router.delete('/epics/:id', db.authMiddleware, (req, res) => {
  try {
    const epic = db.getEpic(req.params.id);
    if (!epic) return res.status(404).json({ error: 'epic not found' });
    if (!db.userOwnsProject(req, epic.projectId)) {
      return res.status(403).json({ error: 'You do not have permission to delete this epic' });
    }
    db.deleteEpic(req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Task dependencies (Phase B — directed edges) ───────────────────────────

  router.get('/tasks/:id/dependencies', db.authMiddleware, (req, res) => {
  try { res.json({ dependencies: db.listDependenciesForTask(req.params.id) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

  router.post('/tasks/:id/dependencies', db.authMiddleware, db.requireProjectOwnershipForTask, (req, res) => {
  try {
    const { blockerTaskId, blockedTaskId, kind } = req.body || {};
    // Caller passes the OTHER task's id; we infer from :id which side it is
    // based on whether the body specified blocker or blocked. For ergonomics,
    // accept either — the route param is the "current" task.
    const me = req.params.id;
    const other = blockerTaskId || blockedTaskId;
    if (!other) return res.status(400).json({ error: 'blockerTaskId or blockedTaskId is required' });
    const dep = db.addTaskDependency({
      blockerTaskId: blockerTaskId || me,
      blockedTaskId: blockedTaskId || me,
      kind: kind || 'blocks',
    });
    res.status(201).json({ dependency: dep });
  } catch (err) {
    if (err.code === 'DEP_CYCLE') return res.status(409).json({ error: err.message, code: err.code });
    res.status(400).json({ error: err.message });
  }
});

  router.delete('/tasks/:id/dependencies/:depId', db.authMiddleware, db.requireProjectOwnershipForTask, (req, res) => {
  try { db.removeTaskDependency(req.params.depId); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Bulk: all dependency edges for a project. Used by the board to render
// blocked indicators on TaskCards without N+1 fetches.
  router.get('/projects/:id/dependencies', db.authMiddleware, (req, res) => {
  try { res.json({ dependencies: db.listDependenciesForProject(req.params.id) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Project memory (Phase A2 — decisions/questions/risks/glossary) ─────────

  router.get('/projects/:id/memory', db.authMiddleware, (req, res) => {
  try {
    const { kind, status } = req.query;
    res.json({ items: db.listProjectMemory(req.params.id, { kind, status }) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

  router.post('/projects/:id/memory', db.authMiddleware, db.requireProjectOwnership, (req, res) => {
  try {
    const { kind, title, body, status, meta, sourceTaskId } = req.body || {};
    const item = db.createProjectMemory({
      projectId: req.params.id,
      kind, title, body, status, meta, sourceTaskId,
      createdBy: req.user?.id ?? null,
    });
    res.status(201).json({ item });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

  router.patch('/memory/:id', db.authMiddleware, (req, res) => {
  try {
    const cur = db.getProjectMemory(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Not found' });
    // Project-scoped ownership: re-use requireProjectOwnership semantics manually.
    if (req.user?.role !== 'admin' && req.user?.role !== 'agent') {
      const ownerId = db.getProjectOwner(cur.projectId);
      if (ownerId != null && ownerId !== req.user?.id) {
        return res.status(403).json({ error: 'Not project owner' });
      }
    }
    const item = db.updateProjectMemory(req.params.id, req.body || {});
    res.json({ item });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

  router.delete('/memory/:id', db.authMiddleware, (req, res) => {
  try {
    const cur = db.getProjectMemory(req.params.id);
    if (!cur) return res.json({ ok: true });
    if (req.user?.role !== 'admin' && req.user?.role !== 'agent') {
      const ownerId = db.getProjectOwner(cur.projectId);
      if (ownerId != null && ownerId !== req.user?.id) {
        return res.status(403).json({ error: 'Not project owner' });
      }
    }
    db.deleteProjectMemory(req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

  router.get('/projects/:id/integrations', db.authMiddleware, (req, res) => {
  res.json({ integrations: db.getProjectIntegrations(req.params.id) });
});

  router.post('/projects/:id/integrations', db.authMiddleware, db.requireProjectOwnership, async (req, res) => {
  try {
    const { type, credentials, spreadsheetId, sheetName, mapping, syncIntervalMs, enabled, syncFromRow, syncLimit } = req.body;
    if (!type) return res.status(400).json({ error: 'type is required' });

    const adapter = integrations.getAdapter(type);

    // Encrypt credentials before storing
    const encryptedCredentials = credentials ? integrations.encrypt(
      typeof credentials === 'string' ? credentials : JSON.stringify(credentials)
    ) : undefined;

    const config = {
      spreadsheetId, sheetName, mapping,
      ...(syncFromRow ? { syncFromRow: Number(syncFromRow) } : {}),
      ...(syncLimit   ? { syncLimit:   Number(syncLimit)   } : {}),
    };
    if (encryptedCredentials) config.credentials = encryptedCredentials;

    const validation = adapter.validateConfig(config);
    if (!validation.valid) return res.status(400).json({ error: validation.error });

    const integration = db.createIntegration({
      projectId: req.params.id,
      type,
      config,
      syncIntervalMs: syncIntervalMs || null,
      enabled: enabled !== false,
    });

    // Schedule if interval set
    if (integration.syncIntervalMs && integration.enabled) {
      integrations.scheduleIntegration(integration);
    }

    // Strip credentials before returning
    const { credentials: _c, ...safeConfig } = integration.config;
    res.json({ integration: { ...integration, config: safeConfig, hasCredentials: !!integration.config.credentials } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

  router.patch('/projects/:id/integrations/:iid', db.authMiddleware, db.requireProjectOwnership, async (req, res) => {
  try {
    const existing = db.getIntegrationRaw(req.params.iid);
    if (!existing) return res.status(404).json({ error: 'not found' });

    const { credentials, spreadsheetId, sheetName, mapping, syncIntervalMs, enabled, syncFromRow, syncLimit } = req.body;

    const newConfig = { ...existing.config };
    if (spreadsheetId !== undefined) newConfig.spreadsheetId = spreadsheetId;
    if (sheetName     !== undefined) newConfig.sheetName = sheetName;
    if (mapping       !== undefined) newConfig.mapping = mapping;
    if (syncFromRow   !== undefined) newConfig.syncFromRow = syncFromRow ? Number(syncFromRow) : undefined;
    if (syncLimit     !== undefined) newConfig.syncLimit   = syncLimit   ? Number(syncLimit)   : undefined;
    if (credentials) {
      newConfig.credentials = integrations.encrypt(
        typeof credentials === 'string' ? credentials : JSON.stringify(credentials)
      );
    }

    const patch = { config: newConfig };
    if (syncIntervalMs !== undefined) patch.syncIntervalMs = syncIntervalMs || null;
    if (enabled        !== undefined) patch.enabled = enabled;

    const updated = db.updateIntegration(req.params.iid, patch);
    integrations.scheduleIntegration(updated); // reschedule (handles enable/disable/interval change)
    const { credentials: _c, ...safeConfig } = updated.config;
    res.json({ integration: { ...updated, config: safeConfig, hasCredentials: !!updated.config.credentials } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

  router.delete('/projects/:id/integrations/:iid', db.authMiddleware, db.requireProjectOwnership, (req, res) => {
  try {
    integrations.unscheduleIntegration(req.params.iid);
    db.deleteIntegration(req.params.iid);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test connection — credentials passed in body, not yet saved
  router.post('/projects/:id/integrations/:iid/test', db.authMiddleware, async (req, res) => {
  try {
    const { type, credentials, spreadsheetId } = req.body;
    const adapterType = type || 'google_sheets';
    const adapter = integrations.getAdapter(adapterType);
    const encCreds = credentials ? integrations.encrypt(
      typeof credentials === 'string' ? credentials : JSON.stringify(credentials)
    ) : undefined;
    const result = await adapter.testConnection({ spreadsheetId, credentials: encCreds });
    res.json(result);
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// Get column headers for a given sheet name
// iid can be '_new' (during wizard before integration is saved) or an existing integration id
  router.post('/projects/:id/integrations/:iid/headers', db.authMiddleware, async (req, res) => {
  try {
    const { sheetName, credentials, spreadsheetId } = req.body;
    let config;
    if (req.params.iid === '_new') {
      const encCreds = credentials ? integrations.encrypt(
        typeof credentials === 'string' ? credentials : JSON.stringify(credentials)
      ) : undefined;
      config = { spreadsheetId, credentials: encCreds };
    } else {
      const raw = db.getIntegrationRaw(req.params.iid);
      if (!raw) return res.status(404).json({ error: 'not found' });
      config = raw.config;
    }
    const adapter = integrations.getAdapter('google_sheets');
    const headers = await adapter.getHeaders(config, sheetName);
    res.json({ headers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manual sync trigger — responds immediately, runs sync async
  router.post('/projects/:id/integrations/:iid/sync', db.authMiddleware, db.requireProjectOwnership, async (req, res) => {
  const integration = db.getIntegrationRaw(req.params.iid);
  if (!integration) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true, message: 'Sync started' });
  integrations.syncIntegration(req.params.iid).catch(err => {
    console.error('[integrations] manual sync error:', err.message);
  });
});

// Cron — delivery targets (known channels + contacts from sessions)
  router.get('/cron/delivery-targets', db.authMiddleware, (req, res) => {
  try {
    const { parseScopeUserId } = require('../helpers/access-control.cjs');
    const targetUid = parseScopeUserId(req);
    res.json({ channels: parsers.getDeliveryTargets(targetUid) });
  } catch (err) {
    console.error('[api/cron/delivery-targets]', err.message);
    res.status(500).json({ error: 'Failed to fetch delivery targets' });
  }
});

// Cron — list
  router.get('/cron', db.authMiddleware, (req, res) => {
  try {
    const { parseScopeUserId } = require('../helpers/access-control.cjs');
    const targetUid = parseScopeUserId(req);
    let jobs = parsers.parseCronJobs(targetUid) || [];

    // Defensive: per-user filesystem already scopes the read, but if any job
    // references an agent owned by someone else (legacy data), strip it.
    const isAdmin = req.user?.role === 'admin';
    if (!isAdmin) {
      jobs = jobs.filter((j) => !j.agentId || db.userOwnsAgent(req, j.agentId));
    }
    res.json({ jobs });
  } catch (err) {
    console.error('[api/cron]', err.message);
    res.status(500).json({ error: 'Failed to fetch cron jobs' });
  }
});

// Cron — create
  router.post('/cron', db.authMiddleware, async (req, res) => {
  try {
    const { parseScopeUserId } = require('../helpers/access-control.cjs');
    const targetUid = parseScopeUserId(req);
    if (req.body?.agentId && !db.userOwnsAgent(req, req.body.agentId)) {
      return res.status(403).json({ error: 'You can only create cron jobs for agents you own' });
    }
    const result = await parsers.cronCreateJob(req.body, gatewayForReq(req), targetUid);
    res.status(201).json(result);
  } catch (err) {
    console.error('[api/cron POST]', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to create cron job' });
  }
});

// Cron — run history for a job
  router.get('/cron/:id/runs', db.authMiddleware, async (req, res) => {
  try {
    const { parseScopeUserId } = require('../helpers/access-control.cjs');
    const targetUid = parseScopeUserId(req);
    const limit = parseInt(req.query.limit) || 50;
    const result = await parsers.cronGetRuns(req.params.id, limit, gatewayForReq(req), targetUid);
    res.json(result);
  } catch (err) {
    console.error('[api/cron/:id/runs]', err.message);
    res.status(500).json({ error: err.message || 'Failed to get cron runs' });
  }
});

// Cron — trigger job now
  router.post('/cron/:id/run', db.authMiddleware, async (req, res) => {
  try {
    const gate = await checkCronAccess(req, req.params.id, db, parsers);
    if (gate) return res.status(403).json({ error: gate });
    const result = await parsers.cronRunJob(req.params.id, gatewayForReq(req));
    res.json(result);
  } catch (err) {
    console.error('[api/cron/:id/run]', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to trigger cron job' });
  }
});

// Cron — toggle enabled/disabled
  router.post('/cron/:id/toggle', db.authMiddleware, async (req, res) => {
  try {
    const { parseScopeUserId } = require('../helpers/access-control.cjs');
    const targetUid = parseScopeUserId(req);
    const gate = await checkCronAccess(req, req.params.id, db, parsers);
    if (gate) return res.status(403).json({ error: gate });
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') return res.status(400).json({ error: '`enabled` boolean required' });
    const result = await parsers.cronToggleJob(req.params.id, enabled, gatewayForReq(req), targetUid);
    res.json(result);
  } catch (err) {
    console.error('[api/cron/:id/toggle]', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to toggle cron job' });
  }
});

// Cron — edit
  router.patch('/cron/:id', db.authMiddleware, async (req, res) => {
  try {
    const { parseScopeUserId } = require('../helpers/access-control.cjs');
    const targetUid = parseScopeUserId(req);
    const gate = await checkCronAccess(req, req.params.id, db, parsers);
    if (gate) return res.status(403).json({ error: gate });
    const result = await parsers.cronUpdateJob(req.params.id, req.body, gatewayForReq(req), targetUid);
    res.json(result);
  } catch (err) {
    console.error('[api/cron PATCH]', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to update cron job' });
  }
});

// Cron — delete
  router.delete('/cron/:id', db.authMiddleware, async (req, res) => {
  try {
    const { parseScopeUserId } = require('../helpers/access-control.cjs');
    const targetUid = parseScopeUserId(req);
    const gate = await checkCronAccess(req, req.params.id, db, parsers);
    if (gate) return res.status(403).json({ error: gate });
    const result = await parsers.cronDeleteJob(req.params.id, gatewayForReq(req), targetUid);
    res.json(result);
  } catch (err) {
    console.error('[api/cron DELETE]', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to delete cron job' });
  }
});

// ── Agent Custom Tools (scripts assigned via TOOLS.md) ───────────────────────

  router.get('/agents/:id/custom-tools', db.authMiddleware, (req, res) => {
  try {
    const tools = parsers.listAgentCustomTools(req.params.id, parsers.getAgentFile);
    res.json({ tools });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

  router.post('/agents/:id/custom-tools/:filename/toggle', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const { enabled, scope } = req.body;
    if (typeof enabled !== 'boolean') return res.status(400).json({ error: '`enabled` boolean required' });
    const result = parsers.toggleAgentCustomTool(
      req.params.id, req.params.filename, enabled, scope || 'shared',
      parsers.getAgentFile, parsers.saveAgentFile
    );
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

  router.post('/agents/:id/sync-task-script', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const { id } = req.params;
    parsers.ensureUpdateTaskScript();
    parsers.toggleAgentCustomTool(id, 'update_task.sh', true, 'shared', parsers.getAgentFile, parsers.saveAgentFile);
    res.json({ ok: true });
  } catch (err) {
    console.error('[api/sync-task-script]', err);
    res.status(500).json({ error: err.message });
  }
});

// Agent workspace scripts (agentWorkspace/scripts/) — full CRUD
  router.get('/agents/:id/scripts', db.authMiddleware, (req, res) => {
  try { res.json({ scripts: parsers.listAgentScripts(req.params.id) }); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

  router.get('/agents/:id/scripts/:filename', db.authMiddleware, (req, res) => {
  try { res.json(parsers.getAgentScript(req.params.id, req.params.filename)); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

  router.put('/agents/:id/scripts/:filename', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const { content } = req.body;
    if (typeof content !== 'string') return res.status(400).json({ error: '`content` required' });
    const result = parsers.saveAgentScript(req.params.id, req.params.filename, content);
    vSave(`script:agent:${req.params.id}:${req.params.filename}`, content, req);
    res.json(result);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

  router.patch('/agents/:id/scripts/:filename/rename', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const { newName } = req.body;
    if (!newName) return res.status(400).json({ error: '`newName` required' });
    res.json(parsers.renameAgentScript(req.params.id, req.params.filename, newName));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

  router.delete('/agents/:id/scripts/:filename', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try { res.json(parsers.deleteAgentScript(req.params.id, req.params.filename)); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

  router.patch('/agents/:id/scripts/:filename/meta', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try { res.json(parsers.updateAgentScriptMeta(req.params.id, req.params.filename, req.body)); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// ── Workspace Scripts ─────────────────────────────────────────────────────────

  router.get('/scripts', db.authMiddleware, (req, res) => {
  try { res.json({ scripts: parsers.listScripts() }); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

  router.get('/scripts/:filename', db.authMiddleware, (req, res) => {
  try { res.json(parsers.getScript(req.params.filename)); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

  router.put('/scripts/:filename', db.authMiddleware, db.requireAdmin, (req, res) => {
  try {
    const { content } = req.body;
    if (typeof content !== 'string') return res.status(400).json({ error: '`content` string required' });
    const result = parsers.saveScript(req.params.filename, content);
    vSave(`script:global:${req.params.filename}`, content, req);
    res.json(result);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

  router.patch('/scripts/:filename/rename', db.authMiddleware, db.requireAdmin, (req, res) => {
  try {
    const { newName } = req.body;
    if (!newName) return res.status(400).json({ error: '`newName` required' });
    res.json(parsers.renameScript(req.params.filename, newName));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

  router.delete('/scripts/:filename', db.authMiddleware, db.requireAdmin, (req, res) => {
  try { res.json(parsers.deleteScript(req.params.filename)); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

  router.patch('/scripts/:filename/meta', db.authMiddleware, db.requireAdmin, (req, res) => {
  try { res.json(parsers.updateScriptMeta(req.params.filename, req.body)); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Per-user channel configuration (sanitized — no tokens)
  router.get('/channels', db.authMiddleware, (req, res) => {
  try {
    const { parseScopeUserId } = require('../helpers/access-control.cjs');
    res.json(parsers.getChannelsConfig(parseScopeUserId(req)));
  } catch (err) {
    console.error('[api/channels]', err);
    res.status(500).json({ error: 'Failed to fetch channel config' });
  }
});

// Channel login: start QR flow via gateway RPC web.login.start
// POST /api/channels/:channel/:account/login/start
  router.post('/channels/:channel/:account/login/start', db.authMiddleware, async (req, res) => {
  const { account } = req.params;

  const gw = gatewayForReq(req);
  if (!gw.isConnected) {
    return res.status(503).json({ error: 'Gateway not connected. Start the gateway first.' });
  }

  try {
    // Params: { accountId?, force?, timeoutMs?, verbose? } — no channel field
    const result = await gw.webLoginStart(account);
    const qrDataUrl = result?.qrDataUrl || null;
    const message = result?.message || null;

    if (qrDataUrl) return res.json({ qrDataUrl, message });

    // No QR = already linked — mark as authenticated if not already
    try {
      const { OPENCLAW_HOME, readJsonSafe } = require('../lib/config.cjs');
      const configPath = path.join(OPENCLAW_HOME, 'openclaw.json');
      const config = readJsonSafe(configPath);
      const acct = config?.channels?.whatsapp?.accounts?.[account];
      if (acct && !acct.authenticated) {
        acct.authenticated = true;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        console.log(`[api/channels/login/start] Marked whatsapp/${account} as authenticated (already linked)`);
      }
    } catch (_) {}

    return res.json({ qrDataUrl: null, message: message || 'WhatsApp already linked.' });
  } catch (err) {
    console.error('[api/channels/login/start]', err);
    res.status(500).json({ error: err.message || 'Failed to start login flow' });
  }
});

// Channel login: wait for QR scan completion (long-poll, up to 3 min)
// POST /api/channels/:channel/:account/login/wait
  router.post('/channels/:channel/:account/login/wait', db.authMiddleware, async (req, res) => {
  const { channel, account } = req.params;

  const gw2 = gatewayForReq(req);
  if (!gw2.isConnected) {
    return res.status(503).json({ error: 'Gateway not connected' });
  }

  try {
    const result = await gw2.webLoginWait(account);

    // Mark the channel account as authenticated in openclaw.json
    try {
      const { OPENCLAW_HOME, readJsonSafe } = require('../lib/config.cjs');
      const configPath = path.join(OPENCLAW_HOME, 'openclaw.json');
      const config = readJsonSafe(configPath);
      if (config?.channels?.[channel]?.accounts?.[account]) {
        config.channels[channel].accounts[account].authenticated = true;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        console.log(`[api/channels/login/wait] Marked ${channel}/${account} as authenticated`);
      }
    } catch (cfgErr) {
      console.warn('[api/channels/login/wait] Failed to update openclaw.json:', cfgErr.message);
    }

    return res.json({ ok: true, ...result });
  } catch (err) {
    console.warn('[api/channels/login/wait] failed:', err.message);
    res.status(500).json({ error: err.message || 'Login wait failed' });
  }

});

// Routes (channel bindings) — per-user
  router.get('/routes', db.authMiddleware, (req, res) => {
  try {
    const { parseScopeUserId } = require('../helpers/access-control.cjs');
    const targetUid = parseScopeUserId(req);
    let routes = typeof parsers.parseRoutes === 'function' ? parsers.parseRoutes(targetUid) : [];

    // Defensive: drop bindings whose agent isn't owned by this user.
    const isAdmin = req.user?.role === 'admin';
    if (!isAdmin) {
      routes = routes.filter((r) => !r.agentId || db.userOwnsAgent(req, r.agentId));
    }

    // Enrich with SQLite profile data (avatarPresetId, color). Scope to caller's
    // tenant — composite-PK schema means the same slug may exist under multiple
    // owners and we want THIS user's profile.
    const callerId = Number(req.user?.userId);
    const enriched = routes.map(r => {
      const profile = r.agentId ? db.getAgentProfile(r.agentId, callerId) : null;
      return {
        ...r,
        avatarPresetId: profile?.avatarPresetId ?? profile?.avatar_preset_id ?? null,
        color: profile?.color ?? null,
      };
    });
    res.json({ routes: enriched });
  } catch (err) {
    console.error('[api/routes]', err);
    res.status(500).json({ error: 'Failed to fetch routes' });
  }
});


  return router;
};
