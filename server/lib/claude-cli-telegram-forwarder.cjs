'use strict';
/**
 * claude-cli-telegram-forwarder.cjs
 *
 * OpenClaw's claude-cli backend parser (`cli-output.ts`) does not emit
 * `text_end` signals and only aggregates the FINAL text block for delivery to
 * the channel. Any *intermediate* assistant text blocks (the "Let me check…"
 * progress updates between tool calls) never make it to Telegram — the user
 * only sees the final summary. Meanwhile the dashboard timeline shows all of
 * them because it parses the raw jsonl directly.
 *
 * This module closes that gap on the AOC side: it scans each agent's
 * `~/.claude/projects/<slug>/*.jsonl` for assistant text blocks and forwards
 * the *intermediate* ones to the agent's bound Telegram chat via the Bot API.
 * The final text block is deliberately NOT forwarded — OpenClaw's regular
 * send-message path handles that, so we avoid duplicate messages.
 *
 * Intermediate detection rule:
 *   A text block is intermediate iff at least one entry in the same jsonl
 *   after it is either a `tool_use` (assistant invoking a tool) or a new
 *   user turn start. The final text block in a turn has neither, so it is
 *   skipped and left to OpenClaw.
 *
 * Dedup: per-UUID — we remember which block UUIDs we've already forwarded
 * across the lifetime of the watcher process. The set is unbounded but each
 * UUID is ~36 bytes so drift is negligible.
 *
 * Channel resolution order, per claude-cli jsonl:
 *   1. Linked gateway session's `origin.to` (e.g. "telegram:577142951") —
 *      matched via mtime proximity to the jsonl file (shared logic with the
 *      session-list linker).
 *   2. Fallback: first entry in `channels.telegram.accounts.<agentId|default>.allowFrom`.
 *   3. If neither, the block is silently dropped (agent probably not bound
 *      to Telegram; e.g. pure web-chat session).
 *
 * The forwarder is defensive: every Telegram POST is wrapped with a 10s
 * timeout, failures are logged once per jsonl and not retried, and it never
 * throws into the watcher poll loop.
 */

const fs   = require('fs');
const path = require('path');
const { OPENCLAW_HOME, AGENTS_DIR, readJsonSafe } = require('./config.cjs');
const { buildAgentClaudeCliMap } = require('./sessions/claude-cli.cjs');

const LINK_WINDOW_MS   = 5 * 60_000;   // same as sessions linker — consistent UX
const TELEGRAM_TIMEOUT = 10_000;
const TELEGRAM_MAX     = 4000;         // safely below Telegram's 4096 limit
// Max per-block chars before we truncate the forwarded version. Final blocks
// are what actually carry the full write-up, and OpenClaw will send those.
const FORWARD_MAX_CHARS = 3500;

/**
 * Read Telegram config for an agent. Returns { botToken, defaultChatId } or null.
 * The account key is normally the agentId; falls back to "default" for the main agent.
 */
function readTelegramCredsForAgent(agentId) {
  const cfg = readJsonSafe(path.join(OPENCLAW_HOME, 'openclaw.json'));
  if (!cfg) return null;
  const accounts = cfg.channels?.telegram?.accounts || {};
  const keys = [agentId, agentId === 'main' ? 'default' : null, 'main', 'default'].filter(Boolean);
  for (const key of keys) {
    const acc = accounts[key];
    if (!acc || !acc.botToken) continue;
    const allow = Array.isArray(acc.allowFrom) ? acc.allowFrom : [];
    return {
      botToken: acc.botToken,
      defaultChatId: allow.length ? String(allow[0]) : null,
      accountKey: key,
    };
  }
  return null;
}

/**
 * Pick the linked gateway session for a claude-cli jsonl. Returns the session's
 * Telegram chat_id (from `origin.to`), or null.
 *
 * Telegram `origin.to` looks like `telegram:577142951`; we strip the prefix.
 */
function resolveTelegramChatFromLinkedSession(agentId, claudeCliFilePath) {
  let stat;
  try { stat = fs.statSync(claudeCliFilePath); } catch { return null; }

  const sessionsFile = path.join(AGENTS_DIR, agentId, 'sessions', 'sessions.json');
  const data = readJsonSafe(sessionsFile);
  if (!data || typeof data !== 'object') return null;

  let best = null;
  let bestDelta = Infinity;
  for (const [key, meta] of Object.entries(data)) {
    const updatedAt = meta?.updatedAt || 0;
    if (!updatedAt) continue;
    if (!key.includes(':telegram:')) continue;  // only telegram sessions
    const delta = Math.abs(updatedAt - stat.mtimeMs);
    if (delta < bestDelta) { bestDelta = delta; best = meta; }
  }
  if (!best || bestDelta > LINK_WINDOW_MS) return null;

  const to = best.origin?.to || best.deliveryContext?.to;
  if (typeof to !== 'string' || !to.startsWith('telegram:')) return null;
  return to.replace(/^telegram:/, '');
}

