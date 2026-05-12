'use strict';
/**
 * memory-bootstrap — shared helpers to enable openclaw memory dreaming
 * pipeline and bootstrap per-agent memory artifacts.
 *
 * Used by:
 *   - server/lib/agents/provision.cjs (new agents)
 *   - scripts/backfill-memory-infra.cjs (existing agents)
 *
 * What this does:
 *   1. Enable `plugins.entries.memory-core.config.dreaming.enabled = true` in
 *      a user's openclaw.json so the gateway auto-installs the managed
 *      "Memory Dreaming Promotion" cron job at startup.
 *   2. Enable `plugins.entries.active-memory` with sane defaults so a
 *      blocking memory sub-agent runs before every reply on EVERY channel
 *      (DM, Telegram, WhatsApp, mission rooms) — universal self-recall.
 *   3. Create an empty `<workspace>/memory/.dreams/short-term-recall.json`
 *      so the recall store is in place when the first qmd search happens or
 *      when our AOC-side hooks write to it directly.
 *   4. Seed `<workspace>/MEMORY.md` with a richer template that includes the
 *      "self-correction protocol" (anti omong-kosong rule) — only if file is
 *      still the default empty placeholder.
 *   5. Inject managed memory-protocol block into `<workspace>/SOUL.md` so the
 *      agent has explicit instructions to recall + persist at every turn.
 *
 * Idempotent. Returns { configChanged, activeMemoryChanged, recallCreated,
 *                      memorySeeded, soulPatched }.
 */
const fs = require('node:fs');
const path = require('node:path');
const { readJsonSafe } = require('./config.cjs');

const DREAMING_DEFAULT_FREQUENCY = '0 3 * * *'; // 3am daily

const ACTIVE_MEMORY_DEFAULTS = {
  enabled: true,
  agents: null, // populated dynamically with all current agent IDs
  allowedChatTypes: ['direct'],
  model: 'claude-cli/claude-haiku-4-5',
  queryMode: 'recent',
  promptStyle: 'balanced',
  timeoutMs: 8000,
  maxSummaryChars: 220,
  persistTranscripts: false,
  logging: true,
};

const SOUL_MEMORY_PROTOCOL_BLOCK = `
<!-- aoc:memory-protocol:start -->
## Memory protocol — wajib

Sebelum menjawab tiap turn:
1. Kalau pertanyaan menyentuh preferensi user, history, atau "yang seperti tadi/biasa" → panggil \`memory_search\` dulu.
2. Kalau pesan singkat/ambigu → cek \`MEMORY.md\` + \`USER.md\` di workspace.

Setelah menjawab tiap turn:
3. Kalau user mengajarkan rule baru ("inget ya", "jangan lagi", "next time", "aturan ini") → segera tulis ke \`memory/<YYYY-MM-DD>-<slug>.md\` pakai Write tool, sebutkan path file-nya di reply.
4. Kalau rule sangat durable & berlaku setiap session → append ke \`MEMORY.md\` lewat \`/remember <rule>\` atau Edit langsung.

LARANGAN KERAS:
- Jangan pernah klaim "aku catat / sudah kusimpan / saved to memory" tanpa Write/Edit/Skill call yang BENAR-BENAR mengubah file di turn yang sama.
- Kalau gagal write (no tool / permission), bilang jujur: "aku belum bisa persist ini sekarang".

Active memory sub-agent (plugin) sudah inject recall sebelum reply. Tugas kamu: gunakan recall itu + tulis lesson baru saat user ajarkan.
<!-- aoc:memory-protocol:end -->
`;

const MEMORY_TEMPLATE = (name) => `# MEMORY.md — ${name}'s Long-Term Memory

Core rules. Always loaded into your context. Keep concise.

## Self-correction protocol

Kalau bilang "aku catat" / "sudah kusimpan" / "akan kuingat" / "saved to memory":
- WAJIB eksekusi tool persistensi di turn yang sama (Write, Edit, atau \`/remember\` command).
- Kalau tidak ada tool persistensi yang tersedia, bilang jujur: "aku belum bisa persist ini, tolong reminder lagi nanti".
- JANGAN klaim sukses tanpa bukti file/record berubah. Ini hard rule — Rheyno/user explicitly minta ini.

## How to persist things

| User intent | Tool | Result |
|---|---|---|
| "Inget rule ini" / "catat dong" | \`/remember <rule>\` (slash command) | Append to this file |
| "Bottle workflow ini" | \`agent-skill-create.sh\` (aoc-self) | New personal skill |
| Lesson learned dari kesalahan | Write to \`workspace/memory/YYYY-MM-DD-<slug>.md\` | qmd auto-indexes |

## Rules

_(\`/remember\` will append entries here under dated headings. Manual edits also fine.)_
`;

function ensureDreamingEnabled(cfgPath, { frequency = DREAMING_DEFAULT_FREQUENCY } = {}) {
  const cfg = readJsonSafe(cfgPath);
  if (!cfg) return false;
  let changed = false;

  cfg.plugins = cfg.plugins || {};
  cfg.plugins.entries = cfg.plugins.entries || {};
  const mc = cfg.plugins.entries['memory-core'] = cfg.plugins.entries['memory-core'] || {};
  mc.config = mc.config || {};
  mc.config.dreaming = mc.config.dreaming || {};
  if (mc.config.dreaming.enabled !== true) {
    mc.config.dreaming.enabled = true;
    changed = true;
  }
  if (!mc.config.dreaming.frequency) {
    mc.config.dreaming.frequency = frequency;
    changed = true;
  }

  if (changed) fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf-8');
  return changed;
}

