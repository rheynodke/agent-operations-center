'use strict';
const fs   = require('fs');
const path = require('path');
const { OPENCLAW_HOME, AGENTS_DIR, getUserHome, getUserAgentsDir, readJsonSafe } = require('../config.cjs');
const { parseAgentRegistry } = require('./opencode.cjs');

function homeFor(userId) {
  return userId == null ? OPENCLAW_HOME : getUserHome(userId);
}
function agentsDirFor(userId) {
  return userId == null ? AGENTS_DIR : getUserAgentsDir(userId);
}

/**
 * Parse text-encoded tool call markers into structured tool calls and clean text.
 * Handles: <|tool_calls_section_begin|> <|tool_call_begin|> funcname:id <|tool_call_argument_begin|> {...} <|tool_call_end|> <|tool_calls_section_end|>
 */
function parseTextToolCalls(text) {
  if (!text || !text.includes('<|tool_calls_section_begin|>')) {
    return { cleanText: text, toolCalls: [] };
  }
  const toolCalls = [];
  let cleanText = text;
  const sectionRe = /<\|tool_calls_section_begin\|>([\s\S]*?)<\|tool_calls_section_end\|>/g;
  let sectionMatch;
  while ((sectionMatch = sectionRe.exec(text)) !== null) {
    const section = sectionMatch[1];
    const tcRe = /<\|tool_call_begin\|>\s*([\w.:/-]+)\s*<\|tool_call_argument_begin\|>([\s\S]*?)<\|tool_call_end\|>/g;
    let tcMatch;
    while ((tcMatch = tcRe.exec(section)) !== null) {
      const [, nameWithId, argsRaw] = tcMatch;
      const colonIdx = nameWithId.lastIndexOf(':');
      const name = colonIdx > 0
        ? nameWithId.slice(0, colonIdx).replace(/^functions\./, '')
        : nameWithId.replace(/^functions\./, '');
      let input;
      try { input = JSON.stringify(JSON.parse(argsRaw.trim()), null, 2); }
      catch { input = argsRaw.trim(); }
      toolCalls.push({ name, input });
    }
    cleanText = cleanText.replace(sectionMatch[0], '');
  }
  return { cleanText: cleanText.trim(), toolCalls };
}

/**
 * Extract local media file paths from a raw gateway user message.
 * Handles: [media attached: /path/file.jpg (image/jpeg) | ...]
 */
const MEDIA_ATTACHED_RE = /\[media attached:\s*([^\s(]+)\s*\([^)]+\)\s*\|[^\]]*\]/g;
function extractMediaFiles(text) {
  if (!text || !text.includes('[media attached:')) return [];
  const paths = [];
  const re = new RegExp(MEDIA_ATTACHED_RE.source, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    paths.push(m[1]);
  }
  return paths;
}

/**
 * Strip metadata blocks from user messages to get actual text.
 * Gateway user messages have format:
 *   Conversation info (untrusted metadata): ```json {...} ```
 *   Sender (untrusted metadata): ```json {...} ```
 *   <actual user message here>
 */
function cleanUserMessage(text, role) {
  if (role !== 'user') return text;

  const parts = text.split('```');
  if (parts.length >= 5) {
    const msg = parts.slice(4).join('```').trim();
    if (msg.length > 0) return msg;
  }

  const senderIdx = text.lastIndexOf('Sender (untrusted');
  if (senderIdx >= 0) {
    const afterSender = text.slice(senderIdx);
    const endBlock = afterSender.indexOf('```', afterSender.indexOf('```') + 3);
    if (endBlock >= 0) {
      const msg = afterSender.slice(endBlock + 3).trim();
      if (msg.length > 0) return msg;
    }
  }

  // Strip gateway-injected timestamp prefix: "[Day DD Mon YYYY HH:MM TZ] message"
  // e.g. "[Sun 2026-04-05 22:36 GMT+7] hello" → "hello"
  const tsMatch = text.match(/^\[[^\]]{5,50}\]\s+(.+)$/s);
  if (tsMatch) return tsMatch[1].trim();

  return text;
}

