'use strict';
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { OPENCLAW_HOME, OPENCLAW_WORKSPACE, AGENTS_DIR, getUserHome, readJsonSafe } = require('../config.cjs');

function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

// ── Multi-tenant home resolution ─────────────────────────────────────────────

function _ownerOf(agentId) {
  try {
    const owner = require('../db.cjs').getAgentOwner(agentId);
    return owner == null ? null : Number(owner);
  } catch { return null; }
}
function homeFor(agentId) {
  const o = _ownerOf(agentId);
  return o == null || o === 1 ? OPENCLAW_HOME : getUserHome(o);
}
function workspaceFor(agentId) {
  const o = _ownerOf(agentId);
  return o == null || o === 1 ? OPENCLAW_WORKSPACE : path.join(getUserHome(o), 'workspace');
}
function agentsDirFor(agentId) {
  const o = _ownerOf(agentId);
  return o == null || o === 1 ? AGENTS_DIR : path.join(getUserHome(o), 'agents');
}
/** Resolve openclaw.json path for a given userId (optional). Falls back to admin. */
function configPathForUser(userId) {
  if (userId == null || Number(userId) === 1) return path.join(OPENCLAW_HOME, 'openclaw.json');
  return path.join(getUserHome(userId), 'openclaw.json');
}

// ── Frontmatter + dir scanning ───────────────────────────────────────────────

/**
 * Parse SKILL.md frontmatter (YAML between --- lines).
 * Returns { name, description, metadata } or null.
 */
function parseSkillFrontmatter(content) {
  if (!content) return null;
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;

  const fm = match[1];
  const result = { name: '', description: '', metadata: null };

  const nameMatch = fm.match(/^name:\s*(.+)$/m);
  if (nameMatch) result.name = nameMatch[1].trim();

  const descMatch = fm.match(/^description:\s*(.+)$/m);
  if (descMatch) result.description = descMatch[1].trim();

  const metaMatch = fm.match(/^metadata:\s*(\{[\s\S]*?\})$/m);
  if (metaMatch) {
    try { result.metadata = JSON.parse(metaMatch[1]); } catch {}
  }

  return result;
}

/**
 * Scan a directory for skill folders (each must contain SKILL.md).
 */
function scanSkillDir(dirPath) {
  const skills = [];
  if (!dirPath || !fs.existsSync(dirPath)) return skills;

  let entries;
  try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch { return skills; }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillMdPath = path.join(dirPath, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) continue;

    try {
      const content = fs.readFileSync(skillMdPath, 'utf-8');
      const fm = parseSkillFrontmatter(content);
      skills.push({
        slug: entry.name,
        name: fm?.name || entry.name,
        description: fm?.description || '',
        metadata: fm?.metadata || null,
        path: path.join(dirPath, entry.name),
        skillMdPath,
      });
    } catch {}
  }
  return skills;
}

// ── Agent skill queries ───────────────────────────────────────────────────────

/**
 * Get all skills visible to an agent, from all 6 source levels.
 */