function _agentIdsFromConfig(cfg) {
  const list = (cfg && cfg.agents && Array.isArray(cfg.agents.list)) ? cfg.agents.list : [];
  return list.map(a => a && a.id).filter(Boolean);
}

function ensureActiveMemoryEnabled(cfgPath) {
  const cfg = readJsonSafe(cfgPath);
  if (!cfg) return false;
  let changed = false;

  cfg.plugins = cfg.plugins || {};
  cfg.plugins.entries = cfg.plugins.entries || {};
  const am = cfg.plugins.entries['active-memory'] = cfg.plugins.entries['active-memory'] || {};

  if (am.enabled !== true) { am.enabled = true; changed = true; }
  am.config = am.config || {};

  // Sync agent list with current openclaw.json agents.list. Merge — do not
  // remove agents an operator may have manually added.
  const currentIds = _agentIdsFromConfig(cfg);
  const existingAgents = Array.isArray(am.config.agents) ? am.config.agents : [];
  const merged = Array.from(new Set([...existingAgents, ...currentIds]));
  if (merged.length !== existingAgents.length
      || merged.some((id, i) => existingAgents[i] !== id)) {
    am.config.agents = merged;
    changed = true;
  }

  // Apply each default only if the key is missing (don't clobber operator tuning).
  for (const [k, v] of Object.entries(ACTIVE_MEMORY_DEFAULTS)) {
    if (k === 'enabled' || k === 'agents') continue;
    if (am.config[k] === undefined) {
      am.config[k] = v;
      changed = true;
    }
  }

  if (changed) fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf-8');
  return changed;
}

function injectSoulMemoryProtocol(workspacePath) {
  const file = path.join(workspacePath, 'SOUL.md');
  if (!fs.existsSync(file)) return false;
  const current = fs.readFileSync(file, 'utf-8');
  if (current.includes('<!-- aoc:memory-protocol:start -->')) return false;
  const next = current.trimEnd() + '\n' + SOUL_MEMORY_PROTOCOL_BLOCK + '\n';
  fs.writeFileSync(file, next, 'utf-8');
  return true;
}

function ensureRecallStore(workspacePath) {
  const dir = path.join(workspacePath, 'memory', '.dreams');
  const file = path.join(dir, 'short-term-recall.json');
  if (fs.existsSync(file)) return false;
  fs.mkdirSync(dir, { recursive: true });
  const nowIso = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    entries: {},
    updatedAt: nowIso,
  }, null, 2), 'utf-8');
  return true;
}

const DEFAULT_MEMORY_RE = /^# MEMORY\.md.*\n\n_Nothing here yet.*?\._\n*$/;

function seedMemoryTemplate(workspacePath, agentName) {
  const file = path.join(workspacePath, 'MEMORY.md');
  let current = '';
  if (fs.existsSync(file)) {
    current = fs.readFileSync(file, 'utf-8');
    if (!DEFAULT_MEMORY_RE.test(current.trim() + '\n')) {
      return false; // user has customized it, don't overwrite
    }
  }
  fs.writeFileSync(file, MEMORY_TEMPLATE(agentName || 'this agent'), 'utf-8');
  return true;
}

/**
 * Apply all three bootstraps for a single agent.
 * @param {object} opts
 * @param {string} opts.cfgPath      — path to user's openclaw.json (admin or per-user)
 * @param {string} opts.workspacePath — agent's workspace dir
 * @param {string} [opts.agentName]  — for MEMORY.md heading
 */
function bootstrapAgentMemory({ cfgPath, workspacePath, agentName }) {
  const result = {
    configChanged: false,
    activeMemoryChanged: false,
    recallCreated: false,
    memorySeeded: false,
    soulPatched: false,
  };
  try { result.configChanged = ensureDreamingEnabled(cfgPath); }
  catch (e) { console.warn(`[memory-bootstrap] dreaming patch failed for ${cfgPath}: ${e.message}`); }
  try { result.activeMemoryChanged = ensureActiveMemoryEnabled(cfgPath); }
  catch (e) { console.warn(`[memory-bootstrap] active-memory patch failed for ${cfgPath}: ${e.message}`); }
  try { result.recallCreated = ensureRecallStore(workspacePath); }
  catch (e) { console.warn(`[memory-bootstrap] recall store create failed for ${workspacePath}: ${e.message}`); }
  try { result.memorySeeded = seedMemoryTemplate(workspacePath, agentName); }
  catch (e) { console.warn(`[memory-bootstrap] memory seed failed for ${workspacePath}: ${e.message}`); }
  try { result.soulPatched = injectSoulMemoryProtocol(workspacePath); }
  catch (e) { console.warn(`[memory-bootstrap] soul patch failed for ${workspacePath}: ${e.message}`); }
  return result;
}

module.exports = {
  DREAMING_DEFAULT_FREQUENCY,
  ACTIVE_MEMORY_DEFAULTS,
  SOUL_MEMORY_PROTOCOL_BLOCK,
  ensureDreamingEnabled,
  ensureActiveMemoryEnabled,
  ensureRecallStore,
  seedMemoryTemplate,
  injectSoulMemoryProtocol,
  bootstrapAgentMemory,
  MEMORY_TEMPLATE,
};
