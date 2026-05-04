/**
 * routes/role-templates.cjs
 *
 * ADLC Role Templates CRUD + assignment.
 * Step 6b of server modularization.
 */
'use strict';

module.exports = function roleTemplatesRouter(deps) {
  const { db, parsers } = deps;
  const router = require('express').Router();

// ─── ADLC Role Templates (Phase 1: read-only) ───────────────────────────────

// GET /api/role-templates — list all templates with summary metadata
  router.get('/role-templates', db.authMiddleware, (req, res) => {
  try {
    const templates = parsers.listRoleTemplates();
    // Strip heavy fields from list payload — UI fetches detail on demand
    const summary = templates.map(t => ({
      id:               t.id,
      adlcAgentNumber:  t.adlcAgentNumber,
      adlcAgentSuffix:  t.adlcAgentSuffix || null,
      subRoleOf:        t.subRoleOf || null,
      role:             t.role,
      emoji:            t.emoji,
      color:            t.color,
      description:      t.description,
      modelRecommendation: t.modelRecommendation,
      tags:             t.tags,
      origin:           t.origin,
      builtIn:          t.builtIn,
      skillCount:       Array.isArray(t.skillSlugs) ? t.skillSlugs.length : 0,
      scriptCount:      Array.isArray(t.scriptTemplates) ? t.scriptTemplates.length : 0,
      updatedAt:        t.updatedAt,
    }));
    res.json({ templates: summary });
  } catch (err) {
    console.error('[api/role-templates]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/role-templates/:id — full template including agent files,
// skill bundle, and script templates
  router.get('/role-templates/:id', db.authMiddleware, (req, res) => {
  try {
    const template = parsers.getRoleTemplate(req.params.id);
    if (!template) return res.status(404).json({ error: `Role template "${req.params.id}" not found` });
    res.json({ template });
  } catch (err) {
    console.error('[api/role-templates/:id]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/role-templates/:id/usage — which agents reference this template?
  router.get('/role-templates/:id/usage', db.authMiddleware, (req, res) => {
  try {
    const agentIds = parsers.listRoleTemplateUsage(req.params.id);
    res.json({ agentIds, count: agentIds.length });
  } catch (err) {
    console.error('[api/role-templates/:id/usage]', err);
    res.status(500).json({ error: err.message });
  }
});

function roleTemplateErrorStatus(err) {
  switch (err?.code) {
    case 'VALIDATION': return 400;
    case 'NOT_FOUND':  return 404;
    case 'CONFLICT':   return 409;
    case 'READ_ONLY':  return 403;
    case 'IN_USE':     return 409;
    default:           return 500;
  }
}

// POST /api/role-templates — create a custom template
// Body: { id, role, emoji?, color?, description?, modelRecommendation?,
//         adlcAgentNumber?, tags?, agentFiles?, skillSlugs?, skillContents?,
//         scriptTemplates?, fsWorkspaceOnly? }
  router.post('/role-templates', db.authMiddleware, (req, res) => {
  try {
    const created = parsers.createRoleTemplate(req.body || {});
    console.log(`[api/role-templates] Created "${created.id}"`);
    res.status(201).json({ template: created });
  } catch (err) {
    console.error('[api/role-templates][POST]', err.message);
    res.status(roleTemplateErrorStatus(err)).json({ error: err.message, code: err.code, details: err.details });
  }
});

// POST /api/role-templates/refresh-builtins — re-seed built-in templates
// from server/data/role-templates-seed.json, overwriting existing built-in
// rows. User templates are untouched. Admin only.
  router.post('/role-templates/refresh-builtins', db.authMiddleware, db.requireAdmin, (req, res) => {
  try {
    const result = parsers.refreshBuiltInRoleTemplates();
    console.log('[api/role-templates/refresh-builtins]', result);
    res.json(result);
  } catch (err) {
    console.error('[api/role-templates/refresh-builtins]', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/role-templates/:id — update metadata / refs for a user template
// Built-ins are rejected with 403 — caller must fork first.
  router.patch('/role-templates/:id', db.authMiddleware, (req, res) => {
  try {
    const updated = parsers.updateRoleTemplate(req.params.id, req.body || {});
    console.log(`[api/role-templates] Updated "${req.params.id}"`);
    res.json({ template: updated });
  } catch (err) {
    console.error('[api/role-templates][PATCH]', err.message);
    res.status(roleTemplateErrorStatus(err)).json({ error: err.message, code: err.code, details: err.details });
  }
});

// DELETE /api/role-templates/:id — delete a user template
// Query: ?force=true to also clear `role` from agents referencing it
  router.delete('/role-templates/:id', db.authMiddleware, (req, res) => {
  try {
    const force = req.query.force === 'true' || req.query.force === '1';
    const result = parsers.deleteRoleTemplate(req.params.id, { force });
    console.log(`[api/role-templates] Deleted "${req.params.id}"${force ? ' (forced)' : ''}`);
    res.json(result);
  } catch (err) {
    console.error('[api/role-templates][DELETE]', err.message);
    res.status(roleTemplateErrorStatus(err)).json({ error: err.message, code: err.code, usage: err.usage });
  }
});

// POST /api/role-templates/:id/fork — copy a template (built-in or custom)
// Body: { newId?, overrides? } — overrides is a partial template patch
  router.post('/role-templates/:id/fork', db.authMiddleware, (req, res) => {
  try {
    const { newId, overrides } = req.body || {};
    const forked = parsers.forkRoleTemplate(req.params.id, newId, overrides || {});
    console.log(`[api/role-templates] Forked "${req.params.id}" → "${forked.id}"`);
    res.status(201).json({ template: forked });
  } catch (err) {
    console.error('[api/role-templates][fork]', err.message);
    res.status(roleTemplateErrorStatus(err)).json({ error: err.message, code: err.code });
  }
});

// GET /api/role-templates/:id/preview-apply?agentId=X
// Returns per-file / skill / script changes that applying this template
// would produce for the given agent.
  router.get('/role-templates/:id/preview-apply', db.authMiddleware, (req, res) => {
  try {
    const { agentId } = req.query;
    if (!agentId || typeof agentId !== 'string') {
      return res.status(400).json({ error: 'agentId query param required' });
    }
    const preview = parsers.previewRoleTemplateApply(req.params.id, agentId);
    res.json({ preview });
  } catch (err) {
    console.error('[api/role-templates/preview-apply]', err.message);
    res.status(roleTemplateErrorStatus(err)).json({ error: err.message, code: err.code });
  }
});

// POST /api/agents/:agentId/assign-role
// Body: {
//   templateId, overwriteFiles?, installSkills?, installScripts?,
//   overwriteConflictingScripts?
// }
  router.post('/agents/:agentId/assign-role', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const { templateId, overwriteFiles, installSkills, installScripts, overwriteConflictingScripts } = req.body || {};
    if (!templateId) return res.status(400).json({ error: 'templateId is required' });
    const savedBy = req.user?.username || 'dashboard';
    const result = parsers.applyRoleTemplateToAgent(templateId, req.params.agentId, {
      overwriteFiles, installSkills, installScripts, overwriteConflictingScripts, savedBy,
    });
    console.log(`[api/agents/assign-role] "${req.params.agentId}" ← "${templateId}": ${result.applied.files.length} files, ${result.applied.skillsAddedToAllowlist.length} skill refs, ${result.applied.scriptsWritten.length} scripts`);
    res.json(result);
  } catch (err) {
    console.error('[api/agents/assign-role]', err.message);
    res.status(roleTemplateErrorStatus(err)).json({ error: err.message, code: err.code });
  }
});

// POST /api/agents/:agentId/unassign-role — clear agent role (files untouched)
  router.post('/agents/:agentId/unassign-role', db.authMiddleware, db.requireAgentOwnership, (req, res) => {
  try {
    const result = parsers.unassignAgentRole(req.params.agentId);
    console.log(`[api/agents/unassign-role] "${req.params.agentId}"`);
    res.json(result);
  } catch (err) {
    console.error('[api/agents/unassign-role]', err.message);
    res.status(roleTemplateErrorStatus(err)).json({ error: err.message, code: err.code });
  }
});


  return router;
};
