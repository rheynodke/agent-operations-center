'use strict';
const fs   = require('fs');
const path = require('path');
const { OPENCLAW_HOME, OPENCLAW_WORKSPACE, readJsonSafe } = require('../config.cjs');

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

function parseCodeAgentSessions() {
  const filePath = path.join(OPENCLAW_HOME, 'code-agent-sessions.json');
  const data = readJsonSafe(filePath);
  if (!data) return [];

  const sessions = Array.isArray(data) ? data : (data.sessions || []);

  return sessions.map(s => {
    const durationMs = s.completedAt && s.createdAt
      ? new Date(s.completedAt).getTime() - new Date(s.createdAt).getTime()
      : 0;
    const duration = durationMs > 0 ? formatDuration(durationMs) : '';

    return {
      id: s.sessionId || s.harnessSessionId || s.id || '',
      name: s.name || s.prompt?.slice(0, 60) || 'Untitled',
      prompt: s.prompt || '',
      status: s.status || 'unknown',
      agent: s.originAgentId || s.harness || s.agent || 'unknown',
      model: s.model || '',
      cost: s.costUsd || s.cost || 0,
      duration,
      durationMs,
      tokensIn: s.tokensIn || 0,
      tokensOut: s.tokensOut || 0,
      toolsUsed: s.toolsUsed || 0,
      workdir: s.workdir || '',
      origin: s.originChannel || s.originSessionKey || '',
      startedAt: s.createdAt || s.startedAt || null,
      completedAt: s.completedAt || null,
      killReason: s.killReason || null,
      harness: s.harness || null,
    };
  });
}

function parseDevProgress() {
  const dir = path.join(OPENCLAW_WORKSPACE, 'dev-progress');
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(filename => {
      const content = fs.readFileSync(path.join(dir, filename), 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      const events = lines.map(line => {
        const match = line.match(/^- \[(\d{2}:\d{2}:\d{2})\] \*\*(\w+)\*\*:?\s*(.*)/);
        if (!match) return { raw: line };
        return {
          time: match[1],
          type: match[2].toLowerCase(),
          detail: match[3].trim(),
        };
      });

      const firstEvent = events[0];
      const lastEvent = events[events.length - 1];
      const isCompleted = lastEvent?.type === 'completed';
      const isRunning = !isCompleted && events.length > 0;

      return {
        id: filename.replace('.md', ''),
        filename,
        events,
        eventCount: events.length,
        status: isCompleted ? 'completed' : (isRunning ? 'running' : 'unknown'),
        startedAt: firstEvent?.time || null,
        completedAt: isCompleted ? lastEvent?.time : null,
      };
    });
}

function parseOpenCodeEvents(sessionId) {
  const pattern = `/tmp/opencode-events-${sessionId}.jsonl`;
  if (!fs.existsSync(pattern)) return [];

  const content = fs.readFileSync(pattern, 'utf-8');
  return content.trim().split('\n').filter(Boolean).map(line => {
    try {
      const event = JSON.parse(line);
      return {
        type: event.type,
        timestamp: event.timestamp,
        sessionID: event.sessionID,
        tool: event.part?.tool || null,
        toolState: event.part?.state?.status || null,
        callID: event.part?.callID || null,
        text: event.part?.text || null,
        reason: event.part?.reason || null,
        cost: event.part?.cost || null,
        tokens: event.part?.tokens || null,
        input: event.part?.state?.input ? {
          filePath: event.part.state.input.filePath,
          command: event.part.state.input.command,
          description: event.part.state.input.description,
          content: event.part.state.input.content?.slice(0, 200),
        } : null,
        output: event.part?.state?.output ? event.part.state.output.slice(0, 300) : null,
      };
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function parseOpenCodeResult(sessionId) {
  const filePath = `/tmp/opencode-result-${sessionId}.txt`;
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf-8').trim();
}

function parseAgentRegistry() {
  const configPath = path.join(OPENCLAW_HOME, 'openclaw.json');
  const config = readJsonSafe(configPath);
  if (!config) return [];

  const agentList = config.agents?.list || [];
  const defaultModel = config.agents?.defaults?.model?.primary || '';

  let globalEmoji = '';
  let globalName = '';
  const globalIdentityPath = path.join(OPENCLAW_WORKSPACE, 'IDENTITY.md');
  if (fs.existsSync(globalIdentityPath)) {
    try {
      const content = fs.readFileSync(globalIdentityPath, 'utf-8');
      const emojiMatch = content.match(/\*\*Emoji:\*\*\s*(.+)/);
      if (emojiMatch) globalEmoji = emojiMatch[1].trim();
      const nameMatch = content.match(/\*\*Name:\*\*\s*(.+)/);
      if (nameMatch) globalName = nameMatch[1].trim();
    } catch {}
  }

  return agentList.map((a, i) => {
    let modelStr = typeof a.model === 'string' ? a.model :
      (a.model ? `${a.model.provider || ''}/${a.model.name || ''}` : '');
    if (!modelStr) modelStr = defaultModel;

    let emoji = a.identity?.emoji || '';
    if (!emoji) {
      const agentIdentityPath = path.join(require('../config.cjs').AGENTS_DIR, a.id || '', 'IDENTITY.md');
      if (fs.existsSync(agentIdentityPath)) {
        try {
          const content = fs.readFileSync(agentIdentityPath, 'utf-8');
          const match = content.match(/\*\*Emoji:\*\*\s*(.+)/);
          if (match) emoji = match[1].trim();
        } catch {}
      }
    }
    if (!emoji) emoji = (a.id === 'main') ? (globalEmoji || '✨') : '🤖';

    const name = a.name || ((a.id === 'main') ? (globalName || 'Main') : a.id || 'Unknown');

    return {
      id: a.id || a.key || a.name || `agent-${i}`,
      name,
      emoji,
      role: a.id || '',
      model: modelStr,
      workspace: a.workspace || '',
      status: a.default ? 'active' : 'idle',
      instructions: (typeof a.instructions === 'string' ? a.instructions : '').slice(0, 200),
    };
  });
}

function parseCronJobs() {
  const filePath = path.join(OPENCLAW_HOME, 'cron', 'jobs.json');
  const data = readJsonSafe(filePath);
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return data.jobs || [];
}

function parseCommandLog(limit = 50) {
  const filePath = path.join(OPENCLAW_HOME, 'logs', 'commands.log');
  if (!fs.existsSync(filePath)) return [];

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n').filter(Boolean);
  return lines.slice(-limit).reverse().map(line => {
    try { return JSON.parse(line); }
    catch { return { raw: line, timestamp: null }; }
  });
}

function parseSubagentRuns() {
  const filePath = path.join(OPENCLAW_HOME, 'subagents', 'runs.json');
  const data = readJsonSafe(filePath);
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return data.runs || [];
}

function getAvailableOpenCodeSessions() {
  try {
    return fs.readdirSync('/tmp')
      .filter(f => f.startsWith('opencode-events-') && f.endsWith('.jsonl'))
      .map(f => f.replace('opencode-events-', '').replace('.jsonl', ''));
  } catch {
    return [];
  }
}

module.exports = {
  formatDuration,
  parseCodeAgentSessions,
  parseDevProgress,
  parseOpenCodeEvents,
  parseOpenCodeResult,
  parseAgentRegistry,
  parseCronJobs,
  parseCommandLog,
  parseSubagentRuns,
  getAvailableOpenCodeSessions,
};
