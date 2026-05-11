'use strict';

/**
 * Runtime layer-2 tool violation detector for embed channel.
 *
 * Checks whether tool_use blocks in gateway events are permitted by
 * the configured allowlist. No DB dependency — pure in-memory logic.
 */

/**
 * Default allowlist for public (unauthenticated) embed sessions.
 * Does NOT include exec, fs, or any shell-execution tool.
 */
const PUBLIC_DEFAULT_ALLOWLIST = ['memory_search', 'text_response', 'task_create'];

/**
 * Check whether a single tool_use is permitted.
 *
 * @param {{ name: string, input?: object }|null} toolUse
 * @param {{ allowlist?: string[]|null }} opts
 * @returns {{ allowed: boolean, violation?: string }}
 */
function checkToolUse(toolUse, { allowlist = null } = {}) {
  if (!allowlist) return { allowed: true };
  if (!toolUse || !toolUse.name) return { allowed: true };
  if (allowlist.includes(toolUse.name)) return { allowed: true };
  return { allowed: false, violation: toolUse.name };
}

/**
 * Extract all tool_use blocks from a raw gateway WebSocket event.
 *
 * @param {object|null|undefined} event
 * @returns {Array<{ name: string, input: object }>}
 */
function extractToolUseFromGatewayEvent(event) {
  const out = [];
  const content = event?.message?.content;
  if (!Array.isArray(content)) return out;
  for (const block of content) {
    if (block && block.type === 'tool_use' && block.name) {
      out.push({ name: block.name, input: block.input || {} });
    }
  }
  return out;
}

module.exports = { checkToolUse, extractToolUseFromGatewayEvent, PUBLIC_DEFAULT_ALLOWLIST };