function getAgentSkills(agentId) {
  const home   = homeFor(agentId);
  const config = readJsonSafe(path.join(home, 'openclaw.json')) || {};

  const agentList   = config.agents?.list || [];
  const agentConfig = agentList.find(a => a.id === agentId);
  if (!agentConfig) throw new Error(`Agent "${agentId}" not found`);

  const agentWorkspace   = expandHome(agentConfig.workspace || workspaceFor(agentId));
  const skillEntries     = config.skills?.entries || {};
  const extraDirs        = config.skills?.load?.extraDirs || [];

  const agentAllowlist    = agentConfig.skills;
  const defaultAllowlist  = config.agents?.defaults?.skills;
  const effectiveAllowlist = agentAllowlist !== undefined ? agentAllowlist : defaultAllowlist;
  const hasAllowlist       = agentAllowlist !== undefined;

  const sources = [
    { id: 'workspace',     label: 'Workspace',     dir: path.join(agentWorkspace, 'skills') },
    { id: 'project-agent', label: 'Project Agent', dir: path.join(agentWorkspace, '.agents', 'skills') },
    { id: 'personal',      label: 'Personal',      dir: path.join(process.env.HOME || '~', '.agents', 'skills') },
    { id: 'managed',       label: 'Managed',       dir: path.join(OPENCLAW_HOME, 'skills') }, // shared admin-managed dir, intentionally always OPENCLAW_HOME
    ...extraDirs.map((d, i) => ({
      id:    `extra-${i}`,
      label: `Extra (${path.basename(d)})`,
      dir:   d.replace(/^~/, process.env.HOME || '~'),
    })),
  ];

  const seen = new Set();
  const allSkills = [];

  for (const source of sources) {
    const skills = scanSkillDir(source.dir);
    for (const skill of skills) {
      if (seen.has(skill.name)) continue;
      seen.add(skill.name);

      const entry          = skillEntries[skill.name] || skillEntries[skill.slug] || {};
      const globallyEnabled = entry.enabled !== false;

      let inAllowlist = true;
      if (Array.isArray(effectiveAllowlist)) {
        inAllowlist = effectiveAllowlist.includes(skill.name) || effectiveAllowlist.includes(skill.slug);
      }

      const emoji = skill.metadata?.openclaw?.emoji || null;

      allSkills.push({
        name: skill.name,
        slug: skill.slug,
        description: skill.description,
        source: source.id,
        sourceLabel: source.label,
        path: skill.path,
        enabled: globallyEnabled && inAllowlist,
        globallyEnabled,
        inAllowlist,
        hasAllowlist,
        allowed: inAllowlist,
        emoji,
        hasApiKey: !!(entry.apiKey),
        hasEnv: !!(entry.env && Object.keys(entry.env).length > 0),
        editable: ['workspace', 'project-agent', 'personal', 'managed'].includes(source.id),
      });
    }
  }

  return allSkills;
}

/**
 * Read a skill's SKILL.md content.
 */
function getSkillFile(agentId, skillName) {
  const skills = getAgentSkills(agentId);
  const skill  = skills.find(s => s.name === skillName || s.slug === skillName);
  if (!skill) throw new Error(`Skill "${skillName}" not found for agent "${agentId}"`);

  const skillMdPath = path.join(skill.path, 'SKILL.md');
  let content = '';
  try { content = fs.readFileSync(skillMdPath, 'utf-8'); } catch {}

  return { name: skill.name, slug: skill.slug, content, path: skillMdPath, source: skill.source, editable: skill.editable };
}

/**
 * Save/overwrite a skill's SKILL.md content.
 */
function saveSkillFile(agentId, skillName, content) {
  const skills = getAgentSkills(agentId);
  const skill  = skills.find(s => s.name === skillName || s.slug === skillName);
  if (!skill) throw new Error(`Skill "${skillName}" not found`);
  if (!skill.editable) throw new Error(`Skill "${skillName}" is not editable (source: ${skill.source})`);

  const skillMdPath = path.join(skill.path, 'SKILL.md');
  fs.writeFileSync(skillMdPath, content, 'utf-8');

  return { name: skill.name, slug: skill.slug, path: skillMdPath };
}

/**
 * Create a new skill folder + SKILL.md.
 * scope: 'workspace' | 'agent' | 'global'
 */
function createSkill(agentId, skillSlug, scope, content) {
  const home        = homeFor(agentId);
  const config      = readJsonSafe(path.join(home, 'openclaw.json')) || {};
  const agentConfig = (config.agents?.list || []).find(a => a.id === agentId);
  if (!agentConfig) throw new Error(`Agent "${agentId}" not found`);

  const agentWorkspace = expandHome(agentConfig.workspace || workspaceFor(agentId));

  let targetDir;
  switch (scope) {
    case 'workspace': targetDir = path.join(agentWorkspace, 'skills', skillSlug); break;
    case 'agent':     targetDir = path.join(agentWorkspace, '.agents', 'skills', skillSlug); break;
    case 'global':    targetDir = path.join(OPENCLAW_HOME, 'skills', skillSlug); break; // shared admin-managed dir
    default:          throw new Error(`Invalid scope: ${scope}`);
  }

  if (fs.existsSync(targetDir)) throw new Error(`Skill folder already exists: ${targetDir}`);

  fs.mkdirSync(targetDir, { recursive: true });
  const skillMdPath = path.join(targetDir, 'SKILL.md');
  fs.writeFileSync(skillMdPath, content, 'utf-8');

  return { slug: skillSlug, path: targetDir, skillMdPath, scope };
}

