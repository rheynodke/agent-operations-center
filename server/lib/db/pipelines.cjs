'use strict';

/**
 * Pipelines — workflow graph definitions (legacy / brownfield).
 *
 * Schema: `pipelines` (id, name, description, graph_json, created_by). Runs
 * + steps + artifacts cascade-deleted in deletePipeline.
 *
 * Ownership model mirrors connections/projects: admin + service tokens
 * bypass; otherwise check `created_by`.
 */

const handle = require('./_handle.cjs');
function _db() { return handle.getDb(); }

function normalizePipeline(row) {
  if (!row || !row.id) return null;
  let graph = { nodes: [], edges: [] };
  try { graph = row.graph_json ? JSON.parse(row.graph_json) : graph; } catch {}
  return {
    id: row.id,
    name: row.name,
    description: row.description || null,
    graph,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getAllPipelines() {
  const db = _db();
  if (!db) return [];
  const res = db.exec('SELECT * FROM pipelines ORDER BY updated_at DESC');
  if (!res.length) return [];
  const cols = res[0].columns;
  return res[0].values.map(r => {
    const obj = {}; cols.forEach((c, i) => { obj[c] = r[i]; });
    return normalizePipeline(obj);
  }).filter(Boolean);
}

function getPipeline(id) {
  const db = _db();
  if (!db) return null;
  const res = db.exec('SELECT * FROM pipelines WHERE id = ?', [id]);
  if (!res.length || !res[0].values.length) return null;
  const cols = res[0].columns;
  const obj = {}; cols.forEach((c, i) => { obj[c] = res[0].values[0][i]; });
  return normalizePipeline(obj);
}

function createPipeline({ id, name, description, graph, createdBy }) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  const now = new Date().toISOString();
  const graphJson = JSON.stringify(graph || { nodes: [], edges: [] });
  db.run(
    `INSERT INTO pipelines (id, name, description, graph_json, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, name, description || null, graphJson, createdBy || null, now, now]
  );
  handle.persist();
  return getPipeline(id);
}

function updatePipeline(id, patch) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  const now = new Date().toISOString();
  const fields = ['updated_at = ?'];
  const vals = [now];
  if (patch.name        !== undefined) { fields.push('name = ?');        vals.push(patch.name); }
  if (patch.description !== undefined) { fields.push('description = ?'); vals.push(patch.description); }
  if (patch.graph       !== undefined) { fields.push('graph_json = ?');  vals.push(JSON.stringify(patch.graph)); }
  vals.push(id);
  db.run(`UPDATE pipelines SET ${fields.join(', ')} WHERE id = ?`, vals);
  handle.persist();
  return getPipeline(id);
}

function deletePipeline(id) {
  const db = _db();
  if (!db) throw new Error('DB not initialized');
  db.run('DELETE FROM pipeline_artifacts WHERE run_id IN (SELECT id FROM pipeline_runs WHERE pipeline_id = ?)', [id]);
  db.run('DELETE FROM pipeline_steps     WHERE run_id IN (SELECT id FROM pipeline_runs WHERE pipeline_id = ?)', [id]);
  db.run('DELETE FROM pipeline_runs      WHERE pipeline_id = ?', [id]);
  db.run('DELETE FROM pipelines          WHERE id = ?', [id]);
  handle.persist();
}

function listPipelinesForUser(req) {
  const all = getAllPipelines();
  if (!req?.user) return [];
  if (req.user.role === 'admin' || req.user.role === 'agent') return all;
  return all.filter(p => p.createdBy == null || p.createdBy === req.user.userId);
}

function getPipelineOwner(pipelineId) {
  const db = _db();
  if (!db) return null;
  const res = db.exec('SELECT created_by FROM pipelines WHERE id = ?', [pipelineId]);
  if (!res.length || !res[0].values.length) return null;
  return res[0].values[0][0];
}

function userOwnsPipeline(req, pipelineId) {
  if (!req?.user) return false;
  if (req.user.role === 'admin' || req.user.role === 'agent') return true;
  const owner = getPipelineOwner(pipelineId);
  return owner != null && owner === req.user.userId;
}

function requirePipelineOwnership(req, res, next) {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: 'pipeline id missing' });
  if (!userOwnsPipeline(req, id)) {
    return res.status(403).json({ error: 'You do not have permission to modify this pipeline' });
  }
  next();
}

module.exports = {
  normalizePipeline,
  getAllPipelines,
  getPipeline,
  createPipeline,
  updatePipeline,
  deletePipeline,
  listPipelinesForUser,
  getPipelineOwner,
  userOwnsPipeline,
  requirePipelineOwnership,
};