/**
 * Extract sender name from user message metadata.
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

function parseGatewaySessions(userId) {
  const agentsDir = agentsDirFor(userId);
  if (!fs.existsSync(agentsDir)) return [];

  const allSessions = [];
  const agents = parseAgentRegistry(userId);
  const agentMap = {};
  for (const a of agents) agentMap[a.id] = a;

  try {
    const agentDirs = fs.readdirSync(agentsDir).filter(d => {
      return fs.statSync(path.join(agentsDir, d)).isDirectory();
    });

    for (const agentId of agentDirs) {
      const sessionsFile = path.join(agentsDir, agentId, 'sessions', 'sessions.json');
      const sessionsDir  = path.join(agentsDir, agentId, 'sessions');
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

        const parts = key.split(':');
        const sessionType    = parts[2] || 'unknown';
        const sessionSubtype = parts[3] || '';
        const channelId      = parts[4] || '';

        let lastMessage = '';
        let lastRole = '';
        let lastTimestamp = meta.updatedAt || 0;
        let messageCount = 0;
        let totalCost = 0;
        let toolCalls = 0;
        let tokensIn = 0;
        let tokensOut = 0;

        if (hasLog) {
          try {
            const fullContent = fs.readFileSync(jsonlFile, 'utf-8');
            const allLines = fullContent.split('\n').filter(Boolean);
            messageCount = allLines.length;

            for (const line of allLines) {
              try {
                const entry = JSON.parse(line);
                if (entry.message) {
                  lastRole = entry.message.role || '';
                  if (entry.message.usage?.cost?.total) totalCost += entry.message.usage.cost.total;
                  if (entry.message.usage?.input)  tokensIn  += entry.message.usage.input;
                  if (entry.message.usage?.output) tokensOut += entry.message.usage.output;
                  if (entry.message.content) {
                    if (Array.isArray(entry.message.content)) {
                      for (const part of entry.message.content) {
                        if (part.type === 'text' && part.text) lastMessage = part.text.slice(0, 200);
                        if (part.type === 'tool_use' || part.type === 'tool_call' || part.type === 'toolCall') toolCalls++;
                      }
                    } else if (typeof entry.message.content === 'string') {
                      lastMessage = entry.message.content.slice(0, 200);
                    }
                  }
                  if (entry.message.timestamp) lastTimestamp = Math.max(lastTimestamp, entry.message.timestamp);
                  if (entry.timestamp) {
                    const ts = new Date(entry.timestamp).getTime();
                    if (ts > 0) lastTimestamp = Math.max(lastTimestamp, ts);
                  }
                }
              } catch {}
            }
          } catch {}
        }

        let name = meta.label || '';
        const agentInfo = agentMap[agentId];
        let displayAgentName = agentInfo?.name || agentId;
        if (displayAgentName) displayAgentName = displayAgentName.charAt(0).toUpperCase() + displayAgentName.slice(1);
        const displayModel = agentInfo?.model || '';
        const displayEmoji = agentInfo?.emoji || (agentId === 'main' ? '✨' : '🤖');

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
          agentName: displayAgentName,
          agentEmoji: displayEmoji,
          model: displayModel,
          type: sessionType,
          subtype: sessionSubtype,
          channelId,
          messageCount,
          toolCalls,
          tokensIn,
          tokensOut,
          cost: Math.round(totalCost * 10000) / 10000,
          lastMessage: lastMessage.replace(/\n/g, ' ').trim(),
          lastRole,
          updatedAt: lastTimestamp,
          hasLog,
          fileSize: stat?.size || 0,
          status: (() => {
            const lockFile = path.join(sessionsDir, `${sessionId}.jsonl.lock`);
            try {
              if (fs.existsSync(lockFile)) {
                const lockData = readJsonSafe(lockFile);
                if (lockData && lockData.pid) {
                  try { process.kill(lockData.pid, 0); return 'active'; } catch {}
                } else {
                  const lstat = fs.statSync(lockFile);
                  if (Date.now() - lstat.mtimeMs < 60000) return 'active';
                }
              }
            } catch {}
            return 'idle';
          })(),
        });
      }
    }
  } catch (err) {
    console.error('[gateway] Error parsing gateway sessions:', err.message);
  }

  allSessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return allSessions;
}

function parseGatewaySessionEvents(sessionId, limit = 500, userId) {
  const agentsDir = agentsDirFor(userId);
  if (!fs.existsSync(agentsDir)) return [];

  let jsonlFile = null;
  let foundAgentId = null;
  try {
    const agentDirs = fs.readdirSync(agentsDir).filter(d => {
      return fs.statSync(path.join(agentsDir, d)).isDirectory();
    });
    for (const agentId of agentDirs) {
      const candidate = path.join(agentsDir, agentId, 'sessions', `${sessionId}.jsonl`);
      if (fs.existsSync(candidate)) { jsonlFile = candidate; foundAgentId = agentId; break; }
    }
  } catch {}

  if (!jsonlFile) return [];

  let defaultModelStr = '';
  if (foundAgentId) {
    const agents = parseAgentRegistry(userId);
    const agentInfo = agents.find(a => a.id === foundAgentId);
    if (agentInfo) defaultModelStr = agentInfo.model || '';
  }

  try {
    const content = fs.readFileSync(jsonlFile, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const events = [];

    // First pass: map toolCallId → toolName
    const toolCallNames = new Map();
    for (const line of lines.slice(-limit)) {
      try {
        const entry = JSON.parse(line);
        const msg = entry.message;
        if (!msg || !Array.isArray(msg.content)) continue;
        for (const part of msg.content) {
          if (part.type === 'toolCall' && part.id && part.name) toolCallNames.set(part.id, part.name);
        }
      } catch {}
    }

    for (const line of lines.slice(-limit)) {
      try {
        const entry = JSON.parse(line);
        if (!entry.message) continue;

        const msg = entry.message;
        let text = '';
        let tools = [];
        let thinking = '';

        if (msg.role === 'toolResult') {
          const toolName = msg.toolName || toolCallNames.get(msg.toolCallId) || 'tool';
          let output = '';
          if (Array.isArray(msg.content)) {
            output = msg.content.map(c => {
              if (typeof c === 'string') return c;
              if (c.type === 'text') return c.text || '';
              return JSON.stringify(c, null, 2);
            }).join('\n');
          } else if (typeof msg.content === 'string') {
            output = msg.content;
          } else {
            output = JSON.stringify(msg.content || '', null, 2);
          }
          events.push({
            id: entry.id || msg.toolCallId,
            role: 'toolResult',
            text: '',
            sender: null,
            thinking: '',
            tools: [{ name: toolName, output }],
            model: '',
            cost: 0,
            tokens: null,
            timestamp: entry.timestamp || (msg.timestamp ? new Date(msg.timestamp).toISOString() : null),
            stopReason: null,
            isError: msg.isError || false,
          });
          continue;
        }

        if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part.type === 'text') {
              const rawPartText = part.text || '';
              // Parse inline tool call markers embedded in text parts
              const { cleanText: partClean, toolCalls: partTools } = parseTextToolCalls(rawPartText);
              text += partClean;
              tools.push(...partTools);
            }
            if (part.type === 'thinking') thinking = part.thinking || '';
            if (part.type === 'toolCall') {
              tools.push({
                name: part.name || 'unknown',
                input: typeof part.arguments === 'string' ? part.arguments : JSON.stringify(part.arguments || {}, null, 2),
                toolCallId: part.id || null,
              });
            }
            if (part.type === 'tool_use' || part.type === 'tool_call') {
              tools.push({
                name: part.name || part.function?.name || 'unknown',
                input: JSON.stringify(part.input || part.function?.arguments || {}, null, 2),
              });
            }
            if (part.type === 'tool_result') {
              tools.push({
                name: 'result',
                output: typeof part.content === 'string' ? part.content : JSON.stringify(part.content || '', null, 2),
              });
            }
          }
        } else if (typeof msg.content === 'string') {
          // Parse inline tool call markers in plain string content
          const { cleanText: strClean, toolCalls: strTools } = parseTextToolCalls(msg.content);
          text = strClean;
          tools.push(...strTools);
        }

        let evtModel = '';
        if (typeof msg.model === 'string') {
          evtModel = msg.provider ? `${msg.provider}/${msg.model}` : msg.model;
        } else if (msg.model && typeof msg.model === 'object') {
          evtModel = `${msg.model.provider || msg.provider || ''}/${msg.model.name || msg.model.id || ''}`;
        }
        if (!evtModel || evtModel === '/') evtModel = defaultModelStr;

        events.push({
          id: entry.id,
          role: msg.role,
          text: cleanUserMessage(text, msg.role),
          sender: extractSender(text, msg.role),
          mediaFiles: extractMediaFiles(text),
          thinking,
          tools,
          model: evtModel,
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

/**
 * Parse a single JSONL line into a SessionEvent for real-time streaming.
 */