/**
 * Toggle a skill ON or OFF for a specific agent.
 * Controls ONLY the agents.list[].skills allowlist (SKILL.md context injection).
 */
function toggleAgentSkill(agentId, skillName, enabled) {
  const configPath = path.join(homeFor(agentId), 'openclaw.json');
  const config = readJsonSafe(configPath);
  if (!config) throw new Error('Cannot read openclaw.json');

  if (!config.agents) config.agents = {};
  if (!config.agents.list) config.agents.list = [];

  const agentIdx = config.agents.list.findIndex(a => a.id === agentId);
  if (agentIdx === -1) throw new Error(`Agent "${agentId}" not found`);

  const agentConfig       = config.agents.list[agentIdx];
  const currentAllowlist  = agentConfig.skills;

  if (enabled) {
    if (Array.isArray(currentAllowlist)) {
      if (!currentAllowlist.includes(skillName)) agentConfig.skills = [...currentAllowlist, skillName];
    } else {
      // No allowlist yet → initialize with this skill (ensures skills: [] always exists)
      agentConfig.skills = [skillName];
    }
  } else {
    if (Array.isArray(currentAllowlist)) {
      agentConfig.skills = currentAllowlist.filter(s => s !== skillName);
    } else {
      // No allowlist yet → agent was unrestricted → build explicit allowlist without this skill
      const allSkills = getAgentSkills(agentId);
      agentConfig.skills = allSkills
        .filter(s => s.globallyEnabled && s.name !== skillName && s.slug !== skillName)
        .map(s => s.name);
    }
  }

  config.agents.list[agentIdx] = agentConfig;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

  return { agentId, skillName, enabled, allowlist: agentConfig.skills };
}

/**
 * Get all skills across all scopes and agents, with per-agent assignment info.
 * Used by the global Skills Library page.
 * @param {number|null} [userId] - optional user ID for per-tenant scoping (admin = 1)
 */
