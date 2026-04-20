'use strict';
/**
 * skills-install.cjs
 * ClawHub skill fetch, security scan, and install logic.
 *
 * Download API: https://wry-manatee-359.convex.site/api/v1/download?slug={slug}
 * Returns a ZIP containing the skill directory contents (SKILL.md, _meta.json, hooks/, etc.)
 */

const fs   = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { OPENCLAW_HOME, OPENCLAW_WORKSPACE, AGENTS_DIR, readJsonSafe } = require('./config.cjs');

const DOWNLOAD_BASE = 'https://wry-manatee-359.convex.site/api/v1/download';

// ─── Danger patterns for security scanning ───────────────────────────────────

const DANGER_PATTERNS = [
  { pattern: /curl\s+[^\n|]*\|\s*(ba)?sh/i,    label: 'curl pipe to shell' },
  { pattern: /wget\s+[^\n|]*\|\s*(ba)?sh/i,    label: 'wget pipe to shell' },
  { pattern: /\$\s*\(\s*curl/i,                 label: 'command substitution with curl' },
  { pattern: /\$\s*\(\s*wget/i,                 label: 'command substitution with wget' },
  { pattern: /base64\s+(--decode|-d)\s*\|/i,   label: 'base64 decode pipe' },
  { pattern: /python[23]?\s+-c\s+['"]import\s+os/i, label: 'python inline OS commands' },
  { pattern: /eval\s*\$?\s*\(/,                 label: 'eval()' },
  { pattern: /rm\s+-rf\s+\/(?!tmp)/i,           label: 'rm -rf on root paths' },
  { pattern: /sudo\s/,                          label: 'sudo usage' },
  { pattern: /chmod\s+[0-9]*[2367][0-9]*\s+\//,label: 'chmod on system paths' },
  { pattern: /\/etc\/passwd|\/etc\/shadow/,     label: 'access to /etc/passwd or /etc/shadow' },
  { pattern: /ssh-add|\.ssh\/id_/,              label: 'SSH key access' },
  { pattern: /OPENAI_API_KEY|ANTHROPIC_API_KEY/,label: 'credential variable access' },
];

const SUSPICIOUS_PATTERNS = [
  { pattern: /https?:\/\/(?!clawhub\.ai|docs\.openclaw\.ai|openclaw\.ai|github\.com|npmjs\.com|pypi\.org|unpkg\.com|cdn\.jsdelivr\.net)[a-z0-9.-]+\/[^\s"')]+/gi, label: 'external URL fetch' },
  { pattern: /process\.env\.[A-Z_]{3,}/g,      label: 'process.env access' },
  { pattern: /require\s*\(\s*['"]child_process['"]\s*\)/, label: 'child_process require' },
  { pattern: /require\s*\(\s*['"]fs['"]\s*\)/,  label: 'fs module require' },
];

// ─── URL parsing ──────────────────────────────────────────────────────────────

/**
 * Extract slug from a ClawHub URL.
 * Handles:
 *   https://clawhub.ai/pskoett/self-improving-agent  → self-improving-agent
 *   https://clawhub.ai/self-improving-agent          → self-improving-agent
 *   self-improving-agent                             → self-improving-agent (plain slug)
 */
function parseClawHubSlug(input) {
  const trimmed = input.trim();
  try {
    const url = new URL(trimmed);
    if (url.hostname !== 'clawhub.ai') {
      throw new Error('Only clawhub.ai URLs are supported');
    }
    const parts = url.pathname.replace(/^\//, '').split('/').filter(Boolean);
    if (parts.length === 0) throw new Error('Could not extract skill slug from URL');
    // Last segment is the slug (handles /author/slug and /slug)
    return parts[parts.length - 1];
  } catch (e) {
    if (e.message.includes('Only clawhub') || e.message.includes('Could not')) throw e;
    // Not a URL — treat as plain slug
    if (/^[a-z0-9-]+$/.test(trimmed)) return trimmed;
    throw new Error('Invalid ClawHub URL or slug');
  }
}

// ─── Download & parse ZIP ─────────────────────────────────────────────────────

async function downloadSkillZip(slug) {
  const url = `${DOWNLOAD_BASE}?slug=${encodeURIComponent(slug)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'AOC-Dashboard/1.0' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    throw new Error(`ClawHub download failed: ${res.status} ${res.statusText}`);
  }
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('zip') && !ct.includes('octet-stream')) {
    throw new Error(`Unexpected content-type from ClawHub: ${ct}`);
  }
  const buf = await res.arrayBuffer();
  return Buffer.from(buf);
}

function parseZip(buffer) {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();

  const files = {};
  for (const entry of entries) {
    if (!entry.isDirectory) {
      files[entry.entryName] = () => entry.getData().toString('utf-8');
    }
  }
  return { zip, files };
}

// ─── Security scan ────────────────────────────────────────────────────────────

function scanText(content, filename) {
  const issues = [];
  for (const { pattern, label } of DANGER_PATTERNS) {
    if (pattern.test(content)) {
      issues.push({ level: 'danger', label, file: filename });
    }
    pattern.lastIndex = 0;
  }
  for (const { pattern, label } of SUSPICIOUS_PATTERNS) {
    const matches = content.match(pattern);
    if (matches && matches.length > 0) {
      issues.push({ level: 'warn', label, file: filename, count: matches.length });
    }
    if (pattern.global) pattern.lastIndex = 0;
  }
  return issues;
}

function runSecurityScan(files) {
  const issues = [];
  const scanned = [];

  for (const [name, getContent] of Object.entries(files)) {
    // Only scan text-like files
    const ext = path.extname(name).toLowerCase();
    const scannable = ['.md', '.js', '.ts', '.sh', '.py', '.rb', '.bash', '.zsh', '.fish', '.lua', '.json', ''].includes(ext);
    if (!scannable) continue;
    try {
      const content = getContent();
      scanned.push(name);
      issues.push(...scanText(content, name));
    } catch { /* skip unreadable */ }
  }

  const dangerCount  = issues.filter(i => i.level === 'danger').length;
  const warnCount    = issues.filter(i => i.level === 'warn').length;

  let rating, summary;
  if (dangerCount > 0) {
    rating = 'danger';
    summary = `${dangerCount} dangerous pattern${dangerCount > 1 ? 's' : ''} found — review before installing`;
  } else if (warnCount > 2) {
    rating  = 'warn';
    summary = `${warnCount} suspicious patterns found — review recommended`;
  } else if (warnCount > 0) {
    rating  = 'info';
    summary = `${warnCount} minor note${warnCount > 1 ? 's' : ''} — likely benign`;
  } else {
    rating  = 'clean';
    summary = 'No suspicious patterns detected';
  }

  return { rating, summary, issues, scannedFiles: scanned };
}

// ─── Skill metadata ───────────────────────────────────────────────────────────

function parseSkillMdFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};
  const block = match[1];
  const result = {};
  for (const line of block.split('\n')) {
    const kv = line.match(/^([a-zA-Z_-]+):\s*(.+)$/);
    if (kv) result[kv[1].trim()] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return result;
}

// ─── Preview (no extraction) ──────────────────────────────────────────────────

async function previewSkill(urlOrSlug) {
  const slug = parseClawHubSlug(urlOrSlug);
  const buffer = await downloadSkillZip(slug);
  const { files } = parseZip(buffer);

  // Read SKILL.md
  const skillMdContent = files['SKILL.md'] ? files['SKILL.md']() : null;
  if (!skillMdContent) throw new Error('ZIP does not contain SKILL.md');
  const frontmatter = parseSkillMdFrontmatter(skillMdContent);

  // Read _meta.json if present
  let meta = {};
  if (files['_meta.json']) {
    try { meta = JSON.parse(files['_meta.json']()); } catch { /* ignore */ }
  }

  const security = runSecurityScan(files);

  // List files in ZIP
  const fileList = Object.keys(files).sort();

  return {
    slug,
    name:        frontmatter.name   || meta.name   || slug,
    description: frontmatter.description || meta.description || '',
    version:     meta.version       || frontmatter.version   || null,
    author:      meta.author        || null,
    license:     meta.license       || frontmatter.license   || null,
    emoji:       frontmatter.emoji  || null,
    skillMdContent,
    security,
    fileList,
    // Buffer encoded for install step (avoid re-downloading)
    _bufferB64: buffer.toString('base64'),
  };
}

// ─── Install ──────────────────────────────────────────────────────────────────

/**
 * target:
 *   'global'    → ~/.openclaw/skills/{slug}/
 *   'personal'  → ~/.agents/skills/{slug}/
 *   'project'   → {OPENCLAW_WORKSPACE}/.agents/skills/{slug}/
 *   'workspace' → {OPENCLAW_WORKSPACE}/skills/{slug}/
 *   'agent'     → requires agentId, resolves agent workspace from openclaw.json
 */
function resolveInstallPath(target, slug, agentId) {
  switch (target) {
    case 'global':
      return path.join(OPENCLAW_HOME, 'skills', slug);
    case 'personal': {
      const home = process.env.HOME || process.env.USERPROFILE;
      return path.join(home, '.agents', 'skills', slug);
    }
    case 'project':
      return path.join(OPENCLAW_WORKSPACE, '.agents', 'skills', slug);
    case 'workspace':
      return path.join(OPENCLAW_WORKSPACE, 'skills', slug);
    case 'agent': {
      if (!agentId) throw new Error('agentId required for agent-specific install');
      const config = readJsonSafe(path.join(OPENCLAW_HOME, 'openclaw.json')) || {};
      const agentList = config.agents?.list || (Array.isArray(config.agents) ? config.agents : []);
      const agent = agentList.find(a => a.id === agentId);
      if (!agent) throw new Error(`Agent "${agentId}" not found`);
      const agentWorkspace = agent.workspace
        || path.join(OPENCLAW_HOME, 'agents', agentId, 'workspace');
      return path.join(agentWorkspace, 'skills', slug);
    }
    default:
      throw new Error(`Unknown install target: ${target}`);
  }
}

async function installSkill({ urlOrSlug, target, agentId, bufferB64, overwrite = false }) {
  const slug = parseClawHubSlug(urlOrSlug);
  const installPath = resolveInstallPath(target, slug, agentId);

  const existed = fs.existsSync(installPath);
  if (existed && !overwrite) {
    const err = new Error(`Skill "${slug}" is already installed at ${installPath}`);
    err.code = 'ALREADY_INSTALLED';
    err.slug = slug;
    err.installPath = installPath;
    throw err;
  }

  // Use cached buffer if provided (from preview step), else re-download
  let buffer;
  if (bufferB64) {
    buffer = Buffer.from(bufferB64, 'base64');
  } else {
    buffer = await downloadSkillZip(slug);
  }

  const zip = new AdmZip(buffer);

  if (existed && overwrite) {
    fs.rmSync(installPath, { recursive: true, force: true });
  }
  fs.mkdirSync(installPath, { recursive: true });
  zip.extractAllTo(installPath, true /* overwrite */);

  // Verify SKILL.md was extracted
  if (!fs.existsSync(path.join(installPath, 'SKILL.md'))) {
    fs.rmSync(installPath, { recursive: true, force: true });
    throw new Error('Extracted ZIP did not contain SKILL.md — invalid skill package');
  }

  return {
    ok: true,
    slug,
    path: installPath,
    target,
    updated: existed && overwrite,
  };
}

// ─── Install path labels (for UI) ─────────────────────────────────────────────

function getInstallTargets() {
  const home = process.env.HOME || process.env.USERPROFILE;
  return [
    { value: 'global',    label: 'Global (all agents)',    path: path.join(OPENCLAW_HOME, 'skills') },
    { value: 'personal',  label: 'Personal (~/.agents)',   path: path.join(home, '.agents', 'skills') },
    { value: 'project',   label: 'Project (.agents/skills)', path: path.join(OPENCLAW_WORKSPACE, '.agents', 'skills') },
    { value: 'workspace', label: 'Workspace (skills/)',    path: path.join(OPENCLAW_WORKSPACE, 'skills') },
    { value: 'agent',     label: 'Agent-specific',         path: null },
  ];
}

// ─── SkillsMP ─────────────────────────────────────────────────────────────────

const SKILLSMP_SEARCH = 'https://skillsmp.com/api/v1/skills/search';

/**
 * Search skills on SkillsMP.
 * Returns array of skill objects from the API.
 */
async function skillsmpSearch(query, apiKey) {
  if (!apiKey || !apiKey.startsWith('sk_live_')) {
    throw new Error('Invalid SkillsMP API key. Key must start with sk_live_');
  }

  const url = `${SKILLSMP_SEARCH}?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'User-Agent': 'AOC-Dashboard/1.0',
    },
    signal: AbortSignal.timeout(15000),
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = body?.error?.message || body?.message || `HTTP ${res.status}`;
    if (res.status === 401) throw new Error(`SkillsMP auth failed: ${msg}`);
    throw new Error(`SkillsMP search failed: ${msg}`);
  }

  // Normalize response — SkillsMP may return { success, data: { skills: [] } }
  // or { success, skills: [] } or { items: [] }
  const skills =
    body?.data?.skills ||
    body?.skills ||
    body?.items ||
    body?.results ||
    (Array.isArray(body) ? body : []);

  return skills.map(s => normalizeSkillsmpResult(s));
}

function normalizeSkillsmpResult(s) {
  // Extract GitHub URL — field name may vary
  const githubUrl =
    s.githubUrl || s.github_url || s.repoUrl || s.repo_url ||
    s.sourceUrl || s.source_url || s.url || null;

  // Skill path within repo — where SKILL.md lives
  const repoPath =
    s.repoPath || s.repo_path || s.skillPath || s.skill_path ||
    s.directory || s.dir || s.subPath || s.sub_path ||
    s.folderPath || s.folder_path || s.filePath || s.file_path ||
    // If path ends with SKILL.md, strip that — we want the directory
    (s.path && typeof s.path === 'string' ? s.path.replace(/\/SKILL\.md$/i, '') : null) ||
    null;

  const slug = s.slug || s.name?.toLowerCase().replace(/\s+/g, '-') || s.id || 'unknown';

  return {
    id:          s.id || slug,
    slug,
    name:        s.name || slug,
    description: s.description || s.summary || '',
    author:      s.author || s.owner || s.username || null,
    license:     s.license || null,
    stars:       s.stars || s.starCount || s.star_count || 0,
    version:     s.version || null,
    githubUrl,
    repoPath,
    // Reconstruct raw SKILL.md URL if possible
    skillMdUrl:  buildSkillMdUrl(githubUrl, repoPath),
    tags:        s.tags || s.categories || [],
  };
}

/**
 * Build GitHub raw URL for SKILL.md given repo URL and path.
 * E.g.: https://github.com/user/repo + skills/my-skill
 * → https://raw.githubusercontent.com/user/repo/main/skills/my-skill/SKILL.md
 */
function buildSkillMdUrl(githubUrl, repoPath) {
  if (!githubUrl) return null;
  try {
    const u = new URL(githubUrl);
    if (u.hostname !== 'github.com') return null;
    // Convert github.com/user/repo → raw.githubusercontent.com/user/repo
    const parts = u.pathname.replace(/^\/|\.git$/g, '').split('/');
    if (parts.length < 2) return null;
    const [user, repo] = parts;
    const branch = 'main'; // Try main first
    const skillPath = repoPath ? repoPath.replace(/\/SKILL\.md$/, '').replace(/^\//, '') : '';
    const filePath = skillPath ? `${skillPath}/SKILL.md` : 'SKILL.md';
    return `https://raw.githubusercontent.com/${user}/${repo}/${branch}/${filePath}`;
  } catch {
    return null;
  }
}

/**
 * Derive candidate sub-paths within a repo for a given skill slug.
 * E.g. slug "superpowers-writing-plans" → [
 *   "skills/superpowers-writing-plans",
 *   "skills/writing-plans",          ← strip known prefixes
 *   "superpowers-writing-plans",
 *   "writing-plans",
 * ]
 */
function slugToCandidatePaths(slug) {
  if (!slug) return [];
  const candidates = new Set();
  const clean = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-');

  // 1. Exact slug in common container dirs
  candidates.add(`skills/${clean}`);
  candidates.add(`skill/${clean}`);
  candidates.add(clean);

  // 2. Strip known common prefixes (repo name, tool name, etc.)
  // e.g. "superpowers-writing-plans" → "writing-plans"
  //      "adlc-market-research"      → "market-research"
  const prefixRe = /^(?:superpowers|adlc|openclaw|agent|skill)-(.+)$/;
  const m = clean.match(prefixRe);
  if (m) {
    candidates.add(`skills/${m[1]}`);
    candidates.add(m[1]);
  }

  // 3. Strip trailing version suffix e.g. "-v2"
  const withoutVersion = clean.replace(/-v\d+$/, '');
  if (withoutVersion !== clean) {
    candidates.add(`skills/${withoutVersion}`);
  }

  return [...candidates];
}

/**
 * Fetch SKILL.md content for a SkillsMP skill result.
 * Tries skillMdUrl first, then falls back to common GitHub repo path patterns.
 */
async function fetchSkillsmpSkillMd(skillResult) {
  const urls = [];

  if (skillResult.skillMdUrl) {
    urls.push(skillResult.skillMdUrl);
    // Also try master branch
    urls.push(skillResult.skillMdUrl.replace('/main/', '/master/'));
  }

  if (skillResult.githubUrl) {
    try {
      const u = new URL(skillResult.githubUrl);
      const parts = u.pathname.replace(/^\/|\.git$/g, '').split('/');
      if (parts.length >= 2) {
        const [user, repo] = parts;
        const branches = ['main', 'master'];

        // Try root SKILL.md
        for (const b of branches) {
          urls.push(`https://raw.githubusercontent.com/${user}/${repo}/${b}/SKILL.md`);
        }

        // Try candidate sub-paths derived from slug
        const slug = skillResult.slug || skillResult.id || '';
        for (const subPath of slugToCandidatePaths(slug)) {
          for (const b of branches) {
            urls.push(`https://raw.githubusercontent.com/${user}/${repo}/${b}/${subPath}/SKILL.md`);
          }
        }

        // If githubUrl itself points to a specific subdirectory path
        // e.g. https://github.com/obra/superpowers/tree/main/skills/writing-plans
        if (parts.length >= 5 && (parts[2] === 'tree' || parts[2] === 'blob')) {
          // parts: ['obra','superpowers','tree','main','skills','writing-plans']
          const pathInRepo = parts.slice(4).join('/');
          for (const b of branches) {
            urls.push(`https://raw.githubusercontent.com/${user}/${repo}/${b}/${pathInRepo}/SKILL.md`);
            urls.push(`https://raw.githubusercontent.com/${user}/${repo}/${b}/${pathInRepo}`);
          }
        }
      }
    } catch { /* invalid URL */ }
  }

  for (const url of [...new Set(urls)]) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const content = await res.text();
        if (content.includes('---') || content.length > 50) return { content, url };
      }
    } catch { /* try next */ }
  }
  return null;
}

/**
 * Install a SkillsMP skill — just writes SKILL.md to the target directory.
 */
async function installSkillsmpSkill({ skill, target, agentId, overwrite = false }) {
  const slug = skill.slug;
  const installPath = resolveInstallPath(target, slug, agentId);

  const existed = fs.existsSync(installPath);
  if (existed && !overwrite) {
    const err = new Error(`Skill "${slug}" is already installed at ${installPath}`);
    err.code = 'ALREADY_INSTALLED';
    err.slug = slug;
    err.installPath = installPath;
    throw err;
  }

  // Fetch SKILL.md
  const result = await fetchSkillsmpSkillMd(skill);
  if (!result) {
    throw new Error(`Could not download SKILL.md for "${slug}" — check GitHub URL: ${skill.githubUrl || 'unknown'}`);
  }

  if (existed && overwrite) {
    fs.rmSync(installPath, { recursive: true, force: true });
  }
  fs.mkdirSync(installPath, { recursive: true });
  fs.writeFileSync(path.join(installPath, 'SKILL.md'), result.content, 'utf-8');

  return {
    ok: true,
    slug,
    path: installPath,
    target,
    source: 'skillsmp',
    updated: existed && overwrite,
  };
}

// ─── Upload (zip / .skill / raw SKILL.md) ─────────────────────────────────────

function isZipBuffer(buf) {
  return buf && buf.length >= 4
    && buf[0] === 0x50 && buf[1] === 0x4B
    && (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07)
    && (buf[3] === 0x04 || buf[3] === 0x06 || buf[3] === 0x08);
}

function deriveSlugFromFilename(filename) {
  if (!filename) return null;
  const base = path.basename(String(filename)).replace(/\.(zip|skill|md)$/i, '');
  const slug = base.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || null;
}

/**
 * Normalize zip entries so that a wrapper directory (common when zipping a folder)
 * is stripped. E.g. if every entry lives under "my-skill/", rewrite keys to drop it.
 */
function stripZipWrapperDir(files) {
  const names = Object.keys(files);
  if (names.length === 0) return files;
  const first = names[0].split('/')[0];
  if (!first) return files;
  const allShare = names.every(n => n === first || n.startsWith(first + '/'));
  if (!allShare) return files;
  // Ensure SKILL.md is NOT at root already
  if (names.includes('SKILL.md')) return files;
  const out = {};
  for (const [k, v] of Object.entries(files)) {
    const stripped = k === first ? '' : k.slice(first.length + 1);
    if (stripped) out[stripped] = v;
  }
  return out;
}

/**
 * Build a preview from an uploaded buffer. Accepts:
 *   - ZIP archive (application/zip, .zip, .skill)
 *   - Raw SKILL.md text (single-file skill, .skill or .md)
 */
function previewFromUpload(buffer, filename) {
  if (!buffer || !buffer.length) throw new Error('Empty upload');

  let files;
  let isSingleFile = false;

  if (isZipBuffer(buffer)) {
    const parsed = parseZip(buffer);
    files = stripZipWrapperDir(parsed.files);
  } else {
    // Treat as raw SKILL.md
    const text = buffer.toString('utf-8');
    if (!/^---\s*\n/.test(text) && !/^#\s/.test(text)) {
      throw new Error('Upload is not a ZIP and does not look like a SKILL.md (missing frontmatter or heading)');
    }
    files = { 'SKILL.md': () => text };
    isSingleFile = true;
  }

  const skillMdContent = files['SKILL.md'] ? files['SKILL.md']() : null;
  if (!skillMdContent) throw new Error('Upload does not contain SKILL.md');
  const frontmatter = parseSkillMdFrontmatter(skillMdContent);

  let meta = {};
  if (files['_meta.json']) {
    try { meta = JSON.parse(files['_meta.json']()); } catch { /* ignore */ }
  }

  const security = runSecurityScan(files);
  const fileList = Object.keys(files).sort();
  const slug =
    deriveSlugFromFilename(frontmatter.name) ||
    deriveSlugFromFilename(meta.name) ||
    deriveSlugFromFilename(filename) ||
    'uploaded-skill';

  return {
    slug,
    name:        frontmatter.name   || meta.name   || slug,
    description: frontmatter.description || meta.description || '',
    version:     meta.version       || frontmatter.version   || null,
    author:      meta.author        || null,
    license:     meta.license       || frontmatter.license   || null,
    emoji:       frontmatter.emoji  || null,
    skillMdContent,
    security,
    fileList,
    isSingleFile,
    source: 'upload',
    _bufferB64: buffer.toString('base64'),
  };
}

function installFromUpload({ bufferB64, filename, target, agentId, slug: slugOverride, overwrite = false }) {
  if (!bufferB64) throw new Error('bufferB64 is required');
  const buffer = Buffer.from(bufferB64, 'base64');
  if (!buffer.length) throw new Error('Empty upload');

  // Derive slug: explicit override > filename-based
  let slug = slugOverride && /^[a-z0-9-]+$/.test(slugOverride)
    ? slugOverride
    : deriveSlugFromFilename(filename);

  const throwAlreadyInstalled = (s, p) => {
    const err = new Error(`Skill "${s}" is already installed at ${p}`);
    err.code = 'ALREADY_INSTALLED';
    err.slug = s;
    err.installPath = p;
    throw err;
  };

  if (isZipBuffer(buffer)) {
    const parsed = parseZip(buffer);
    const files = stripZipWrapperDir(parsed.files);
    const skillMd = files['SKILL.md'] ? files['SKILL.md']() : null;
    if (!skillMd) throw new Error('ZIP does not contain SKILL.md');

    if (!slug) {
      const fm = parseSkillMdFrontmatter(skillMd);
      slug = deriveSlugFromFilename(fm.name) || 'uploaded-skill';
    }

    const installPath = resolveInstallPath(target, slug, agentId);
    const existed = fs.existsSync(installPath);
    if (existed && !overwrite) throwAlreadyInstalled(slug, installPath);

    if (existed && overwrite) {
      fs.rmSync(installPath, { recursive: true, force: true });
    }
    fs.mkdirSync(installPath, { recursive: true });
    // Write each (possibly wrapper-stripped) file manually so the stripping is honored
    for (const [name, getContent] of Object.entries(files)) {
      const dest = path.join(installPath, name);
      if (!dest.startsWith(installPath)) continue; // zip-slip guard
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, getContent(), 'utf-8');
    }
    return { ok: true, slug, path: installPath, target, source: 'upload', updated: existed && overwrite };
  }

  // Raw SKILL.md
  const text = buffer.toString('utf-8');
  if (!/^---\s*\n/.test(text) && !/^#\s/.test(text)) {
    throw new Error('Upload is not a ZIP and does not look like a SKILL.md');
  }
  if (!slug) {
    const fm = parseSkillMdFrontmatter(text);
    slug = deriveSlugFromFilename(fm.name) || 'uploaded-skill';
  }
  const installPath = resolveInstallPath(target, slug, agentId);
  const existed = fs.existsSync(installPath);
  if (existed && !overwrite) throwAlreadyInstalled(slug, installPath);

  if (existed && overwrite) {
    // Raw SKILL.md: only overwrite the SKILL.md file itself, preserve sibling files
    fs.writeFileSync(path.join(installPath, 'SKILL.md'), text, 'utf-8');
    return { ok: true, slug, path: installPath, target, source: 'upload', updated: true };
  }
  fs.mkdirSync(installPath, { recursive: true });
  fs.writeFileSync(path.join(installPath, 'SKILL.md'), text, 'utf-8');
  return { ok: true, slug, path: installPath, target, source: 'upload', updated: false };
}

module.exports = {
  parseClawHubSlug, previewSkill, installSkill, getInstallTargets,
  skillsmpSearch, fetchSkillsmpSkillMd, runSecurityScan, installSkillsmpSkill,
  previewFromUpload, installFromUpload,
};
