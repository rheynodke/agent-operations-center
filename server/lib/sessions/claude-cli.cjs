'use strict';
/**
 * server/lib/sessions/claude-cli.cjs
 *
 * Parses Claude CLI session JSONL files at ~/.claude/projects/<workspace-slug>/<uuid>.jsonl.
 * When an OpenClaw agent uses `claude-cli/*` as its LLM, the gateway delegates the LLM
 * invocation to Claude CLI, and the transcript is written there — NOT in the gateway's
 * per-agent sessions directory. This module bridges that gap.
 *
 * Public API:
 *   parseClaudeCliSessions()
 *     → Session[] — one entry per claude-cli jsonl, enriched with agent metadata.
 *   parseClaudeCliSessionEvents(id)
 *     → SessionEvent[] — accepts either a claude-cli UUID or a gateway sessionId that
 *     maps to a claude-cli file.
 *   parseSingleClaudeCliEntry(jsonLine, defaults)
 *     → SessionEvent | null — used by the live-feed watcher.
 *   workspaceToSlug(path)
 *     → Claude CLI's dir slug (replace `/` and `.` with `-`).
 *   buildAgentClaudeCliMap()
 *     → { agentId → { slug, projectDir, workspace } } for all configured agents.
 *   findClaudeCliFileForGatewaySession(gatewayMeta, agentId)
 *     → absolute path | null — best-effort mtime match for linking.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { AGENTS_DIR, OPENCLAW_HOME, OPENCLAW_WORKSPACE, readJsonSafe } = require('../config.cjs');
const { parseAgentRegistry } = require('./opencode.cjs');
// Reuse gateway's metadata strippers — user messages delivered to claude-cli include
// the same "Conversation info"/"Sender" metadata blocks as gateway sessions (gateway
// composes them once before dispatching to either CLI or its own transport).
const { cleanUserMessage, extractSender, extractMediaFiles, parseTextToolCalls } = require('./gateway.cjs');

const CLAUDE_HOME         = path.join(os.homedir(), '.claude');
const CLAUDE_PROJECTS_DIR = path.join(CLAUDE_HOME, 'projects');

// Link window: gateway session counts as linked to a claude-cli jsonl if its
// updatedAt is within this many ms of the jsonl's mtime. Generous on purpose —
// gateway's sessions.json updatedAt and Claude CLI's jsonl mtime can drift by a
// couple of minutes during a long turn.
const LINK_WINDOW_MS = 5 * 60_000;

/**
 * Convert a workspace path → Claude CLI's project directory slug.
 * Claude CLI replaces both `/` and `.` with `-`.
 *   /Users/itdke/.openclaw/workspace → -Users-itdke--openclaw-workspace
 */
function workspaceToSlug(workspacePath) {
  if (!workspacePath) return '';
  return workspacePath.replace(/[/.]/g, '-');
}

/**
 * Build a map of { agentId → { slug, projectDir, workspace } } from openclaw.json.
 * Agents without an explicit `workspace` fall back to the default workspace.
 */
function buildAgentClaudeCliMap() {
  const configPath = path.join(OPENCLAW_HOME, 'openclaw.json');
  const config = readJsonSafe(configPath);
  if (!config) return {};

  const list = config.agents?.list || [];
  const defaultWorkspace = config.agents?.defaults?.workspace || OPENCLAW_WORKSPACE;
  const map = {};

  for (const a of list) {
    if (!a?.id) continue;
    const workspace = a.workspace || defaultWorkspace;
    const slug = workspaceToSlug(workspace);
    map[a.id] = {
      slug,
      projectDir: path.join(CLAUDE_PROJECTS_DIR, slug),
      workspace,
    };
  }
  return map;
}

/**
 * Reverse lookup: given a claude-cli project slug, return the agentId(s) whose workspace
 * maps to it. Usually exactly one, but a sub-agent sharing workspace returns the first.
 */
function agentIdForSlug(slug, agentMap) {
  agentMap = agentMap || buildAgentClaudeCliMap();
  for (const [agentId, info] of Object.entries(agentMap)) {
    if (info.slug === slug) return agentId;
  }
  return null;
}

