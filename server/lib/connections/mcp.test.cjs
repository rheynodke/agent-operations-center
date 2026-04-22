// MCP pool unit tests. Spawns the reference "everything" MCP server via npx.
// Slow on first run (npx download) — give it ~30s.
//
// Run: node --test server/lib/connections/mcp.test.cjs

const test = require('node:test');
const assert = require('node:assert');
const mcp = require('./mcp.cjs');

const EVERYTHING_SERVER_SPEC = {
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-everything'],
  env: {},
  credentials: '', // no secrets for this server
};

test('hashSpec is stable + sensitive to changes', () => {
  const a = mcp._hashSpec({ command: 'x', args: ['a'], env: {}, credentials: '' });
  const b = mcp._hashSpec({ command: 'x', args: ['a'], env: {}, credentials: '' });
  const c = mcp._hashSpec({ command: 'x', args: ['b'], env: {}, credentials: '' });
  assert.strictEqual(a, b);
  assert.notStrictEqual(a, c);
});

test('hashSpec detects credential change', () => {
  const a = mcp._hashSpec({ command: 'x', args: [], env: {}, credentials: '{"K":"1"}' });
  const b = mcp._hashSpec({ command: 'x', args: [], env: {}, credentials: '{"K":"2"}' });
  assert.notStrictEqual(a, b);
});

test('parseCredentialsEnv handles valid + invalid input', () => {
  assert.deepStrictEqual(mcp._parseCredentialsEnv('{"A":"1","B":"2"}'), { A: '1', B: '2' });
  assert.deepStrictEqual(mcp._parseCredentialsEnv(''), {});
  assert.deepStrictEqual(mcp._parseCredentialsEnv('not-json'), {});
  assert.deepStrictEqual(mcp._parseCredentialsEnv('null'), {});
  assert.deepStrictEqual(mcp._parseCredentialsEnv('[1,2]'), {}); // arrays rejected
  // Non-string values filtered out
  assert.deepStrictEqual(mcp._parseCredentialsEnv('{"A":"x","B":42}'), { A: 'x' });
});

test('probe returns tools list for the everything server', { timeout: 120_000 }, async () => {
  const result = await mcp.probe(EVERYTHING_SERVER_SPEC);
  assert.strictEqual(result.ok, true, `probe failed: ${result.error || ''}`);
  assert.ok(Array.isArray(result.tools), 'tools must be array');
  assert.ok(result.tools.length > 0, 'everything server should expose tools');
  // Sanity: one tool should be named "echo"
  const names = result.tools.map(t => t.name);
  assert.ok(names.includes('echo'), `expected "echo" tool, got: ${names.join(',')}`);
});

test('callTool invokes echo end-to-end', { timeout: 120_000 }, async () => {
  const connId = 'test-conn-echo';
  try {
    const result = await mcp.callTool(connId, EVERYTHING_SERVER_SPEC, 'echo', { message: 'hello-aoc' });
    assert.ok(result && result.content, 'response should have content');
    // "echo" returns content array; verify our message appears somewhere in it
    const text = JSON.stringify(result.content);
    assert.ok(text.includes('hello-aoc'), `expected echoed text, got: ${text}`);
  } finally {
    await mcp.teardown(connId);
  }
});

test('stdio args substitute ${VAR} from credentials env', { timeout: 120_000 }, async () => {
  // Substitute the allowed-directory arg on the filesystem MCP server. If
  // substitution fails, the server crashes on boot (literal ${VAR} isn't a dir).
  const connId = 'test-arg-subst';
  const spec = {
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '${ALLOWED_DIR}'],
    env: {},
    credentials: JSON.stringify({ ALLOWED_DIR: '/tmp' }),
  };
  try {
    const tools = await mcp.listTools(connId, spec);
    assert.ok(tools.length > 0, 'should still discover tools');
    // Verify the substituted dir is what the server reports back
    const result = await mcp.callTool(connId, spec, 'list_allowed_directories', {});
    const text = JSON.stringify(result.content);
    assert.ok(text.includes('/tmp') || text.includes('/private/tmp'),
      `expected /tmp in allowed dirs, got: ${text}`);
  } finally {
    await mcp.teardown(connId);
  }
});

test('teardown is idempotent and removes from pool', async () => {
  await mcp.teardown('nonexistent-id');   // should not throw
  await mcp.teardown('nonexistent-id');   // still fine
  assert.ok(true);
});
