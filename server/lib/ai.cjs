'use strict';
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { OPENCLAW_HOME, OPENCLAW_WORKSPACE, readJsonSafe } = require('./config.cjs');

const CLAUDE_BIN = process.env.CLAUDE_BIN || '/opt/homebrew/bin/claude';

const FILE_CONTEXTS = {
  'IDENTITY.md':  'Agent identity file — defines name, emoji, vibe/theme, and role. Uses markdown bullet list format: `- **Field:** Value`.',
  'SOUL.md':      'Agent soul/personality — core traits, communication style, behavioral guidelines. First-person voice.',
  'AGENTS.md':    'Agent workspace instructions — session startup ritual, memory management, safety rules, coordination patterns.',
  'TOOLS.md':     'Available tools and integrations. Structured documentation of what tools the agent can use and how.',
  'USER.md':      'User context — user preferences, ongoing projects, background info the agent should know about the human.',
  'MEMORY.md':    'Long-term curated memory — significant events, lessons learned, decisions, context that persists across sessions.',
  'HEARTBEAT.md': 'Periodic task checklist executed on every gateway heartbeat poll. Keep it minimal — one task per line.',
  'BOOTSTRAP.md': 'One-time first-run setup ritual. Agent follows this then deletes the file. Must be specific and actionable.',
  'SKILL.md':     'Skill definition file. MUST start with YAML frontmatter (---\\nname: slug\\ndescription: when to use this\\n---) followed by markdown instructions telling the agent exactly when and how to use the skill.',
  'script':       'Executable script providing a tool capability. Include shebang line, clear comments, error handling.',
};

// ── OS / Environment context ──────────────────────────────────────────────────

let _osCtx = null;

function getOsContext() {
  if (_osCtx) return _osCtx;

  const RUNTIME_BINS = ['node', 'python3', 'python', 'bash', 'zsh', 'fish', 'ruby', 'lua', 'ts-node', 'deno', 'bun'];
  const runtimes = {};
  for (const bin of RUNTIME_BINS) {
    try {
      const which = execSync(`which ${bin} 2>/dev/null`, { encoding: 'utf8', timeout: 2000 }).trim();
      if (!which) continue;
      let version = '';
      try { version = execSync(`${bin} --version 2>&1 | head -1`, { encoding: 'utf8', timeout: 2000 }).trim(); } catch {}
      runtimes[bin] = { path: which, version };
    } catch {}
  }

  const config = readJsonSafe(path.join(OPENCLAW_HOME, 'openclaw.json')) || {};
  const agentCount = (config.agents?.list || []).length;
  const skillCount = Object.keys(config.skills?.entries || {}).length;

  _osCtx = {
    platform: os.platform(),
    arch: os.arch(),
    osRelease: os.release(),
    homeDir: os.homedir(),
    shell: process.env.SHELL || '/bin/sh',
    runtimes,
    openclaw: {
      home: OPENCLAW_HOME,
      workspace: OPENCLAW_WORKSPACE,
      agentCount,
      skillCount,
    },
  };
  return _osCtx;
}

function formatOsContext(ctx) {
  const rtLines = Object.entries(ctx.runtimes)
    .map(([k, v]) => `  - ${k}: ${v.version} (${v.path})`)
    .join('\n');

  return [
    `## Environment`,
    `- OS: ${ctx.platform} ${ctx.arch} (${ctx.osRelease})`,
    `- Shell: ${ctx.shell}`,
    `- Home: ${ctx.homeDir}`,
    `- OpenClaw home: ${ctx.openclaw.home}`,
    `- OpenClaw workspace: ${ctx.openclaw.workspace}`,
    `- Agents: ${ctx.openclaw.agentCount} | Skills: ${ctx.openclaw.skillCount}`,
    ``,
    `## Available runtimes on this machine`,
    rtLines || '  (none detected)',
  ].join('\n');
}

// ── Filesystem context reader ─────────────────────────────────────────────────