/**
 * Return a flat list of { agentId, slug, projectDir, file, fullPath, sessionId, stat }
 * for every claude-cli jsonl across all configured agents.
 */
function listAllClaudeCliFiles() {
  const agentMap = buildAgentClaudeCliMap();
  const results = [];

  for (const [agentId, info] of Object.entries(agentMap)) {
    if (!fs.existsSync(info.projectDir)) continue;
    let files;
    try { files = fs.readdirSync(info.projectDir); }
    catch { continue; }

    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const fullPath = path.join(info.projectDir, file);
      let stat = null;
      try { stat = fs.statSync(fullPath); } catch { continue; }
      results.push({
        agentId,
        slug: info.slug,
        projectDir: info.projectDir,
        file,
        fullPath,
        sessionId: file.replace(/\.jsonl$/, ''),
        stat,
      });
    }
  }
  return results;
}

/**
 * Convert one claude-cli JSONL entry to a SessionEvent matching the gateway parser shape.
 * Returns null for entries that don't represent a message (queue-operation, attachment, ai-title, etc.)
 * or unparseable lines.
 */
function parseSingleClaudeCliEntry(jsonLine, defaults = {}) {
  try {
    const entry = typeof jsonLine === 'string' ? JSON.parse(jsonLine) : jsonLine;
    if (!entry || typeof entry !== 'object') return null;

    const defaultModel = defaults.defaultModel || '';
    const kind = entry.type;

    // Skip non-message entries
    if (!['user', 'assistant'].includes(kind)) return null;
    const msg = entry.message;
    if (!msg) return null;

    const tsIso = entry.timestamp || null;

    let role = msg.role || kind;
    let text = '';
    let thinking = '';
    const tools = [];
    let isErrorFlag = false;

    // Case 1: string content → plain text (user message)
    if (typeof msg.content === 'string') {
      text = msg.content;
    }
    // Case 2: array content — iterate parts
    else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (!part || typeof part !== 'object') continue;
        switch (part.type) {
          case 'text': {
            // Handle text-encoded tool call markers the same way the gateway parser does.
            const raw = part.text || '';
            const { cleanText, toolCalls } = parseTextToolCalls(raw);
            text += cleanText;
            tools.push(...toolCalls);
            break;
          }
          case 'thinking':
            thinking = part.thinking || thinking;
            break;
          case 'tool_use':
            tools.push({
              name: part.name || 'unknown',
              input: (() => {
                try { return JSON.stringify(part.input || {}, null, 2); }
                catch { return String(part.input || ''); }
              })(),
              toolCallId: part.id || null,
            });
            break;
          case 'tool_result':
            // Claude CLI wraps tool_result inside a user-role message
            role = 'toolResult';
            if (part.is_error) isErrorFlag = true;
            {
              let output = '';
              const c = part.content;
              if (typeof c === 'string') output = c;
              else if (Array.isArray(c)) {
                output = c.map(p => {
                  if (typeof p === 'string') return p;
                  if (p && p.type === 'text') return p.text || '';
                  try { return JSON.stringify(p, null, 2); } catch { return ''; }
                }).join('\n');
              } else {
                try { output = JSON.stringify(c || '', null, 2); } catch { output = ''; }
              }
              tools.push({
                name: 'result',
                output,
                toolCallId: part.tool_use_id || null,
              });
            }
            break;
          default:
            // Ignore unknown part types
            break;
        }
      }
    }

    // Normalise model string
    let modelStr = '';
    if (typeof msg.model === 'string') modelStr = msg.model;
    else if (msg.model && typeof msg.model === 'object') {
      modelStr = msg.model.name || msg.model.id || '';
    }
    if (!modelStr && role === 'assistant') modelStr = defaultModel;

    // Normalise token usage (Claude CLI uses snake_case)
    let tokens = null;
    if (msg.usage && typeof msg.usage === 'object') {
      tokens = {
        input: msg.usage.input_tokens || msg.usage.input || 0,
        output: msg.usage.output_tokens || msg.usage.output || 0,
        cacheRead: msg.usage.cache_read_input_tokens || msg.usage.cacheRead || 0,
        cacheWrite: msg.usage.cache_creation_input_tokens || msg.usage.cacheWrite || 0,
        total:
          (msg.usage.input_tokens || 0) +
          (msg.usage.output_tokens || 0) +
          (msg.usage.cache_read_input_tokens || 0) +
          (msg.usage.cache_creation_input_tokens || 0),
      };
    }

    // Strip gateway-injected metadata envelopes ("Conversation info"/"Sender" JSON
     // blocks + bracketed timestamp prefix) before exposing to UI. Only user-role
     // turns carry those envelopes; assistant/toolResult passes through unchanged.
    const cleanedText = cleanUserMessage(text, role);
    const sender      = extractSender(text, role);
    const mediaFiles  = extractMediaFiles(text);

    return {
      id: entry.uuid || entry.id || null,
      role,
      text: cleanedText,
      sender,
      mediaFiles,
      thinking,
      tools,
      model: modelStr,
      cost: 0, // Claude CLI doesn't record cost inline
      tokens,
      timestamp: tsIso,
      stopReason: msg.stop_reason || null,
      isError: isErrorFlag,
    };
  } catch {
    return null;
  }
}

