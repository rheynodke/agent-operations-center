'use strict';

// Filesystem operations for project workspace binding.
//
// Two modes:
//   greenfield  — AOC creates the folder + scaffolds full structure
//   brownfield  — folder already exists; AOC only creates `.aoc/` and
//                 appends a managed block to `.gitignore`. Never touches
//                 user files.
//
// All path inputs MUST be absolute. Caller is responsible for tilde-expansion
// before calling here (see expandHome below for a helper).

const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── .gitignore managed block ──────────────────────────────────────────────
const AOC_GITIGNORE_BEGIN = '# === AOC Dashboard (managed - do not edit between markers) ===';
const AOC_GITIGNORE_END   = '# === /AOC Dashboard ===';

function gitignoreManagedBlock() {
  return [
    AOC_GITIGNORE_BEGIN,
    '.aoc/tasks/',
    '.aoc/activity.log',
    '.aoc/cache/',
    '.aoc/runtime/',
    '.aoc/*.tmp',
    '.aoc/*.lock',
    AOC_GITIGNORE_END,
    '',
  ].join('\n');
}

// Idempotent: if begin marker exists, replace contents through end marker;
// else append at EOF (with leading blank line if file non-empty).
function applyGitignoreBlock(workspacePath) {
  const target = path.join(workspacePath, '.gitignore');
  let existing = '';
  try { existing = fs.readFileSync(target, 'utf8'); } catch (_) { existing = ''; }

  const block = gitignoreManagedBlock();

  if (existing.includes(AOC_GITIGNORE_BEGIN)) {
    const beginIdx = existing.indexOf(AOC_GITIGNORE_BEGIN);
    const endIdx = existing.indexOf(AOC_GITIGNORE_END, beginIdx);
    if (endIdx === -1) {
      // malformed: begin without end — strip from begin onward + append fresh
      const head = existing.slice(0, beginIdx).replace(/\s+$/, '');
      const next = (head ? head + '\n\n' : '') + block;
      fs.writeFileSync(target, next, 'utf8');
      return { applied: true, mode: 'recovered' };
    }
    const after = endIdx + AOC_GITIGNORE_END.length;
    const head = existing.slice(0, beginIdx).replace(/\s+$/, '');
    const tail = existing.slice(after).replace(/^\s+/, '');
    const next = (head ? head + '\n\n' : '') + block + (tail ? tail + '\n' : '');
    if (next !== existing) {
      fs.writeFileSync(target, next, 'utf8');
      return { applied: true, mode: 'replaced' };
    }
    return { applied: false, mode: 'unchanged' };
  }

  const sep = existing && !existing.endsWith('\n') ? '\n\n' : (existing ? '\n' : '');
  fs.writeFileSync(target, existing + sep + block, 'utf8');
  return { applied: true, mode: 'appended' };
}

function removeGitignoreBlock(workspacePath) {
  const target = path.join(workspacePath, '.gitignore');
  let existing = '';
  try { existing = fs.readFileSync(target, 'utf8'); } catch (_) { return { removed: false }; }
  if (!existing.includes(AOC_GITIGNORE_BEGIN)) return { removed: false };
  const beginIdx = existing.indexOf(AOC_GITIGNORE_BEGIN);
  const endIdx = existing.indexOf(AOC_GITIGNORE_END, beginIdx);
  if (endIdx === -1) return { removed: false };
  const after = endIdx + AOC_GITIGNORE_END.length;
  const head = existing.slice(0, beginIdx).replace(/\s+$/, '');
  const tail = existing.slice(after).replace(/^\s+/, '');
  const next = (head ? head + (tail ? '\n\n' : '\n') : '') + (tail || '');
  fs.writeFileSync(target, next, 'utf8');
  return { removed: true };
}

// ─── Path validation ──────────────────────────────────────────────────────

const HOME = os.homedir();
// System dirs we refuse to bind. Note that we deliberately do NOT include
// blanket '/var' here, because macOS user-tempdirs live under /var/folders
// (the canonical os.tmpdir()) and they're legitimate. We list only the
// system-state subtrees that should never host a project workspace.
const SENSITIVE_DIR_PATTERNS = [
  path.join(HOME, '.openclaw'),
  path.join(HOME, '.claude'),
  path.join(HOME, '.aoc'),
  path.join(HOME, '.ssh'),
  path.join(HOME, '.gnupg'),
  '/etc',
  '/usr',
  '/bin',
  '/sbin',
  '/var/log',
  '/var/lib',
  '/var/run',
  '/var/cache',
  '/var/db',
  '/var/root',
  '/System',
  '/Library/System',
];

function expandHome(p) {
  if (!p) return p;
  if (p === '~') return HOME;
  if (p.startsWith('~/')) return path.join(HOME, p.slice(2));
  return p;
}

function normalizeAbsolute(p) {
  if (!p) return null;
  const expanded = expandHome(p);
  if (!path.isAbsolute(expanded)) return null;
  return path.resolve(expanded);
}

