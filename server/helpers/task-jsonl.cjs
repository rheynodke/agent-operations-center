/**
 * helpers/task-jsonl.cjs
 *
 * Reconstructs full multi-dispatch message history from gateway JSONL session
 * files for a given task. 1 Ticket = 1 logical session, but the gateway creates
 * a new JSONL file per chatSend round — this helper merges them all.
 */
'use strict';

const path = require('path');
const fs = require('fs');

/**
 * Find all gateway JSONL session files for an agent that contain a given taskId,
 * parse them, and return a combined chronologically-ordered message array.
 *
 * @param {string} agentId
 * @param {string} taskId
 * @param {{ AGENTS_DIR: string }} config
 * @returns {Array}
 */
function loadAllJSONLMessagesForTask(agentId, taskId, config) {
  try {
    const sessionsDir = path.join(config.AGENTS_DIR, agentId, 'sessions');
    if (!fs.existsSync(sessionsDir)) return [];

    const files = fs.readdirSync(sessionsDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => path.join(sessionsDir, f));

    // For each file, find the FIRST line that mentions the taskId, then take
    // only messages from that line onwards. This prevents bleed-through when a
    // session is shared between unrelated chat (e.g. DM with the agent) AND
    // the task — only the task-relevant tail of the session is exported.
    const allMessages = [];
    for (const file of files) {
      let raw;
      try { raw = fs.readFileSync(file, 'utf8'); } catch { continue; }
      if (!raw.includes(taskId)) continue;

      const lines = raw.split('\n');
      // Find index of first line mentioning taskId.
      let startIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(taskId)) { startIdx = i; break; }
      }
      if (startIdx < 0) continue;

      // Walk back a few lines to capture the user prompt that introduced the
      // task (typically the line right before the first taskId mention).
      const lookback = 3;
      const begin = Math.max(0, startIdx - lookback);

      for (let i = begin; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        try {
          const entry = JSON.parse(line);
          if (entry.type !== 'message' || !entry.message) continue;
          const { role, content, toolCallId, toolName } = entry.message;
          if (!role) continue;
          allMessages.push({
            id: entry.id,
            role,
            content,
            toolCallId,
            toolName,
            timestamp: entry.timestamp ? new Date(entry.timestamp).getTime() : 0,
            _file: path.basename(file, '.jsonl'),
          });
        } catch { /* skip malformed lines */ }
      }
    }

    // Deduplicate by id, sort chronologically
    const seen = new Set();
    const deduped = allMessages.filter(m => {
      if (!m.id || seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
    deduped.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    return deduped;
  } catch (err) {
    console.warn('[loadAllJSONLMessagesForTask]', err.message);
    return [];
  }
}

module.exports = { loadAllJSONLMessagesForTask };
