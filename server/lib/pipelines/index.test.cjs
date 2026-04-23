// Graph validation unit tests. Fast — no DB, no I/O.
// Run: node --test server/lib/pipelines/index.test.cjs

const test = require('node:test');
const assert = require('node:assert');
const { validateGraph } = require('./index.cjs');

// ── Helpers ─────────────────────────────────────────────────────────────────
function n(id, type, extra = {}) {
  return { id, type, position: { x: 0, y: 0 }, data: extra };
}
function e(id, source, target, extra = {}) {
  return { id, source, target, ...extra };
}

test('empty graph is valid but warned', () => {
  const r = validateGraph({ nodes: [], edges: [] });
  assert.strictEqual(r.valid, true);
  assert.ok(r.warnings.some(w => w.code === 'empty_graph'));
});

test('rejects non-object graph', () => {
  assert.strictEqual(validateGraph(null).valid, false);
  assert.strictEqual(validateGraph(42).valid, false);
  assert.strictEqual(validateGraph({ nodes: 'x', edges: [] }).valid, false);
});

test('requires exactly one trigger', () => {
  const noTrigger = validateGraph({
    nodes: [n('a', 'agent', { agentId: 'ag1' }), n('o', 'output')],
    edges: [e('e1', 'a', 'o')],
  });
  assert.ok(noTrigger.errors.some(x => x.code === 'no_trigger'));

  const twoTriggers = validateGraph({
    nodes: [n('t1', 'trigger'), n('t2', 'trigger'), n('o', 'output')],
    edges: [e('e1', 't1', 'o'), e('e2', 't2', 'o')],
  });
  assert.ok(twoTriggers.errors.some(x => x.code === 'multiple_triggers'));
});

test('agent node requires agentId', () => {
  const r = validateGraph({
    nodes: [n('t', 'trigger'), n('a', 'agent'), n('o', 'output')],
    edges: [e('e1', 't', 'a'), e('e2', 'a', 'o')],
  });
  assert.ok(r.errors.some(x => x.code === 'agent_node_missing_agent'));
});

test('cycle detected', () => {
  const r = validateGraph({
    nodes: [
      n('t', 'trigger'),
      n('a', 'agent', { agentId: 'x' }),
      n('b', 'agent', { agentId: 'y' }),
      n('o', 'output'),
    ],
    edges: [
      e('e1', 't', 'a'),
      e('e2', 'a', 'b'),
      e('e3', 'b', 'a'), // ← cycle
      e('e4', 'b', 'o'),
    ],
  });
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some(x => x.code === 'cycle_detected'));
});

test('unreachable node warns', () => {
  const r = validateGraph({
    nodes: [
      n('t', 'trigger'),
      n('a', 'agent', { agentId: 'x' }),
      n('dangling', 'agent', { agentId: 'y' }),
      n('o', 'output'),
    ],
    edges: [e('e1', 't', 'a'), e('e2', 'a', 'o')],
  });
  assert.ok(r.warnings.some(x => x.code === 'node_unreachable' && x.node_id === 'dangling'));
});

test('edge references missing node', () => {
  const r = validateGraph({
    nodes: [n('t', 'trigger'), n('o', 'output')],
    edges: [e('e1', 't', 'ghost')],
  });
  assert.ok(r.errors.some(x => x.code === 'edge_bad_target'));
});

test('duplicate node ids flagged', () => {
  const r = validateGraph({
    nodes: [n('t', 'trigger'), n('a', 'agent', { agentId: 'x' }), n('a', 'output')],
    edges: [e('e1', 't', 'a')],
  });
  assert.ok(r.errors.some(x => x.code === 'duplicate_node_id'));
});

test('prompt template reference to missing node', () => {
  const r = validateGraph({
    nodes: [
      n('t', 'trigger'),
      n('a', 'agent', {
        agentId: 'x',
        promptTemplate: 'see {{artifact.nonexistent.output}}',
      }),
      n('o', 'output'),
    ],
    edges: [e('e1', 't', 'a'), e('e2', 'a', 'o')],
  });
  assert.ok(r.errors.some(x => x.code === 'template_bad_ref'));
});

test('prompt template unknown output key warns', () => {
  const r = validateGraph({
    nodes: [
      n('t', 'trigger'),
      n('a', 'agent', {
        agentId: 'x',
        outputs: [{ key: 'prd', type: 'text' }],
      }),
      n('b', 'agent', {
        agentId: 'y',
        promptTemplate: 'see {{artifact.a.nonexistent}}',
      }),
      n('o', 'output'),
    ],
    edges: [e('e1', 't', 'a'), e('e2', 'a', 'b'), e('e3', 'b', 'o')],
  });
  assert.ok(r.warnings.some(x => x.code === 'template_unknown_output'));
});

test('handle type mismatch on edge', () => {
  const r = validateGraph({
    nodes: [
      n('t', 'trigger'),
      n('a', 'agent', { agentId: 'x', outputs: [{ key: 'out', type: 'text' }] }),
      n('b', 'agent', { agentId: 'y', inputs: [{ key: 'in', type: 'json' }] }),
      n('o', 'output'),
    ],
    edges: [
      e('e1', 't', 'a'),
      e('e2', 'a', 'b', { sourceHandle: 'out', targetHandle: 'in' }),
      e('e3', 'b', 'o'),
    ],
  });
  assert.ok(r.errors.some(x => x.code === 'handle_type_mismatch'));
});

test('valid ADLC linear pipeline', () => {
  const nodes = [
    n('trigger', 'trigger', { triggerKind: 'manual' }),
    n('pm', 'agent', {
      agentId: 'pm-analyst',
      outputs: [{ key: 'prd', type: 'text' }],
    }),
    n('ux', 'agent', {
      agentId: 'ux-designer',
      inputs: [{ key: 'prd', type: 'text' }],
      outputs: [{ key: 'wireframes', type: 'text' }],
      promptTemplate: 'Review: {{artifact.pm.prd}}',
    }),
    n('em', 'agent', {
      agentId: 'em-architect',
      inputs: [{ key: 'prd', type: 'text' }, { key: 'wireframes', type: 'text' }],
      outputs: [{ key: 'spec', type: 'text' }],
      promptTemplate: 'Design: {{artifact.pm.prd}} and {{artifact.ux.wireframes}}',
    }),
    n('output', 'output'),
  ];
  const edges = [
    e('t_pm', 'trigger', 'pm'),
    e('pm_ux', 'pm', 'ux', { sourceHandle: 'prd', targetHandle: 'prd' }),
    e('pm_em', 'pm', 'em', { sourceHandle: 'prd', targetHandle: 'prd' }),
    e('ux_em', 'ux', 'em', { sourceHandle: 'wireframes', targetHandle: 'wireframes' }),
    e('em_out', 'em', 'output'),
  ];
  const r = validateGraph({ nodes, edges });
  assert.strictEqual(r.valid, true, `errors: ${JSON.stringify(r.errors)}`);
});