/**
 * Parse the full jsonl for a claude-cli session.
 * Accepts either the claude-cli UUID directly, or a file path.
 */
function parseClaudeCliSessionEventsByFile(fullPath, opts = {}) {
  if (!fullPath || !fs.existsSync(fullPath)) return [];
  const limit = opts.limit || 500;
  const defaultModel = opts.defaultModel || '';

  let content;
  try { content = fs.readFileSync(fullPath, 'utf-8'); }
  catch { return []; }

  const lines = content.trim().split('\n').filter(Boolean);
  const events = [];
  for (const line of lines.slice(-limit)) {
    const evt = parseSingleClaudeCliEntry(line, { defaultModel });
    if (evt) events.push(evt);
  }
  return events;
}

/**
 * Find a claude-cli jsonl file by session ID (UUID).
 * Searches every configured agent's project dir.
 */
function findClaudeCliFileBySessionId(sessionId) {
  if (!sessionId) return null;
  const agentMap = buildAgentClaudeCliMap();
  for (const [agentId, info] of Object.entries(agentMap)) {
    const candidate = path.join(info.projectDir, `${sessionId}.jsonl`);
    if (fs.existsSync(candidate)) return { agentId, fullPath: candidate };
  }
  return null;
}

/**
 * Given a gateway session meta object ({ sessionId, updatedAt }) and an agentId,
 * find the claude-cli jsonl file most likely to contain its transcript.
 * Heuristic: the file whose mtime is closest to the gateway session's updatedAt,
 * within LINK_WINDOW_MS. Returns null if no file qualifies.
 */
function findClaudeCliFileForGatewaySession(gatewayMeta, agentId) {
  if (!gatewayMeta || !agentId) return null;
  const agentMap = buildAgentClaudeCliMap();
  const info = agentMap[agentId];
  if (!info || !fs.existsSync(info.projectDir)) return null;

  const target = gatewayMeta.updatedAt || 0;
  if (!target) return null;

  let best = null;
  let bestDelta = Infinity;
  try {
    const files = fs.readdirSync(info.projectDir).filter(f => f.endsWith('.jsonl'));
    for (const file of files) {
      const full = path.join(info.projectDir, file);
      let stat; try { stat = fs.statSync(full); } catch { continue; }
      const mtime = stat.mtimeMs;
      const delta = Math.abs(mtime - target);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = { fullPath: full, sessionId: file.replace(/\.jsonl$/, ''), mtime, size: stat.size };
      }
    }
  } catch { return null; }

  if (best && bestDelta <= LINK_WINDOW_MS) return best;
  return null;
}

/**
 * Accepts either a claude-cli UUID, or a gateway sessionId whose transcript was delegated
 * to claude-cli. Returns the events for the matched jsonl, or [].
 */
