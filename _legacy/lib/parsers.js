const fs = require('fs');
const path = require('path');

const OPENCLAW_HOME = process.env.OPENCLAW_HOME || '/root/.openclaw';
const OPENCLAW_WORKSPACE = process.env.OPENCLAW_WORKSPACE || path.join(OPENCLAW_HOME, 'workspace');
const AGENTS_DIR = path.join(OPENCLAW_HOME, 'agents');

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
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

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
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

  return agentList.map((a, i) => {
    const modelStr = typeof a.model === 'string' ? a.model :
      (a.model ? `${a.model.provider || ''}/${a.model.name || ''}` : '');
    return {
      id: a.id || a.key || a.name || `agent-${i}`,
      name: a.name || a.id || 'Unknown',
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
    try {
      return JSON.parse(line);
    } catch {
      return { raw: line, timestamp: null };
    }
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

// --- Gateway Sessions (the REAL data source for ALL agent activity) ---

function parseGatewaySessions() {
  if (!fs.existsSync(AGENTS_DIR)) return [];

  const allSessions = [];

  try {
    const agentDirs = fs.readdirSync(AGENTS_DIR).filter(d => {
      return fs.statSync(path.join(AGENTS_DIR, d)).isDirectory();
    });

    for (const agentId of agentDirs) {
      const sessionsFile = path.join(AGENTS_DIR, agentId, 'sessions', 'sessions.json');
      const sessionsDir = path.join(AGENTS_DIR, agentId, 'sessions');
      const config = readJsonSafe(sessionsFile);
      if (!config || typeof config !== 'object') continue;

      for (const [key, meta] of Object.entries(config)) {
        const sessionId = meta.sessionId;
        if (!sessionId) continue;

        const jsonlFile = path.join(sessionsDir, `${sessionId}.jsonl`);
        const hasLog = fs.existsSync(jsonlFile);
        let stat = null;
        if (hasLog) {
          try { stat = fs.statSync(jsonlFile); } catch {}
        }

        // Parse session key for type info
        // Format: agent:main:telegram:direct:577142951
        const parts = key.split(':');
        const sessionType = parts[2] || 'unknown'; // telegram, cron, hook
        const sessionSubtype = parts[3] || '';       // direct, slash, run
        const channelId = parts[4] || '';

        // Read last few messages for summary
        let lastMessage = '';
        let lastRole = '';
        let lastTimestamp = meta.updatedAt || 0;
        let messageCount = 0;
        let totalCost = 0;
        let toolCalls = 0;

        if (hasLog) {
          try {
            const fileSize = stat?.size || 0;

            // For message count: count newlines efficiently without full parse
            const buf = fs.readFileSync(jsonlFile);
            messageCount = 0;
            for (let i = 0; i < buf.length; i++) {
              if (buf[i] === 10) messageCount++; // 0x0A = newline
            }

            // Only parse the last ~32KB for summary, cost, and tool counts
            // This keeps it fast even for 50MB+ files
            const tailSize = Math.min(fileSize, 32768);
            const tailBuf = Buffer.alloc(tailSize);
            const fd = fs.openSync(jsonlFile, 'r');
            fs.readSync(fd, tailBuf, 0, tailSize, Math.max(0, fileSize - tailSize));
            fs.closeSync(fd);

            const tailContent = tailBuf.toString('utf-8');
            // Skip first potentially partial line if we're reading from mid-file
            const tailLines = tailContent.split('\n').filter(Boolean);
            if (fileSize > tailSize && tailLines.length > 0) {
              tailLines.shift(); // first line is likely truncated
            }

            for (const line of tailLines) {
              try {
                const entry = JSON.parse(line);
                if (entry.message) {
                  lastRole = entry.message.role || '';
                  if (entry.message.usage?.cost?.total) {
                    totalCost += entry.message.usage.cost.total;
                  }
                  if (entry.message.content) {
                    if (Array.isArray(entry.message.content)) {
                      for (const part of entry.message.content) {
                        if (part.type === 'text' && part.text) {
                          lastMessage = part.text.slice(0, 200);
                        }
                        if (part.type === 'tool_use' || part.type === 'tool_call') {
                          toolCalls++;
                        }
                      }
                    } else if (typeof entry.message.content === 'string') {
                      lastMessage = entry.message.content.slice(0, 200);
                    }
                  }
                  if (entry.message.timestamp) {
                    lastTimestamp = Math.max(lastTimestamp, entry.message.timestamp);
                  }
                  if (entry.timestamp) {
                    const ts = new Date(entry.timestamp).getTime();
                    if (ts > 0) lastTimestamp = Math.max(lastTimestamp, ts);
                  }
                }
              } catch {}
            }
          } catch {}
        }

        // Determine a readable name
        let name = meta.label || '';
        if (!name) {
          if (sessionType === 'telegram') name = `Telegram ${sessionSubtype}`;
          else if (sessionType === 'cron') name = `Cron job`;
          else if (sessionType === 'hook') name = `Hook ${sessionSubtype || sessionId.slice(0, 8)}`;
          else name = key;
        }

        allSessions.push({
          id: sessionId,
          key,
          name,
          agent: agentId,
          type: sessionType,
          subtype: sessionSubtype,
          channelId,
          messageCount,
          toolCalls,
          cost: Math.round(totalCost * 10000) / 10000,
          lastMessage: lastMessage.replace(/\n/g, ' ').trim(),
          lastRole,
          updatedAt: lastTimestamp,
          hasLog,
          fileSize: stat?.size || 0,
          status: (Date.now() - lastTimestamp < 120000) ? 'active' : 'idle',
        });
      }
    }
  } catch (err) {
    console.error('[parser] Error parsing gateway sessions:', err.message);
  }

  // Sort by most recently updated
  allSessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return allSessions;
}

/**
 * Strip metadata blocks from user messages to get actual text.
 * Gateway user messages have format:
 *   Conversation info (untrusted metadata): ```json {...} ```
 *   Sender (untrusted metadata): ```json {...} ```
 *   <actual user message here>
 */
function cleanUserMessage(text, role) {
  if (role !== 'user') return text.slice(0, 500);

  // Try to extract text after metadata blocks
  // The actual user message comes after the last ``` block
  const parts = text.split('```');
  if (parts.length >= 5) {
    // Format: prefix```json1```middle```json2```actual_message
    const msg = parts.slice(4).join('```').trim();
    if (msg.length > 0) return msg.slice(0, 500);
  }

  // Fallback: remove everything before the last metadata section
  const senderIdx = text.lastIndexOf('Sender (untrusted');
  if (senderIdx >= 0) {
    const afterSender = text.slice(senderIdx);
    const endBlock = afterSender.indexOf('```', afterSender.indexOf('```') + 3);
    if (endBlock >= 0) {
      const msg = afterSender.slice(endBlock + 3).trim();
      if (msg.length > 0) return msg.slice(0, 500);
    }
  }

  return text.slice(0, 500);
}

/**
 * Extract sender name from user message metadata
 */
function extractSender(text, role) {
  if (role !== 'user') return null;
  try {
    const senderMatch = text.match(/Sender \(untrusted metadata\):\s*```json\s*(\{[^`]+\})\s*```/);
    if (senderMatch) {
      const sender = JSON.parse(senderMatch[1]);
      return {
        name: sender.name || sender.label || 'User',
        username: sender.username || null,
        id: sender.id || null,
      };
    }
  } catch {}
  return null;
}

function parseGatewaySessionEvents(sessionId, limit = 100) {
  if (!fs.existsSync(AGENTS_DIR)) return [];

  // Find the JSONL file across all agents
  let jsonlFile = null;
  try {
    const agentDirs = fs.readdirSync(AGENTS_DIR).filter(d => {
      return fs.statSync(path.join(AGENTS_DIR, d)).isDirectory();
    });
    for (const agentId of agentDirs) {
      const candidate = path.join(AGENTS_DIR, agentId, 'sessions', `${sessionId}.jsonl`);
      if (fs.existsSync(candidate)) { jsonlFile = candidate; break; }
    }
  } catch {}

  if (!jsonlFile) return [];

  try {
    const content = fs.readFileSync(jsonlFile, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const events = [];

    for (const line of lines.slice(-limit)) {
      try {
        const entry = JSON.parse(line);
        if (!entry.message) continue;

        const msg = entry.message;
        let text = '';
        let tools = [];
        let thinking = '';

        if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part.type === 'text') text += part.text || '';
            if (part.type === 'thinking') thinking = (part.thinking || '').slice(0, 200);
            if (part.type === 'tool_use' || part.type === 'tool_call') {
              tools.push({
                name: part.name || part.function?.name || 'unknown',
                input: JSON.stringify(part.input || part.function?.arguments || {}).slice(0, 200),
              });
            }
            if (part.type === 'tool_result') {
              tools.push({
                name: 'result',
                output: (typeof part.content === 'string' ? part.content : JSON.stringify(part.content || '')).slice(0, 200),
              });
            }
          }
        } else if (typeof msg.content === 'string') {
          text = msg.content;
        }

        events.push({
          id: entry.id,
          role: msg.role,
          text: cleanUserMessage(text, msg.role),
          sender: extractSender(text, msg.role),
          thinking: thinking,
          tools,
          model: msg.model || `${msg.provider || ''}/${msg.model || ''}`,
          cost: msg.usage?.cost?.total || 0,
          tokens: msg.usage ? {
            input: msg.usage.input || 0,
            output: msg.usage.output || 0,
            cacheRead: msg.usage.cacheRead || 0,
            total: msg.usage.totalTokens || 0,
          } : null,
          timestamp: entry.timestamp || (msg.timestamp ? new Date(msg.timestamp).toISOString() : null),
          stopReason: msg.stopReason || null,
        });
      } catch {}
    }

    return events;
  } catch {
    return [];
  }
}

function getAllSessions() {
  const codeAgentSessions = parseCodeAgentSessions().map(s => ({
    ...s,
    source: 'code-agent',
    type: 'opencode',
  }));

  const gatewaySessions = parseGatewaySessions().map(s => ({
    ...s,
    source: 'gateway',
  }));

  // Merge: gateway sessions are the primary, code-agent adds OpenCode-specific data
  const merged = [...gatewaySessions];

  // Add code-agent sessions that aren't already represented
  const gwIds = new Set(gatewaySessions.map(s => s.id));
  for (const cas of codeAgentSessions) {
    if (!gwIds.has(cas.id)) {
      merged.push(cas);
    }
  }

  // Sort by most recent
  merged.sort((a, b) => {
    const ta = a.updatedAt || new Date(a.completedAt || a.startedAt || 0).getTime();
    const tb = b.updatedAt || new Date(b.completedAt || b.startedAt || 0).getTime();
    return tb - ta;
  });

  return merged;
}

function getDashboardStats() {
  const allSessions = getAllSessions();
  const codeAgentSessions = parseCodeAgentSessions();
  const agents = parseAgentRegistry();
  const progress = parseDevProgress();
  const gatewaySessions = parseGatewaySessions();

  const activeSessions = [
    ...codeAgentSessions.filter(s => s.status === 'running' || s.status === 'started'),
    ...gatewaySessions.filter(s => s.status === 'active'),
  ];
  const completedSessions = codeAgentSessions.filter(s => s.status === 'completed');
  const failedSessions = codeAgentSessions.filter(s => s.status === 'failed' || s.status === 'killed');

  const codeCost = codeAgentSessions.reduce((sum, s) => sum + (parseFloat(s.cost) || 0), 0);
  const gwCost = gatewaySessions.reduce((sum, s) => sum + (parseFloat(s.cost) || 0), 0);
  const totalCost = codeCost + gwCost;

  return {
    gateway: { status: 'running', port: 18789 },
    sessions: {
      total: allSessions.length,
      active: activeSessions.length,
      completed: completedSessions.length,
      failed: failedSessions.length,
      gateway: gatewaySessions.length,
      codeAgent: codeAgentSessions.length,
    },
    agents: {
      total: agents.length,
      active: agents.filter(a => a.status === 'active').length,
    },
    cost: {
      total: Math.round(totalCost * 100) / 100,
    },
    progress: {
      total: progress.length,
      running: progress.filter(p => p.status === 'running').length,
    },
  };
}

module.exports = {
  parseCodeAgentSessions,
  parseDevProgress,
  parseOpenCodeEvents,
  parseOpenCodeResult,
  parseAgentRegistry,
  parseCronJobs,
  parseCommandLog,
  parseSubagentRuns,
  getAvailableOpenCodeSessions,
  parseGatewaySessions,
  parseGatewaySessionEvents,
  getAllSessions,
  getDashboardStats,
  OPENCLAW_HOME,
  OPENCLAW_WORKSPACE,
};
