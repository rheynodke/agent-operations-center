'use strict';

/**
 * Claude Code CLI subprocess provider.
 *
 * Spawns `claude -p --output-format json --model <model>` with prompt on stdin.
 * Used by reflection-service for satisfaction self-learning. Cost is $0
 * marginal on Max subscription; falls back to API if user has no subscription
 * (handled by the CLI itself, not us).
 *
 * CLI output schema (--output-format json):
 *   { type: "result", result: "<text>", usage: { input_tokens, output_tokens }, model: "..." }
 *
 * See spec §5.5.
 */

const { spawn } = require('child_process');

const CLAUDE_BIN = process.env.CLAUDE_BIN || '/opt/homebrew/bin/claude';
const DEFAULT_MODEL = 'claude-haiku-4-5';
const DEFAULT_TIMEOUT_MS = 60_000;

async function complete({
  prompt,
  model = DEFAULT_MODEL,
  maxTokens,
  responseFormat = 'text',  // accepted but Claude CLI handles via prompt
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal,
}) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('claude-code provider: prompt must be a non-empty string');
  }

  const args = ['-p', '--output-format', 'json', '--model', model];
  if (maxTokens) args.push('--max-tokens', String(maxTokens));

  const startTime = Date.now();
  return await new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timer = null;
    let settled = false;

    const settle = (fn, val) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener?.('abort', onAbort);
      fn(val);
    };

    const onAbort = () => {
      try { child.kill('SIGTERM'); } catch {}
      settle(reject, new Error('claude-code provider: aborted'));
    };
    if (signal) signal.addEventListener('abort', onAbort);

    timer = setTimeout(() => {
      // Settle FIRST so any sync close emitted by kill() is a no-op.
      settle(reject, new Error(`claude-code provider: timeout after ${timeoutMs}ms`));
      try { child.kill('SIGTERM'); } catch {}
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('error', (err) => settle(reject, err));

    child.on('close', (code) => {
      if (code !== 0) {
        return settle(reject, new Error(`claude-code provider: CLI exit code ${code}: ${stderr.slice(0, 500)}`));
      }
      let parsed;
      try { parsed = JSON.parse(stdout); }
      catch (e) {
        return settle(reject, new Error(`claude-code provider: malformed JSON output: ${e.message}`));
      }
      const result = parsed.result ?? parsed.text ?? '';
      const usage = parsed.usage || {};
      settle(resolve, {
        text: result,
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        modelUsed: parsed.model || model,
        providerLatencyMs: Date.now() - startTime,
      });
    });

    try {
      child.stdin.write(prompt);
      child.stdin.end();
    } catch (e) {
      settle(reject, e);
    }
  });
}

module.exports = {
  name: 'claude-code',
  complete,
  supportsModel: () => true,  // CLI accepts any model alias Anthropic supports
};