function parseSingleGatewayEntry(jsonLine) {
  try {
    const entry = JSON.parse(jsonLine);
    if (!entry.message) return null;

    const msg = entry.message;
    let text = '';
    let tools = [];
    let thinking = '';

    if (msg.role === 'toolResult') {
      let output = '';
      if (Array.isArray(msg.content)) {
        output = msg.content.map(c => {
          if (typeof c === 'string') return c;
          if (c.type === 'text') return c.text || '';
          return JSON.stringify(c, null, 2);
        }).join('\n');
      } else if (typeof msg.content === 'string') {
        output = msg.content;
      } else {
        output = JSON.stringify(msg.content || '', null, 2);
      }
      return {
        id: entry.id || msg.toolCallId,
        role: 'toolResult',
        text: '',
        sender: null,
        thinking: '',
        tools: [{ name: msg.toolName || 'tool', output }],
        model: '',
        cost: 0,
        tokens: null,
        timestamp: entry.timestamp || null,
        stopReason: null,
        isError: msg.isError || false,
      };
    }

    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'text') {
          const rawPartText = part.text || '';
          const { cleanText: partClean, toolCalls: partTools } = parseTextToolCalls(rawPartText);
          text += partClean;
          tools.push(...partTools);
        }
        if (part.type === 'thinking') thinking = part.thinking || '';
        if (part.type === 'toolCall') {
          tools.push({
            name: part.name || 'unknown',
            input: typeof part.arguments === 'string' ? part.arguments : JSON.stringify(part.arguments || {}, null, 2),
            toolCallId: part.id || null,
          });
        }
        if (part.type === 'tool_use' || part.type === 'tool_call') {
          tools.push({
            name: part.name || part.function?.name || 'unknown',
            input: JSON.stringify(part.input || part.function?.arguments || {}, null, 2),
          });
        }
        if (part.type === 'tool_result') {
          tools.push({
            name: 'result',
            output: typeof part.content === 'string' ? part.content : JSON.stringify(part.content || '', null, 2),
          });
        }
      }
    } else if (typeof msg.content === 'string') {
      const { cleanText: strClean, toolCalls: strTools } = parseTextToolCalls(msg.content);
      text = strClean;
      tools.push(...strTools);
    }

    let evtModel = '';
    if (typeof msg.model === 'string') {
      evtModel = msg.provider ? `${msg.provider}/${msg.model}` : msg.model;
    } else if (msg.model && typeof msg.model === 'object') {
      evtModel = `${msg.model.provider || msg.provider || ''}/${msg.model.name || msg.model.id || ''}`;
    }

    return {
      id: entry.id,
      role: msg.role,
      text: cleanUserMessage(text, msg.role),
      sender: extractSender(text, msg.role),
      mediaFiles: extractMediaFiles(text),
      thinking,
      tools,
      model: evtModel,
      cost: msg.usage?.cost?.total || 0,
      tokens: msg.usage ? {
        input: msg.usage.input || 0,
        output: msg.usage.output || 0,
        cacheRead: msg.usage.cacheRead || 0,
        total: msg.usage.totalTokens || 0,
      } : null,
      timestamp: entry.timestamp || null,
      stopReason: msg.stopReason || null,
    };
  } catch {
    return null;
  }
}

module.exports = {
  parseTextToolCalls,
  cleanUserMessage,
  extractSender,
  extractMediaFiles,
  parseGatewaySessions,
  parseGatewaySessionEvents,
  parseSingleGatewayEntry,
};