function parseClaudeCliSessionEvents(sessionOrGatewayId, opts = {}) {
  if (!sessionOrGatewayId) return [];

  // Try direct lookup first (assumes the ID is a claude-cli UUID)
  const direct = findClaudeCliFileBySessionId(sessionOrGatewayId);
  if (direct) {
    const agents = parseAgentRegistry();
    const agentInfo = agents.find(a => a.id === direct.agentId);
    return parseClaudeCliSessionEventsByFile(direct.fullPath, {
      ...opts,
      defaultModel: agentInfo?.model || '',
    });
  }

  // Fallback: treat ID as a gateway sessionId and look up the linked claude-cli file
  const linked = findClaudeCliForGatewaySessionId(sessionOrGatewayId);
  if (linked) {
    const agents = parseAgentRegistry();
    const agentInfo = agents.find(a => a.id === linked.agentId);
    return parseClaudeCliSessionEventsByFile(linked.fullPath, {
      ...opts,
      defaultModel: agentInfo?.model || '',
    });
  }

  return [];
}

/**
 * Look up { agentId, fullPath } for the claude-cli jsonl linked to a given gateway sessionId.
 * Scans every agent's sessions.json to find the gateway session, then does an mtime match.
 */
function findClaudeCliForGatewaySessionId(gatewaySessionId) {
  if (!gatewaySessionId || !fs.existsSync(AGENTS_DIR)) return null;
  let agentDirs;
  try {
    agentDirs = fs.readdirSync(AGENTS_DIR).filter(d => {
      try { return fs.statSync(path.join(AGENTS_DIR, d)).isDirectory(); }
      catch { return false; }
    });
  } catch { return null; }

  for (const agentId of agentDirs) {
    const sessionsFile = path.join(AGENTS_DIR, agentId, 'sessions', 'sessions.json');
    const data = readJsonSafe(sessionsFile);
    if (!data || typeof data !== 'object') continue;

    for (const [, meta] of Object.entries(data)) {
      if (meta?.sessionId !== gatewaySessionId) continue;
      const match = findClaudeCliFileForGatewaySession(meta, agentId);
      if (match) return { agentId, ...match };
    }
  }
  return null;
}

/**
 * Scan claude-cli jsonl files for all agents and produce Session objects shaped like
 * parseGatewaySessions() output so they can be merged by the sessions barrel.
 *
 * Each entry is marked with `source: 'claude-cli'`. If the session is linked to a
 * gateway session, `linkedGatewaySessionId` is populated and the merge step in
 * the barrel will skip or augment it.
 */
