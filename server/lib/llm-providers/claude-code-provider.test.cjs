'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const Module = require('node:module');

// Stub child_process.spawn before requiring provider
const spawnCalls = [];
let nextSpawnBehavior = null; // { stdout: string, stderr: string, exitCode: number, delayMs?: number }

const origLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'child_process' || request === 'node:child_process') {
    return {
      spawn(cmd, args, opts) {
        spawnCalls.push({ cmd, args, opts });
        const child = new EventEmitter();
        child.stdin = { write() {}, end() {} };
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => { child.emit('close', 137); };
        const b = nextSpawnBehavior || { stdout: '{}', stderr: '', exitCode: 0 };
        setImmediate(() => {
          if (b.stdout) child.stdout.emit('data', Buffer.from(b.stdout));
          if (b.stderr) child.stderr.emit('data', Buffer.from(b.stderr));
          setTimeout(() => child.emit('close', b.exitCode), b.delayMs ?? 1);
        });
        return child;
      }
    };
  }
  return origLoad.apply(this, arguments);
};

const provider = require('./claude-code-provider.cjs');

test('claude-code provider parses CLI JSON output and returns CompleteResponse', async () => {
  spawnCalls.length = 0;
  nextSpawnBehavior = {
    stdout: JSON.stringify({
      type: 'result',
      result: '{"hello":"world"}',
      usage: { input_tokens: 1234, output_tokens: 56 },
      model: 'claude-haiku-4-5',
    }),
    stderr: '', exitCode: 0,
  };

  const r = await provider.complete({ prompt: 'test', model: 'claude-haiku-4-5', responseFormat: 'json' });
  assert.equal(r.text, '{"hello":"world"}');
  assert.equal(r.inputTokens, 1234);
  assert.equal(r.outputTokens, 56);
  assert.equal(r.modelUsed, 'claude-haiku-4-5');
  assert.ok(typeof r.providerLatencyMs === 'number');

  // Args sanity
  const call = spawnCalls[0];
  assert.ok(call.args.includes('-p'));
  assert.ok(call.args.includes('--output-format'));
  assert.ok(call.args.includes('json'));
  assert.ok(call.args.includes('--model'));
  assert.ok(call.args.includes('claude-haiku-4-5'));
});

test('claude-code provider rejects on non-zero exit', async () => {
  nextSpawnBehavior = { stdout: '', stderr: 'bad', exitCode: 1 };
  await assert.rejects(
    provider.complete({ prompt: 'test', model: 'claude-haiku-4-5' }),
    /exit code 1/
  );
});

test('claude-code provider times out after timeoutMs', async () => {
  nextSpawnBehavior = { stdout: '', stderr: '', exitCode: 0, delayMs: 5000 };
  await assert.rejects(
    provider.complete({ prompt: 'test', model: 'claude-haiku-4-5', timeoutMs: 50 }),
    /timeout/i
  );
});

test('claude-code provider rejects on malformed JSON', async () => {
  nextSpawnBehavior = { stdout: 'not json at all', stderr: '', exitCode: 0 };
  await assert.rejects(
    provider.complete({ prompt: 'test', model: 'claude-haiku-4-5' }),
    /JSON/
  );
});

test('provider registry returns claude-code by name', async () => {
  const registry = require('./index.cjs');
  const p = registry.getProvider('claude-code');
  assert.equal(p.name, 'claude-code');
  assert.equal(typeof p.complete, 'function');
});

test('provider registry throws on unknown provider', () => {
  const registry = require('./index.cjs');
  assert.throws(() => registry.getProvider('does-not-exist'), /unknown LLM provider/);
});