function getAllSkills(userId) {
  const cfgPath = configPathForUser(userId);
  const config = readJsonSafe(cfgPath) || {};
  const agentList = config.agents?.list || [];
  const skillEntries = config.skills?.entries || {};
  const extraDirs = config.skills?.load?.extraDirs || [];

  // Collect unique source directories across all agents' workspaces
  const processedDirKeys = new Set();
  const sources = [];

  function addSource(id, label, dir) {
    const resolved = (dir || '').replace(/^~/, process.env.HOME || '~');
    if (!resolved) return;
    const key = `${id}::${resolved}`;
    if (processedDirKeys.has(key)) return;
    processedDirKeys.add(key);
    sources.push({ id, label, dir: resolved });
  }

  // Resolve the default workspace for the effective user
  const effectiveUserId = userId ?? 1;
  const effectiveWorkspace = Number(effectiveUserId) === 1
    ? OPENCLAW_WORKSPACE
    : path.join(getUserHome(effectiveUserId), 'workspace');

  // Scan each agent's workspace dirs
  for (const agent of agentList) {
    const ws = expandHome(agent.workspace || effectiveWorkspace);
    if (ws) {
      addSource('workspace', 'Workspace', path.join(ws, 'skills'));
      addSource('project-agent', 'Project Agent', path.join(ws, '.agents', 'skills'));
    }
  }
  // Always include default workspace for effective user
  if (effectiveWorkspace) {
    addSource('workspace', 'Workspace', path.join(effectiveWorkspace, 'skills'));
    addSource('project-agent', 'Project Agent', path.join(effectiveWorkspace, '.agents', 'skills'));
  }
  addSource('personal', 'Personal', path.join(process.env.HOME || '~', '.agents', 'skills'));
  addSource('managed', 'Managed', path.join(OPENCLAW_HOME, 'skills')); // shared admin-managed dir
  for (const [i, d] of extraDirs.entries()) {
    addSource(`extra-${i}`, `Extra (${path.basename(d)})`, d);
  }

  // Scan all dirs, deduplicate by NAME (same logic as getAgentSkills)
  // We use name-based dedup so that per-agent lookups (which may return
  // the same skill from a different workspace path) still match correctly.
  const seenNames = new Set();
  const skillsByName = new Map();

  for (const source of sources) {
    const skills = scanSkillDir(source.dir);
    for (const skill of skills) {
      const key = skill.name || skill.slug;
      if (seenNames.has(key)) continue;
      seenNames.add(key);

      const entry = skillEntries[skill.name] || skillEntries[skill.slug] || {};
      const emoji = skill.metadata?.openclaw?.emoji || null;
      skillsByName.set(key, {
        name: skill.name,
        slug: skill.slug,
        description: skill.description,
        source: source.id,
        sourceLabel: source.label,
        path: skill.path,
        emoji,
        hasApiKey: !!(entry.apiKey),
        hasEnv: !!(entry.env && Object.keys(entry.env).length > 0),
        editable: ['workspace', 'project-agent', 'personal', 'managed'].includes(source.id),
        globallyEnabled: entry.enabled !== false,
        agentAssignments: [],
      });
    }
  }

  // Build agents summary — resolve name/emoji from identity field same as detail.cjs
  const agents = agentList.map(a => ({
    id: a.id,
    name: a.identity?.name || a.name || a.id,
    emoji: a.identity?.emoji || (a.id === 'main' ? '🤡' : '🤖'),
  }));

  // Compute per-agent assignments, matched by skill name (not path)
  for (const agentDef of agentList) {
    const agentName = agentDef.identity?.name || agentDef.name || agentDef.id;
    const agentEmoji = agentDef.identity?.emoji || (agentDef.id === 'main' ? '🤡' : '🤖');
    try {
      const agentSkills = getAgentSkills(agentDef.id);
      for (const skill of agentSkills) {
        const key = skill.name || skill.slug;
        const skillData = skillsByName.get(key);
        if (skillData) {
          skillData.agentAssignments.push({
            agentId: agentDef.id,
            agentName,
            agentEmoji,
            enabled: skill.enabled,
            inAllowlist: skill.inAllowlist,
            hasAllowlist: skill.hasAllowlist,
          });
        }
      }
    } catch {}
  }

  return { skills: Array.from(skillsByName.values()), agents };
}

/**
 * Read a skill's SKILL.md directly by slug, without requiring an agent context.
 * Used by the global Skills Library page editor.
 */
function getSkillFileBySlug(slug) {
  const { skills } = getAllSkills();
  const skill = skills.find(s => s.slug === slug || s.name === slug);
  if (!skill) throw new Error(`Skill "${slug}" not found`);
  const skillMdPath = path.join(skill.path, 'SKILL.md');
  let content = '';
  try { content = fs.readFileSync(skillMdPath, 'utf-8'); } catch {}
  return {
    name: skill.name,
    slug: skill.slug,
    content,
    path: skillMdPath,
    source: skill.source,
    sourceLabel: skill.sourceLabel,
    editable: skill.editable,
  };
}

/**
 * Save a skill's SKILL.md directly by slug, without requiring an agent context.
 */
function saveSkillFileBySlug(slug, content) {
  const { skills } = getAllSkills();
  const skill = skills.find(s => s.slug === slug || s.name === slug);
  if (!skill) throw new Error(`Skill "${slug}" not found`);
  if (!skill.editable) throw new Error(`Skill "${slug}" is not editable (source: ${skill.source})`);
  const skillMdPath = path.join(skill.path, 'SKILL.md');
  fs.writeFileSync(skillMdPath, content, 'utf-8');
  return { name: skill.name, slug: skill.slug, path: skillMdPath };
}

/**
 * Create a new skill globally, using the first available agent's workspace
 * or the managed (openclaw home) dir for global scope.
 * scope: 'workspace' | 'agent' | 'global'
 * @param {number|null} [userId] - optional user ID for per-tenant scoping (admin = 1)
 */
