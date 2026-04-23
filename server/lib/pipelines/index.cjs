// Pipelines — graph validation + CRUD wrapper around db helpers.
//
// Graph shape (React Flow compatible):
//   {
//     nodes: [{ id, type, data: { ... }, position: { x, y } }],
//     edges: [{ id, source, target, sourceHandle?, targetHandle?, data? }],
//     viewport?: { x, y, zoom }
//   }
//
// Validation (see docs/pipelines-design.md §5) — enforced at save time.

const crypto = require('node:crypto');
const db = require('../db.cjs');

const VALID_NODE_TYPES = new Set(['trigger', 'agent', 'condition', 'human_approval', 'output']);
const VALID_HANDLE_TYPES = new Set(['text', 'json', 'file', 'approval']);
const MAX_NODES = 50;

const TEMPLATE_REF_RE = /\{\{\s*artifact\.([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)\s*\}\}/g;

function newId(prefix = 'pl') {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

/**
 * Validate pipeline graph shape + invariants.
 * @returns {{ valid: boolean, errors: Array, warnings: Array }}
 */
function validateGraph(graph) {
  const errors = [];
  const warnings = [];

  if (!graph || typeof graph !== 'object') {
    return { valid: false, errors: [{ code: 'bad_shape', message: 'graph must be an object' }], warnings };
  }
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : null;
  const edges = Array.isArray(graph.edges) ? graph.edges : null;
  if (!nodes || !edges) {
    return {
      valid: false,
      errors: [{ code: 'bad_shape', message: 'graph must have nodes[] and edges[]' }],
      warnings,
    };
  }

  // Empty graph is considered a draft — valid but warned.
  if (nodes.length === 0) {
    warnings.push({ code: 'empty_graph', message: 'pipeline has no nodes' });
    return { valid: true, errors, warnings };
  }

  if (nodes.length > MAX_NODES) {
    errors.push({ code: 'too_many_nodes', message: `max ${MAX_NODES} nodes per pipeline (got ${nodes.length})` });
  }

  // Per-node sanity
  const nodesById = new Map();
  const triggers = [];
  const outputs = [];
  for (const n of nodes) {
    if (!n.id || typeof n.id !== 'string') {
      errors.push({ code: 'node_missing_id', message: 'node is missing id' });
      continue;
    }
    if (nodesById.has(n.id)) {
      errors.push({ node_id: n.id, code: 'duplicate_node_id', message: `duplicate node id: ${n.id}` });
    }
    nodesById.set(n.id, n);

    const type = n.type || n.data?.nodeType;
    if (!VALID_NODE_TYPES.has(type)) {
      errors.push({ node_id: n.id, code: 'invalid_node_type', message: `unknown node type: ${type}` });
    }
    if (type === 'trigger') triggers.push(n);
    if (type === 'output')  outputs.push(n);

    if (type === 'agent' && !n.data?.agentId) {
      errors.push({ node_id: n.id, code: 'agent_node_missing_agent', message: `agent node ${n.id} missing agentId` });
    }
  }

  if (triggers.length === 0) {
    errors.push({ code: 'no_trigger', message: 'pipeline must have exactly one trigger node' });
  } else if (triggers.length > 1) {
    errors.push({ code: 'multiple_triggers', message: 'pipeline may have at most one trigger node' });
  }
  if (outputs.length === 0) {
    warnings.push({ code: 'no_output', message: 'pipeline has no output node — run results will not be bundled' });
  }

  // Edge sanity + graph structure
  const outgoing = new Map();  // nodeId → [edge]
  const incoming = new Map();  // nodeId → [edge]
  const edgesById = new Map();
  for (const e of edges) {
    if (!e.id || typeof e.id !== 'string') {
      errors.push({ code: 'edge_missing_id', message: 'edge is missing id' });
      continue;
    }
    if (edgesById.has(e.id)) {
      errors.push({ edge_id: e.id, code: 'duplicate_edge_id', message: `duplicate edge id: ${e.id}` });
    }
    edgesById.set(e.id, e);
    if (!nodesById.has(e.source)) {
      errors.push({ edge_id: e.id, code: 'edge_bad_source', message: `edge source ${e.source} not a node` });
      continue;
    }
    if (!nodesById.has(e.target)) {
      errors.push({ edge_id: e.id, code: 'edge_bad_target', message: `edge target ${e.target} not a node` });
      continue;
    }

    // Handle type compatibility if both handles declare types on the node data
    const srcNode = nodesById.get(e.source);
    const tgtNode = nodesById.get(e.target);
    const srcHandles = srcNode?.data?.outputs || [];
    const tgtHandles = tgtNode?.data?.inputs || [];
    const srcH = e.sourceHandle ? srcHandles.find(h => h.key === e.sourceHandle) : null;
    const tgtH = e.targetHandle ? tgtHandles.find(h => h.key === e.targetHandle) : null;
    if (srcH?.type && tgtH?.type && srcH.type !== tgtH.type) {
      errors.push({
        edge_id: e.id,
        code: 'handle_type_mismatch',
        message: `edge ${e.id}: handle types mismatch (${srcH.type} → ${tgtH.type})`,
      });
    }
    if (srcH?.type && !VALID_HANDLE_TYPES.has(srcH.type)) {
      errors.push({ edge_id: e.id, code: 'invalid_handle_type', message: `unknown handle type: ${srcH.type}` });
    }

    if (!outgoing.has(e.source)) outgoing.set(e.source, []);
    outgoing.get(e.source).push(e);
    if (!incoming.has(e.target)) incoming.set(e.target, []);
    incoming.get(e.target).push(e);
  }

  // Cycle detection (DFS with coloring: 0 unvisited, 1 in-progress, 2 done)
  const color = new Map();
  const cyclePath = [];
  function dfs(nodeId, stack) {
    color.set(nodeId, 1);
    stack.push(nodeId);
    const outs = outgoing.get(nodeId) || [];
    for (const e of outs) {
      const c = color.get(e.target) || 0;
      if (c === 1) {
        cyclePath.push([...stack, e.target]);
        return true;
      }
      if (c === 0 && dfs(e.target, stack)) return true;
    }
    stack.pop();
    color.set(nodeId, 2);
    return false;
  }
  for (const id of nodesById.keys()) {
    if ((color.get(id) || 0) === 0) {
      if (dfs(id, [])) break;
    }
  }
  if (cyclePath.length) {
    errors.push({
      code: 'cycle_detected',
      message: `pipeline graph contains a cycle: ${cyclePath[0].join(' → ')}`,
    });
  }

  // Reachability from trigger
  if (triggers.length === 1 && cyclePath.length === 0) {
    const reachable = new Set();
    const stack = [triggers[0].id];
    while (stack.length) {
      const id = stack.pop();
      if (reachable.has(id)) continue;
      reachable.add(id);
      for (const e of outgoing.get(id) || []) stack.push(e.target);
    }
    for (const id of nodesById.keys()) {
      if (!reachable.has(id) && nodesById.get(id).type !== 'trigger') {
        warnings.push({ node_id: id, code: 'node_unreachable', message: `node ${id} is not reachable from trigger` });
      }
    }
  }

  // Prompt template references
  for (const n of nodes) {
    const type = n.type || n.data?.nodeType;
    if (type !== 'agent') continue;
    const tpl = n.data?.promptTemplate || '';
    if (typeof tpl !== 'string') continue;
    let m;
    TEMPLATE_REF_RE.lastIndex = 0;
    while ((m = TEMPLATE_REF_RE.exec(tpl)) !== null) {
      const [, stepRef, outputKey] = m;
      const refNode = nodesById.get(stepRef);
      if (!refNode) {
        errors.push({
          node_id: n.id,
          code: 'template_bad_ref',
          message: `prompt of ${n.id} references missing node ${stepRef}`,
        });
        continue;
      }
      const refOutputs = refNode.data?.outputs || [];
      if (refOutputs.length && !refOutputs.find(o => o.key === outputKey)) {
        warnings.push({
          node_id: n.id,
          code: 'template_unknown_output',
          message: `prompt of ${n.id} references ${stepRef}.${outputKey} but ${stepRef} does not declare that output`,
        });
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

function createPipeline({ name, description, graph, createdBy }) {
  const id = newId('pl');
  const g = graph || { nodes: [], edges: [] };
  // Soft-validate: allow empty/draft, but reject structural errors.
  const v = validateGraph(g);
  if (!v.valid && g.nodes && g.nodes.length > 0) {
    const err = new Error('pipeline validation failed');
    err.code = 'VALIDATION_FAILED';
    err.details = v;
    throw err;
  }
  return db.createPipeline({ id, name, description, graph: g, createdBy });
}

function updatePipeline(id, patch) {
  if (patch.graph !== undefined) {
    const v = validateGraph(patch.graph);
    if (!v.valid && patch.graph.nodes && patch.graph.nodes.length > 0) {
      const err = new Error('pipeline validation failed');
      err.code = 'VALIDATION_FAILED';
      err.details = v;
      throw err;
    }
  }
  return db.updatePipeline(id, patch);
}

module.exports = {
  validateGraph,
  createPipeline,
  updatePipeline,
  deletePipeline: db.deletePipeline,
  getPipeline: db.getPipeline,
  getAllPipelines: db.getAllPipelines,
  listPipelinesForUser: db.listPipelinesForUser,
  MAX_NODES,
  VALID_NODE_TYPES,
  VALID_HANDLE_TYPES,
};