/**
 * Extract ordered entries relevant for intermediate-detection from a claude-cli jsonl.
 * Only keeps assistant (text/tool_use), user-turn-start (string content), and tool_result
 * entries — everything else (queue-operation, attachment, ai-title, result) is noise
 * for the purpose of deciding "is this text block followed by another action?".
 */
function scanAssistantBlocks(filePath) {
  let content;
  try { content = fs.readFileSync(filePath, 'utf-8'); }
  catch { return []; }

  const entries = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    const type = d.type;
    const msg  = d.message;

    if (type === 'user' && typeof msg?.content === 'string') {
      // New user turn: marks end of previous turn and start of a new one.
      entries.push({ kind: 'user_turn', uuid: d.uuid, lineIdx: i });
      continue;
    }
    if (type === 'assistant' && Array.isArray(msg?.content)) {
      for (const part of msg.content) {
        if (!part || typeof part !== 'object') continue;
        if (part.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
          entries.push({
            kind: 'text',
            uuid: d.uuid || `${filePath}:${i}`,
            text: part.text,
            lineIdx: i,
          });
        } else if (part.type === 'tool_use') {
          entries.push({ kind: 'tool_use', uuid: d.uuid, lineIdx: i });
        }
      }
    }
  }
  return entries;
}

/**
 * A text block is INTERMEDIATE within its turn iff, between itself and the
 * next `user_turn` boundary (or the end of the jsonl), there is a `tool_use`
 * entry. That means the assistant is pausing to explain *before* invoking a
 * tool — exactly the "Let me check…" moments that should reach Telegram.
 *
 * A text block followed directly by the next `user_turn` (no tool_use in
 * between) is the FINAL reply of its turn and gets skipped — OpenClaw's
 * regular channel delivery already handles it.
 *
 * Edge case: the VERY LAST text block of the jsonl (no user_turn follows at
 * all) is also treated as FINAL; the turn may still be in progress or just
 * ended, and OpenClaw will own the send.
 */
function selectIntermediateTextBlocks(entries) {
  const result = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.kind !== 'text') continue;
    let hasToolUseInTurn = false;
    for (let j = i + 1; j < entries.length; j++) {
      const next = entries[j];
      if (next.kind === 'user_turn') break;  // turn ended without tool_use → final
      if (next.kind === 'tool_use') { hasToolUseInTurn = true; break; }
    }
    if (hasToolUseInTurn) result.push(e);
  }
  return result;
}

/**
 * Trim/normalize a forwarded block. Telegram's hard limit is 4096 — we cap at
 * FORWARD_MAX_CHARS to leave room for any MarkdownV2 escaping. We also drop
 * trailing whitespace and skip entries that would be empty after trimming.
 */
function normalizeForwardText(text) {
  if (typeof text !== 'string') return null;
  let s = text.trim();
  if (!s) return null;
  if (s.length > FORWARD_MAX_CHARS) s = s.slice(0, FORWARD_MAX_CHARS - 1) + '…';
  return s;
}

/**
 * POST https://api.telegram.org/bot<token>/sendMessage. Best-effort: returns
 * true on success, false on any failure. Does not throw.
 */
async function sendTelegramMessage({ botToken, chatId, text }) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const body = JSON.stringify({
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    // Skip parse_mode to avoid escaping hassles for free-form agent text —
    // the intermediate messages are usually short status updates, not rich md.
  });

  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), TELEGRAM_TIMEOUT);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: controller.signal,
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.error(`[claude-cli-forwarder] Telegram sendMessage HTTP ${res.status}: ${errBody.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[claude-cli-forwarder] Telegram send error: ${err.message}`);
    return false;
  } finally {
    clearTimeout(to);
  }
}

/**
 * Scan a single jsonl file and forward any newly-detected intermediate text
 * blocks to Telegram. Mutates `forwardedUuids` to record what we've sent.
 *
 * Returns the number of messages forwarded on this pass.
 */
async function processClaudeCliFile({ agentId, filePath, forwardedUuids }) {
  const entries = scanAssistantBlocks(filePath);
  if (entries.length === 0) return 0;

  const intermediate = selectIntermediateTextBlocks(entries);
  if (intermediate.length === 0) return 0;

  const creds = readTelegramCredsForAgent(agentId);
  if (!creds) return 0;  // agent has no telegram binding

  const chatId =
    resolveTelegramChatFromLinkedSession(agentId, filePath) || creds.defaultChatId;
  if (!chatId) return 0;  // no chat to send to

  let sent = 0;
  for (const block of intermediate) {
    if (forwardedUuids.has(block.uuid)) continue;
    forwardedUuids.add(block.uuid);  // mark first to avoid retries-on-failure storms

    const text = normalizeForwardText(block.text);
    if (!text) continue;

    const ok = await sendTelegramMessage({ botToken: creds.botToken, chatId, text });
    if (ok) sent++;
  }
  return sent;
}

module.exports = {
  // Public entry point for watchers.cjs
  processClaudeCliFile,
  // Exposed for tests / introspection
  scanAssistantBlocks,
  selectIntermediateTextBlocks,
  readTelegramCredsForAgent,
  resolveTelegramChatFromLinkedSession,
  normalizeForwardText,
  sendTelegramMessage,
};