function createGlobalSkill(skillSlug, scope, content, userId) {
  const cfgPath = configPathForUser(userId);
  const config = readJsonSafe(cfgPath) || {};
  const agentList = config.agents?.list || [];

  // Use defaults.workspace or first agent's workspace for workspace/agent scope
  const effectiveUserId = userId ?? 1;
  const effectiveWorkspace = Number(effectiveUserId) === 1
    ? OPENCLAW_WORKSPACE
    : path.join(getUserHome(effectiveUserId), 'workspace');
  const defaultWorkspace = expandHome(config.agents?.defaults?.workspace || effectiveWorkspace);
  const firstAgentWorkspace = agentList[0]
    ? expandHome(agentList[0].workspace || defaultWorkspace)
    : defaultWorkspace;

  let targetDir;
  switch (scope) {
    case 'workspace': targetDir = path.join(firstAgentWorkspace, 'skills', skillSlug); break;
    case 'agent':     targetDir = path.join(firstAgentWorkspace, '.agents', 'skills', skillSlug); break;
    case 'global':    targetDir = path.join(OPENCLAW_HOME, 'skills', skillSlug); break; // shared admin-managed dir
    default:          throw new Error(`Invalid scope: ${scope}`);
  }

  if (fs.existsSync(targetDir)) throw new Error(`Skill folder already exists: ${targetDir}`);

  fs.mkdirSync(targetDir, { recursive: true });
  const skillMdPath = path.join(targetDir, 'SKILL.md');
  fs.writeFileSync(skillMdPath, content, 'utf-8');

  return { slug: skillSlug, path: targetDir, skillMdPath, scope };
}

/**
 * Delete a skill directory for a specific agent.
 * Only allows deletion of 'workspace' source skills (agent-owned).
 * Optionally removes from agent's skills allowlist in openclaw.json.
 */
function deleteAgentSkill(agentId, skillName) {
  const skills = getAgentSkills(agentId);
  const skill = skills.find(s => s.name === skillName || s.slug === skillName);
  if (!skill) throw new Error(`Skill "${skillName}" not found for agent "${agentId}"`);
  if (skill.source !== 'workspace') {
    throw new Error(`Cannot delete skill "${skillName}" — only workspace skills can be deleted from agent detail (source: ${skill.source})`);
  }
  // skill.path is the SKILL.md path, skill dir is its parent
  const skillDir = path.dirname(skill.path);
  fs.rmSync(skillDir, { recursive: true, force: true });

  // Also remove from agent's skills allowlist if present
  const configPath = path.join(homeFor(agentId), 'openclaw.json');
  const config = readJsonSafe(configPath);
  if (config) {
    const agentList = config.agents?.list || [];
    const agentConfig = agentList.find(a => a.id === agentId);
    if (agentConfig && Array.isArray(agentConfig.skills)) {
      agentConfig.skills = agentConfig.skills.filter(s => s !== skillName && s !== skill.slug);
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    }
  }

  return { ok: true, deleted: skillName, path: skillDir };
}

/**
 * Delete a skill by slug from the global library.
 * Resolves the skill path without agent context (like saveSkillFileBySlug).
 * Only allows deleting editable skills.
 */
function deleteSkillBySlug(slug) {
  const skill = getSkillFileBySlug(slug);
  if (!skill) throw new Error(`Skill "${slug}" not found`);
  if (!skill.editable) throw new Error(`Skill "${slug}" is not deletable (source: ${skill.source})`);
  const skillDir = path.dirname(skill.path);
  fs.rmSync(skillDir, { recursive: true, force: true });
  return { ok: true, deleted: slug, path: skillDir };
}

/**
 * Ensure every agent in openclaw.json has a `skills: []` field.
 * Safe to call on startup — only writes if something is missing.
 * @param {number|null} [userId] - optional user ID for per-tenant scoping (admin = 1)
 */
function ensureAgentSkillsFields(userId) {
  const configPath = configPathForUser(userId);
  const config = readJsonSafe(configPath);
  if (!config?.agents?.list) return;

  let dirty = false;
  for (const agent of config.agents.list) {
    if (!Array.isArray(agent.skills)) {
      agent.skills = [];
      dirty = true;
      console.log(`[skills] Added missing skills:[] to agent "${agent.id}"`);
    }
  }

  if (dirty) {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    console.log('[skills] openclaw.json updated — skills field backfilled for existing agents');
  }
}