// Returns sensitive-dir match (string) or null.
function findSensitiveMatch(absPath) {
  for (const guarded of SENSITIVE_DIR_PATTERNS) {
    if (absPath === guarded || absPath.startsWith(guarded + path.sep)) {
      return guarded;
    }
  }
  return null;
}

// Result shape:
//  { ok: bool, path: string, kind: 'directory'|'missing'|'file'|'symlink',
//    writable: bool, exists: bool,
//    reason?: string,  // populated when ok=false
//    sensitive?: string }
function probePath(absPath) {
  let lst;
  try { lst = fs.lstatSync(absPath); }
  catch { return { ok: true, path: absPath, exists: false, kind: 'missing', writable: false }; }
  if (lst.isSymbolicLink()) {
    return { ok: false, reason: 'symlink not allowed', path: absPath, exists: true, kind: 'symlink', writable: false };
  }
  if (!lst.isDirectory()) {
    return { ok: false, reason: 'not a directory', path: absPath, exists: true, kind: 'file', writable: false };
  }
  let writable = false;
  try { fs.accessSync(absPath, fs.constants.W_OK | fs.constants.R_OK); writable = true; } catch { writable = false; }
  return { ok: true, path: absPath, exists: true, kind: 'directory', writable };
}

// Validates a brownfield path: must exist, be a writable dir, not sensitive.
function validateBrownfieldPath(input) {
  const abs = normalizeAbsolute(input);
  if (!abs) return { ok: false, reason: 'path must be absolute' };
  const sens = findSensitiveMatch(abs);
  if (sens) return { ok: false, reason: `sensitive directory refused: ${sens}`, sensitive: sens };
  const probe = probePath(abs);
  if (!probe.ok) return { ...probe, ok: false };
  if (!probe.exists) return { ok: false, reason: 'path does not exist', path: abs };
  if (probe.kind !== 'directory') return { ok: false, reason: probe.reason || 'not a directory', path: abs };
  if (!probe.writable) return { ok: false, reason: 'not writable', path: abs };
  return { ok: true, path: abs, kind: 'directory', writable: true };
}

// Slugify a project display name into a safe folder name: lowercase ASCII,
// alphanumeric + underscore + dot + dash; spaces collapsed to underscore.
// Mirrors the client-side slugify in ProjectCreateWizard.tsx so display
// names with spaces (e.g. "ADLC Test") become "adlc_test".
function slugifyName(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w.\-\s]/g, '')   // strip diacritics + non-allowed chars
    .trim()
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '');
}

// Validates a greenfield request: parent must exist + be writable; target must NOT exist.
// `name` may be a display name with spaces — we slugify it first.
function validateGreenfieldPath(parentInput, name) {
  const slug = slugifyName(name);
  if (!slug || !/^[a-zA-Z0-9._\-]+$/.test(slug)) {
    return { ok: false, reason: 'name must contain at least one alphanumeric character' };
  }
  // Re-bind name to the slug so callers see the resolved folder name.
  name = slug;
  const parentAbs = normalizeAbsolute(parentInput);
  if (!parentAbs) return { ok: false, reason: 'parent path must be absolute' };
  const sens = findSensitiveMatch(parentAbs);
  if (sens) return { ok: false, reason: `sensitive parent refused: ${sens}`, sensitive: sens };
  const target = path.join(parentAbs, name);
  const parentProbe = probePath(parentAbs);
  if (!parentProbe.ok || !parentProbe.exists) return { ok: false, reason: 'parent does not exist', path: parentAbs };
  if (parentProbe.kind !== 'directory') return { ok: false, reason: 'parent is not a directory', path: parentAbs };
  if (!parentProbe.writable) return { ok: false, reason: 'parent not writable', path: parentAbs };
  let exists = false;
  try { fs.lstatSync(target); exists = true; } catch {}
  if (exists) return { ok: false, reason: 'target already exists', path: target };
  return { ok: true, path: target, parent: parentAbs };
}

// ─── .aoc/project.json ─────────────────────────────────────────────────────

function readAocBinding(workspacePath) {
  const file = path.join(workspacePath, '.aoc', 'project.json');
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const json = JSON.parse(raw);
    if (json && typeof json === 'object' && json.id) return json;
  } catch (_) { /* not bound */ }
  return null;
}

function writeAocBinding(workspacePath, payload) {
  const dir = path.join(workspacePath, '.aoc');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'project.json');
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  // Ensure activity.log exists so brownfield gitignore rule is meaningful.
  const log = path.join(dir, 'activity.log');
  try { if (!fs.existsSync(log)) fs.writeFileSync(log, '', 'utf8'); } catch {}
  return file;
}