function readFileSafe(filePath) {
  try { return fs.readFileSync(filePath, 'utf-8'); } catch { return null; }
}

/**
 * Read filesystem context relevant to script/tool generation.
 * Returns a formatted string to inject into the prompt.
 */
function getScriptFilesystemContext(agentId) {
  const lines = [];
  const config = readJsonSafe(path.join(OPENCLAW_HOME, 'openclaw.json')) || {};
  const agentList = config.agents?.list || [];
  const agentConfig = agentList.find(a => a.id === agentId);
  const agentWorkspace = agentConfig?.workspace
    ? agentConfig.workspace.replace(/^~/, os.homedir())
    : null;

  // ── Shared scripts (~/.openclaw/scripts/) ────────────────────────────────
  const sharedScriptsDir = path.join(OPENCLAW_HOME, 'scripts');
  const sharedMeta = readJsonSafe(path.join(sharedScriptsDir, '.tools.json')) || {};
  const sharedScripts = [];
  try {
    const entries = fs.readdirSync(sharedScriptsDir).filter(f => !f.startsWith('.'));
    for (const name of entries) {
      const meta = sharedMeta[name] || {};
      sharedScripts.push(`  - ${name}${meta.description ? ': ' + meta.description : ''}`);
    }
  } catch {}
  if (sharedScripts.length) {
    lines.push('## Existing shared scripts (~/.openclaw/scripts/)');
    lines.push(...sharedScripts);
    lines.push('');
  }

  // ── Agent workspace scripts ───────────────────────────────────────────────
  if (agentWorkspace) {
    const agentScriptsDir = path.join(agentWorkspace, 'scripts');
    const agentMeta = readJsonSafe(path.join(agentScriptsDir, '.tools.json')) || {};
    const agentScripts = [];
    try {
      const entries = fs.readdirSync(agentScriptsDir).filter(f => !f.startsWith('.'));
      for (const name of entries) {
        const meta = agentMeta[name] || {};
        agentScripts.push(`  - ${name}${meta.description ? ': ' + meta.description : ''}`);
      }
    } catch {}
    if (agentScripts.length) {
      lines.push(`## Existing agent scripts (${agentWorkspace}/scripts/)`);
      lines.push(...agentScripts);
      lines.push('');
    }

    // ── Agent TOOLS.md ─────────────────────────────────────────────────────
    const toolsMd = readFileSafe(path.join(agentWorkspace, 'TOOLS.md'));
    if (toolsMd) {
      lines.push('## Agent TOOLS.md (current tool documentation)');
      lines.push(toolsMd.slice(0, 1500) + (toolsMd.length > 1500 ? '\n...(truncated)' : ''));
      lines.push('');
    }
  }

  // ── Common tool paths ─────────────────────────────────────────────────────
  const commonTools = ['psql', 'mysql', 'redis-cli', 'jq', 'curl', 'wget', 'git', 'docker', 'kubectl', 'ffmpeg', 'convert', 'aws', 'gcloud'];
  const foundTools = [];
  for (const tool of commonTools) {
    try {
      const p = execSync(`which ${tool} 2>/dev/null`, { encoding: 'utf8', timeout: 1000 }).trim();
      if (p) foundTools.push(`  - ${tool}: ${p}`);
    } catch {}
  }
  if (foundTools.length) {
    lines.push('## Common tools available on PATH');
    lines.push(...foundTools);
    lines.push('');
  }

  return lines.join('\n');
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildPrompt({ prompt, currentContent, fileType, agentName, agentId, extraContext, includeOsContext }) {
  const fileCtx = FILE_CONTEXTS[fileType] || `Configuration file of type: ${fileType}`;
  const osCtx = includeOsContext !== false ? formatOsContext(getOsContext()) : '';

  const isScript = fileType === 'script' || ![
    'IDENTITY.md','SOUL.md','AGENTS.md','TOOLS.md','USER.md',
    'MEMORY.md','HEARTBEAT.md','BOOTSTRAP.md','SKILL.md',
  ].includes(fileType);

  const scriptHints = isScript ? [
    ``,
    `## Script conventions`,
    `- Always start with a proper shebang line matching the runtime`,
    `- Use set -euo pipefail for bash scripts`,
    `- Handle errors explicitly — don't silently fail`,
    `- Read arguments via $1 $2 or argparse — scripts may be called by agents`,
    `- Output plain text or JSON to stdout; errors to stderr`,
    `- Scripts live at ${OPENCLAW_HOME}/scripts/ or agent workspace/scripts/`,
  ].join('\n') : '';

  // Inject filesystem context for script generation
  const fsCtx = isScript ? getScriptFilesystemContext(agentId) : '';

  const skillHints = fileType === 'SKILL.md' ? [
    ``,
    `## SKILL.md structure (MANDATORY)`,
    '```',
    '---',
    'name: skill-name-in-kebab-case',
    'description: "WAJIB DIGUNAKAN: <specific trigger condition in imperative>" (be precise about WHEN to activate)',
    '---',
    '',
    '# Skill Title',
    '',
    'Context and purpose.',
    '',
    '## Instructions',
    '',
    'Step by step what the agent MUST do.',
    '```',
    `- The description field is injected into the agent context verbatim — make it a clear trigger instruction`,
    `- The body tells the agent exactly what to do when the skill activates`,
  ].join('\n') : '';

  return [
    `You are an expert at configuring OpenClaw AI agents on this machine.`,
    `You write and improve agent configuration files and executable scripts.`,
    ``,
    `File type: ${fileType}`,
    `File purpose: ${fileCtx}`,
    agentName    ? `Agent name: ${agentName}` : '',
    agentId      ? `Agent ID: ${agentId}` : '',
    extraContext ? `Context: ${extraContext}` : '',
    osCtx,
    fsCtx,
    scriptHints,
    skillHints,
    ``,
    `OUTPUT RULES:`,
    `- Output ONLY the raw file content — no explanations, no markdown code fences, no commentary`,
    `- Use actual runtimes available on this machine (from the list above) in shebang lines`,
    `- Be specific and practical, not generic`,
    `- If current content is provided, modify/improve it per the instruction; if empty, generate from scratch`,
    ``,
    currentContent?.trim()
      ? `Current content:\n\`\`\`\n${currentContent}\n\`\`\`\n\nInstruction: ${prompt}`
      : `Instruction: ${prompt}`,
  ].filter(Boolean).join('\n');
}

// ── Generation ────────────────────────────────────────────────────────────────
// Uses --output-format text (no --verbose) to avoid loading MCP servers.
// Yields the full result as one chunk; SSE "done" is sent after.

async function* generateStream(params, signal) {
  const model = process.env.AI_ASSIST_MODEL || 'haiku';
  const fullPrompt = buildPrompt(params);

  // --output-format text: plain stdout, no --verbose needed → fast startup, no MCP loading
  const args = [
    '--print', fullPrompt,
    '--output-format', 'text',
    '--no-session-persistence',
    '--model', model,
  ];

  const proc = spawn(CLAUDE_BIN, args, {
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (signal) {
    const kill = () => proc.kill('SIGTERM');
    signal.addEventListener('abort', kill, { once: true });
  }

  let stdout = '';
  let stderrOut = '';

  proc.stderr.on('data', (d) => { stderrOut += d.toString(); });

  for await (const chunk of proc.stdout) {
    if (signal?.aborted) break;
    stdout += chunk.toString();
  }

  await new Promise(resolve => proc.on('close', resolve));

  if (proc.exitCode !== 0 && !signal?.aborted) {
    throw new Error(stderrOut.trim() || `Claude CLI exited with code ${proc.exitCode}`);
  }

  const result = stdout.trim();
  if (result) yield result;
}

module.exports = { generateStream, getOsContext, FILE_CONTEXTS };