// ── Skill directory tree ──────────────────────────────────────────────────────

const TEXT_EXTENSIONS = new Set([
  '.md', '.txt', '.sh', '.py', '.js', '.ts', '.rb', '.lua', '.bash', '.zsh',
  '.fish', '.json', '.yaml', '.yml', '.toml', '.env', '.cfg', '.conf', '.ini',
]);

function isTextFile(filename) {
  return TEXT_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

/**
 * Recursively list all files in a skill directory.
 * Returns a tree structure: [ { name, path, type: 'file'|'dir', children?, size, ext } ]
 */
function buildDirTree(dirPath, relativePath = '') {
  const entries = [];
  let items;
  try { items = fs.readdirSync(dirPath, { withFileTypes: true }); } catch { return entries; }

  for (const item of items.sort((a, b) => {
    // Dirs first, then files. Alphabetical within each group.
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  })) {
    const rel = relativePath ? `${relativePath}/${item.name}` : item.name;
    const abs = path.join(dirPath, item.name);
    if (item.isDirectory()) {
      entries.push({
        name: item.name,
        path: rel,
        type: 'dir',
        children: buildDirTree(abs, rel),
      });
    } else {
      const stat = fs.statSync(abs);
      entries.push({
        name: item.name,
        path: rel,
        type: 'file',
        size: stat.size,
        ext: path.extname(item.name).toLowerCase(),
        isText: isTextFile(item.name),
      });
    }
  }
  return entries;
}

/**
 * Get the full directory tree of a skill by slug.
 */
function getSkillDirTree(slug) {
  const { skills } = getAllSkills();
  const skill = skills.find(s => s.slug === slug || s.name === slug);
  if (!skill) throw new Error(`Skill "${slug}" not found`);
  const skillDir = skill.path;
  return {
    slug: skill.slug,
    name: skill.name,
    source: skill.source,
    editable: skill.editable,
    skillDir,
    tree: buildDirTree(skillDir),
  };
}

/**
 * Read any file within a skill directory by relative path.
 * Security: ensures the resolved path is within skillDir.
 */
function getSkillAnyFile(slug, relativePath) {
  const { skills } = getAllSkills();
  const skill = skills.find(s => s.slug === slug || s.name === slug);
  if (!skill) throw new Error(`Skill "${slug}" not found`);
  const skillDir = skill.path;

  const resolved = path.resolve(skillDir, relativePath);
  if (!resolved.startsWith(path.resolve(skillDir))) {
    throw new Error('Path traversal not allowed');
  }
  if (!fs.existsSync(resolved)) throw new Error(`File not found: ${relativePath}`);

  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) throw new Error(`Path is a directory: ${relativePath}`);
  if (!isTextFile(relativePath)) throw new Error(`Binary files are not readable via this API`);

  const content = fs.readFileSync(resolved, 'utf-8');
  return {
    slug: skill.slug,
    path: relativePath,
    content,
    size: stat.size,
    editable: skill.editable,
  };
}

/**
 * Save any text file within a skill directory by relative path.
 */
function saveSkillAnyFile(slug, relativePath, content) {
  const { skills } = getAllSkills();
  const skill = skills.find(s => s.slug === slug || s.name === slug);
  if (!skill) throw new Error(`Skill "${slug}" not found`);
  if (!skill.editable) throw new Error(`Skill "${slug}" is read-only (source: ${skill.source})`);

  const skillDir = skill.path;
  const resolved = path.resolve(skillDir, relativePath);
  if (!resolved.startsWith(path.resolve(skillDir))) throw new Error('Path traversal not allowed');

  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, content, 'utf-8');
  return { slug: skill.slug, path: relativePath, size: content.length };
}

module.exports = {
  parseSkillFrontmatter,
  scanSkillDir,
  getAgentSkills,
  getAllSkills,
  getSkillFile,
  getSkillFileBySlug,
  saveSkillFile,
  saveSkillFileBySlug,
  createSkill,
  createGlobalSkill,
  toggleAgentSkill,
  deleteAgentSkill,
  deleteSkillBySlug,
  ensureAgentSkillsFields,
  getSkillDirTree,
  getSkillAnyFile,
  saveSkillAnyFile,
};