function parseClaudeCliSessions() {
  const files = listAllClaudeCliFiles();
  if (!files.length) return [];

  const agents = parseAgentRegistry();
  const agentMap = {};
  for (const a of agents) agentMap[a.id] = a;

  // Pre-index all gateway sessions.json entries per agent for linking.
  const gatewaySessionsByAgent = {};
  for (const agentId of Object.keys(agentMap)) {
    const sessionsFile = path.join(AGENTS_DIR, agentId, 'sessions', 'sessions.json');
    const data = readJsonSafe(sessionsFile);
    if (data && typeof data === 'object') {
      gatewaySessionsByAgent[agentId] = Object.entries(data).map(([key, meta]) => ({
        key,
        sessionId: meta?.sessionId,
        updatedAt: meta?.updatedAt || 0,
        origin: meta?.origin || {},
        label: meta?.label || '',
      }));
    } else {
      gatewaySessionsByAgent[agentId] = [];
    }
  }

  const sessions = [];

  for (const f of files) {
    const agentInfo = agentMap[f.agentId];
    if (!agentInfo) continue;

    // Try linking by mtime proximity within LINK_WINDOW_MS.
    const pool = gatewaySessionsByAgent[f.agentId] || [];
    let best = null;
    let bestDelta = Infinity;
    for (const gw of pool) {
      if (!gw.updatedAt) continue;
      const delta = Math.abs(gw.updatedAt - f.stat.mtimeMs);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = gw;
      }
    }
    const linked = best && bestDelta <= LINK_WINDOW_MS ? best : null;

    // Parse basic stats by scanning the file (lightweight — only tallies)
    let messageCount = 0, toolCalls = 0, tokensIn = 0, tokensOut = 0;
    let lastMessage = '', lastRole = '';
    let lastTimestamp = f.stat.mtimeMs;

    try {
      const content = fs.readFileSync(f.fullPath, 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      for (const line of lines) {
        let entry;
        try { entry = JSON.parse(line); } catch { continue; }
        if (!['user', 'assistant'].includes(entry.type)) continue;
        const msg = entry.message;
        if (!msg) continue;
        messageCount++;
        lastRole = msg.role || entry.type;

        if (msg.usage) {
          tokensIn  += (msg.usage.input_tokens || 0);
          tokensOut += (msg.usage.output_tokens || 0);
        }
        if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part?.type === 'tool_use') toolCalls++;
            if (part?.type === 'text' && part.text) {
              // Assistant text is already clean; run through cleanUserMessage only when role=user
              lastMessage = String(cleanUserMessage(part.text, msg.role)).slice(0, 200);
            }
          }
        } else if (typeof msg.content === 'string') {
          // User-role string content carries the gateway metadata envelope — strip it.
          lastMessage = String(cleanUserMessage(msg.content, msg.role)).slice(0, 200);
        }

        if (entry.timestamp) {
          const ts = new Date(entry.timestamp).getTime();
          if (ts > lastTimestamp) lastTimestamp = ts;
        }
      }
    } catch {}

    const displayAgentName = (() => {
      const n = agentInfo?.name || f.agentId;
      return n ? n.charAt(0).toUpperCase() + n.slice(1) : f.agentId;
    })();

    let sessionType = 'claude-cli';
    let sessionSubtype = '';
    let channelId = '';
    let name = 'Claude CLI session';
    let linkedKey = null;

    if (linked) {
      const parts = String(linked.key || '').split(':');
      sessionType    = parts[2] || sessionType;
      sessionSubtype = parts[3] || '';
      channelId      = parts[4] || '';
      if (linked.label) name = linked.label;
      else if (sessionType === 'telegram') name = `Telegram ${sessionSubtype}`;
      else if (sessionType === 'cron') name = `Cron job`;
      else if (sessionType === 'hook') name = `Hook ${sessionSubtype || f.sessionId.slice(0, 8)}`;
      else if (sessionType === 'main') name = `${displayAgentName} (direct)`;
      linkedKey = linked.key;
    }

    const now = Date.now();
    const isActive = (now - f.stat.mtimeMs) < 10_000; // file written within last 10s

    sessions.push({
      id: f.sessionId,
      key: linkedKey || `agent:${f.agentId}:claude-cli:${f.sessionId}`,
      name,
      agent: f.agentId,
      agentName: displayAgentName,
      agentEmoji: agentInfo?.emoji || (f.agentId === 'main' ? '✨' : '🤖'),
      model: agentInfo?.model || '',
      type: sessionType,
      subtype: sessionSubtype,
      channelId,
      messageCount,
      toolCalls,
      tokensIn,
      tokensOut,
      cost: 0,
      lastMessage: lastMessage.replace(/\n/g, ' ').trim(),
      lastRole,
      updatedAt: lastTimestamp,
      hasLog: true,
      fileSize: f.stat.size,
      status: isActive ? 'active' : 'idle',
      source: 'claude-cli',
      linkedGatewaySessionId: linked?.sessionId || null,
      claudeCliSessionId: f.sessionId,
    });
  }

  return sessions;
}

module.exports = {
  CLAUDE_HOME,
  CLAUDE_PROJECTS_DIR,
  LINK_WINDOW_MS,
  workspaceToSlug,
  buildAgentClaudeCliMap,
  agentIdForSlug,
  listAllClaudeCliFiles,
  parseSingleClaudeCliEntry,
  parseClaudeCliSessionEventsByFile,
  parseClaudeCliSessionEvents,
  findClaudeCliFileBySessionId,
  findClaudeCliFileForGatewaySession,
  findClaudeCliForGatewaySessionId,
  parseClaudeCliSessions,
};
