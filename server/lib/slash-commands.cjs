'use strict';
/**
 * Slash command registry for AOC Mission Rooms.
 *
 * Source of truth: each BUILT-IN skill bundle ships a `commands.json` at the
 * root of its installed dir (`~/.openclaw/skills/<slug>/commands.json`) with
 * shape:
 *
 *   [
 *     {
 *       "name": "create-schedule",
 *       "description": "Buat jadwal baru dari narasi natural",
 *       "argHint": "<narasi: kapan + apa yang dijalankan>",
 *       "template": "<rendered prompt sent to agent>"
 *     }
 *   ]
 *
 * We intentionally only walk a hardcoded whitelist of built-in slugs — user-
 * authored skills (created via aoc-self at `<workspace>/.agents/skills/<slug>/`)
 * are NOT exposed in dashboard rooms. They surface in Telegram/WhatsApp
 * channels via OpenClaw's gateway-side adapter instead.
 */
const fs = require('fs');
const path = require('path');
const { OPENCLAW_HOME } = require('./config.cjs');

// Whitelist — only these skill slugs can contribute slash commands to rooms.
// `aoc-master` is included because its commands are gated to master agents
// at the rendering layer (we still surface the entry, but the resolver checks
// the agent before dispatching).
const BUILTIN_SLUGS = [
  'aoc-tasks',
  'aoc-connections',
  'aoc-room',
  'aoc-odoo',
  'aoc-schedules',
  'aoc-self',
  'aoc-master',
];

const NAME_RE = /^[a-z][a-z0-9-]{0,40}$/;

/**
 * Walk every whitelisted built-in skill's commands.json and return the
 * aggregated command list. Each entry includes the source skill slug so
 * the UI can group them.
 *
 * @returns {Array<{name, description, argHint, template, skillSlug}>}
 */
function getBuiltinSlashCommands() {
  const result = [];
  const seen = new Set();
  for (const slug of BUILTIN_SLUGS) {
    const cmdsPath = path.join(OPENCLAW_HOME, 'skills', slug, 'commands.json');
    let entries;
    try {
      const raw = fs.readFileSync(cmdsPath, 'utf-8');
      entries = JSON.parse(raw);
    } catch { continue; }
    if (!Array.isArray(entries)) continue;
    for (const e of entries) {
      if (!e || typeof e !== 'object') continue;
      if (typeof e.name !== 'string' || !NAME_RE.test(e.name)) continue;
      if (typeof e.template !== 'string' || !e.template.length) continue;
      if (seen.has(e.name)) continue; // first-wins
      seen.add(e.name);
      result.push({
        name: e.name,
        description: typeof e.description === 'string' ? e.description : '',
        argHint:     typeof e.argHint     === 'string' ? e.argHint     : '',
        template:    e.template,
        skillSlug:   slug,
      });
    }
  }
  return result;
}

/**
 * Look up a single command by name. Returns null if not found.
 */
function findSlashCommand(name) {
  if (typeof name !== 'string') return null;
  const trimmed = name.startsWith('/') ? name.slice(1) : name;
  if (!NAME_RE.test(trimmed)) return null;
  const all = getBuiltinSlashCommands();
  return all.find(c => c.name === trimmed) || null;
}

/**
 * Render the prompt template for an agent. Supports `{{args}}` and a few
 * context variables.
 *
 * @param {object} cmdDef
 * @param {string} args raw user-typed arguments (everything after the command name)
 * @param {object} ctx { agentId, agentName, userName, roomId, roomName }
 */
function renderSlashTemplate(cmdDef, args, ctx = {}) {
  const safe = (v) => (v == null ? '' : String(v));
  return cmdDef.template
    .replace(/\{\{args\}\}/g, safe(args))
    .replace(/\{\{agentId\}\}/g, safe(ctx.agentId))
    .replace(/\{\{agentName\}\}/g, safe(ctx.agentName))
    .replace(/\{\{userName\}\}/g, safe(ctx.userName))
    .replace(/\{\{roomId\}\}/g, safe(ctx.roomId))
    .replace(/\{\{roomName\}\}/g, safe(ctx.roomName))
    .replace(/\{\{commandName\}\}/g, safe(cmdDef.name));
}

module.exports = {
  BUILTIN_SLUGS,
  getBuiltinSlashCommands,
  findSlashCommand,
  renderSlashTemplate,
};