// Write per-task context that the agent reads at the start of each turn.
// Lives at `{workspace}/.aoc/tasks/{taskId}/context.json` and is overwritten
// on every dispatch so it always reflects the latest task state. Returns
// absolute paths the caller can mention to the agent.
function writeTaskContext(workspacePath, taskId, payload) {
  if (!workspacePath || !taskId) return null;
  const taskDir = path.join(workspacePath, '.aoc', 'tasks', String(taskId));
  fs.mkdirSync(taskDir, { recursive: true });
  const ctxFile = path.join(taskDir, 'context.json');
  fs.writeFileSync(ctxFile, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  // Pre-create inputs/ + outputs/ so agent can use them without mkdir.
  const inputsDir = path.join(taskDir, 'inputs');
  const outputsDir = path.join(taskDir, 'outputs');
  fs.mkdirSync(inputsDir, { recursive: true });
  fs.mkdirSync(outputsDir, { recursive: true });
  return { taskDir, ctxFile, inputsDir, outputsDir };
}

function appendActivityLog(workspacePath, line) {
  try {
    const dir = path.join(workspacePath, '.aoc');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'activity.log');
    const ts = new Date().toISOString();
    fs.appendFileSync(file, `${ts} ${line}\n`, 'utf8');
  } catch { /* best-effort */ }
}

// ─── Greenfield scaffolding ───────────────────────────────────────────────

const GREENFIELD_OUTPUT_DIRS = [
  '01-discovery',
  '02-design',
  '03-architecture',
  '04-implementation',
  '05-qa',
  '06-docs',
];

function scaffoldGreenfield({ workspacePath, projectId, name, kind }) {
  fs.mkdirSync(workspacePath, { recursive: true });
  const readme = path.join(workspacePath, 'README.md');
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(
      readme,
      `# ${name}\n\nProject managed by AOC Dashboard.\n\n- ID: \`${projectId}\`\n- Kind: \`${kind || 'ops'}\`\n- Created: ${new Date().toISOString()}\n`,
      'utf8'
    );
  }
  const outputsRoot = path.join(workspacePath, 'outputs');
  fs.mkdirSync(outputsRoot, { recursive: true });
  for (const sub of GREENFIELD_OUTPUT_DIRS) {
    const dir = path.join(outputsRoot, sub);
    fs.mkdirSync(dir, { recursive: true });
    const keep = path.join(dir, '.gitkeep');
    if (!fs.existsSync(keep)) fs.writeFileSync(keep, '', 'utf8');
  }
  applyGitignoreBlock(workspacePath);
  writeAocBinding(workspacePath, {
    id: projectId,
    name,
    kind: kind || 'ops',
    mode: 'greenfield',
    boundAt: new Date().toISOString(),
  });
  appendActivityLog(workspacePath, `bind project=${projectId} mode=greenfield name="${name}"`);
}

// ─── Brownfield binding ────────────────────────────────────────────────────

function bindBrownfield({ workspacePath, projectId, name, kind }) {
  // Don't create directories user didn't ask for; just .aoc + .gitignore block.
  applyGitignoreBlock(workspacePath);
  writeAocBinding(workspacePath, {
    id: projectId,
    name,
    kind: kind || 'ops',
    mode: 'brownfield',
    boundAt: new Date().toISOString(),
  });
  appendActivityLog(workspacePath, `bind project=${projectId} mode=brownfield name="${name}"`);
}

// ─── Unbind ────────────────────────────────────────────────────────────────

function unbindWorkspace(workspacePath, { removeAocDir = false } = {}) {
  const result = { gitignoreRemoved: false, aocRemoved: false };
  try { result.gitignoreRemoved = removeGitignoreBlock(workspacePath).removed; } catch {}
  if (removeAocDir) {
    const aocDir = path.join(workspacePath, '.aoc');
    try {
      if (fs.existsSync(aocDir)) {
        fs.rmSync(aocDir, { recursive: true, force: true });
        result.aocRemoved = true;
      }
    } catch (e) {
      result.aocError = e.message || String(e);
    }
  } else {
    // Soft-unbind: keep .aoc/ on disk so user can rebind without losing logs.
    try {
      const file = path.join(workspacePath, '.aoc', 'project.json');
      if (fs.existsSync(file)) fs.unlinkSync(file);
      result.aocRemoved = false;
    } catch {}
  }
  return result;
}

module.exports = {
  // path helpers
  expandHome,
  normalizeAbsolute,
  findSensitiveMatch,
  probePath,
  validateBrownfieldPath,
  validateGreenfieldPath,
  slugifyName,
  // .gitignore
  gitignoreManagedBlock,
  applyGitignoreBlock,
  removeGitignoreBlock,
  AOC_GITIGNORE_BEGIN,
  AOC_GITIGNORE_END,
  // .aoc binding
  readAocBinding,
  writeAocBinding,
  writeTaskContext,
  appendActivityLog,
  // workspace lifecycle
  scaffoldGreenfield,
  bindBrownfield,
  unbindWorkspace,
  // constants for tests
  GREENFIELD_OUTPUT_DIRS,
  SENSITIVE_DIR_PATTERNS,
};
