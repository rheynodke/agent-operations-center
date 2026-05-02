#!/usr/bin/env node
/**
 * discover.js — Repo context extractor for the prd-generator skill.
 *
 * Usage:
 *   node discover.js --repo <path-to-repo> [--out context.json] [--max-files 15]
 *
 * Scans a repo-shaped directory and writes a JSON document with:
 *   - repo metadata (path, git remote, last commit)
 *   - tech stack (frontend, backend, database, infra) inferred from manifests
 *   - docs inventory (README, CHANGELOG, CONTRIBUTING, ADRs, docs/ subtree)
 *   - route and model inventory (best-effort glob)
 *   - dependencies (top-level from primary manifest)
 *
 * Pure Node — no external deps. Safe to run in restricted sandboxes.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ------------------------------- CLI ----------------------------------------

function parseArgs(argv) {
  const args = { repo: process.cwd(), out: null, maxFiles: 15, help: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--repo') args.repo = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--max-files') args.maxFiles = Number(argv[++i]) || 15;
    else if (a.startsWith('--repo=')) args.repo = a.split('=')[1];
    else if (a.startsWith('--out=')) args.out = a.split('=')[1];
  }
  return args;
}

function printUsage() {
  console.log(
    'Usage: node discover.js --repo <path> [--out context.json] [--max-files 15]\n\n' +
      'Options:\n' +
      '  --repo <path>       Path to the repo root (default: cwd)\n' +
      '  --out <path>        Write context.json here (default: print to stdout)\n' +
      '  --max-files <n>     Cap for routes/models enumeration (default: 15)\n' +
      '  -h, --help          Show this help\n'
  );
}

// ---------------------------- Helpers ---------------------------------------

function safeRead(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (_) { return null; }
}

function safeStat(p) {
  try { return fs.statSync(p); } catch (_) { return null; }
}

function safeReaddir(p) {
  try { return fs.readdirSync(p, { withFileTypes: true }); } catch (_) { return []; }
}

function safeJson(str) {
  try { return JSON.parse(str); } catch (_) { return null; }
}

function exists(p) { return safeStat(p) !== null; }

function relativize(repo, p) { return path.relative(repo, p).replace(/\\/g, '/'); }

// Walk directory with depth cap and exclude list. Returns array of file paths.
function walk(root, { maxDepth = 4, exclude = [] } = {}) {
  const out = [];
  const skip = new Set([
    'node_modules', '.git', '.next', '.nuxt', 'dist', 'build', 'out',
    '.venv', 'venv', '__pycache__', 'target', '.gradle', '.idea', '.vscode',
    'coverage', '.cache', 'tmp', 'vendor', ...exclude,
  ]);
  function rec(dir, depth) {
    if (depth > maxDepth) return;
    for (const entry of safeReaddir(dir)) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) rec(full, depth + 1);
      else if (entry.isFile()) out.push(full);
    }
  }
  rec(root, 0);
  return out;
}

// ---------------------------- Git metadata ----------------------------------

function gitRemote(repo) {
  try {
    const out = execSync('git -C ' + JSON.stringify(repo) + ' remote -v', {
      stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000,
    }).toString().trim();
    if (!out) return null;
    const first = out.split('\n')[0];
    const parts = first.split(/\s+/);
    return parts[1] || null;
  } catch (_) { return null; }
}

function gitLastCommit(repo) {
  try {
    return execSync('git -C ' + JSON.stringify(repo) + ' log -1 --format=%ci', {
      stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000,
    }).toString().trim() || null;
  } catch (_) { return null; }
}

// ---------------------------- Stack inference -------------------------------

function detectStack(repo) {
  const stack = {
    frontend: null, backend: null, database: null, infra: [],
    languages: [], frameworks: [], runtime: null,
  };

  // Node / JS / TS
  const pkgPath = path.join(repo, 'package.json');
  const pkg = safeJson(safeRead(pkgPath));
  if (pkg) {
    stack.languages.push('JavaScript/TypeScript');
    stack.runtime = 'Node.js';
    const deps = Object.assign({}, pkg.dependencies || {}, pkg.devDependencies || {});
    const has = (k) => Object.prototype.hasOwnProperty.call(deps, k);

    if (has('next')) stack.frontend = `Next.js ${deps.next}`;
    else if (has('nuxt')) stack.frontend = `Nuxt ${deps.nuxt}`;
    else if (has('vue')) stack.frontend = `Vue ${deps.vue}`;
    else if (has('react')) stack.frontend = `React ${deps.react}`;
    else if (has('svelte')) stack.frontend = `Svelte ${deps.svelte}`;
    else if (has('@angular/core')) stack.frontend = `Angular ${deps['@angular/core']}`;

    if (has('express')) stack.backend = `Express ${deps.express}`;
    else if (has('fastify')) stack.backend = `Fastify ${deps.fastify}`;
    else if (has('@nestjs/core')) stack.backend = `NestJS ${deps['@nestjs/core']}`;
    else if (has('koa')) stack.backend = `Koa ${deps.koa}`;
    else if (has('hapi')) stack.backend = `Hapi ${deps.hapi}`;

    if (has('prisma') || has('@prisma/client')) stack.frameworks.push('Prisma');
    if (has('drizzle-orm')) stack.frameworks.push('Drizzle');
    if (has('sequelize')) stack.frameworks.push('Sequelize');
    if (has('typeorm')) stack.frameworks.push('TypeORM');
    if (has('mongoose')) { stack.frameworks.push('Mongoose'); stack.database = 'MongoDB'; }
    if (has('pg')) stack.database = stack.database || 'PostgreSQL';
    if (has('mysql') || has('mysql2')) stack.database = stack.database || 'MySQL';
    if (has('redis') || has('ioredis')) {
      stack.database = stack.database ? `${stack.database} + Redis` : 'Redis';
    }
    if (has('socket.io')) stack.frameworks.push('Socket.IO');
  }

  // Python
  if (exists(path.join(repo, 'pyproject.toml')) || exists(path.join(repo, 'requirements.txt'))) {
    stack.languages.push('Python');
    const reqs = safeRead(path.join(repo, 'requirements.txt')) || '';
    const pyproject = safeRead(path.join(repo, 'pyproject.toml')) || '';
    const blob = (reqs + '\n' + pyproject).toLowerCase();
    if (/\bdjango\b/.test(blob)) stack.backend = stack.backend || 'Django';
    if (/\bfastapi\b/.test(blob)) stack.backend = stack.backend || 'FastAPI';
    if (/\bflask\b/.test(blob)) stack.backend = stack.backend || 'Flask';
    if (/psycopg2?/.test(blob)) stack.database = stack.database || 'PostgreSQL';
  }

  // Go
  if (exists(path.join(repo, 'go.mod'))) {
    stack.languages.push('Go');
    const goMod = safeRead(path.join(repo, 'go.mod')) || '';
    if (/gin-gonic\/gin/.test(goMod)) stack.backend = stack.backend || 'Gin';
    if (/labstack\/echo/.test(goMod)) stack.backend = stack.backend || 'Echo';
    if (/gofiber\/fiber/.test(goMod)) stack.backend = stack.backend || 'Fiber';
  }

  // Ruby
  if (exists(path.join(repo, 'Gemfile'))) {
    stack.languages.push('Ruby');
    const gemfile = safeRead(path.join(repo, 'Gemfile')) || '';
    if (/rails/.test(gemfile)) stack.backend = stack.backend || 'Rails';
    if (/sinatra/.test(gemfile)) stack.backend = stack.backend || 'Sinatra';
  }

  // Rust
  if (exists(path.join(repo, 'Cargo.toml'))) {
    stack.languages.push('Rust');
    const cargo = safeRead(path.join(repo, 'Cargo.toml')) || '';
    if (/actix-web/.test(cargo)) stack.backend = stack.backend || 'Actix Web';
    if (/axum/.test(cargo)) stack.backend = stack.backend || 'Axum';
  }

  // Java / Kotlin
  if (exists(path.join(repo, 'pom.xml')) || exists(path.join(repo, 'build.gradle')) || exists(path.join(repo, 'build.gradle.kts'))) {
    stack.languages.push('Java/Kotlin');
    const pom = safeRead(path.join(repo, 'pom.xml')) || '';
    const gradle = safeRead(path.join(repo, 'build.gradle')) || safeRead(path.join(repo, 'build.gradle.kts')) || '';
    if (/spring-boot/.test(pom + gradle)) stack.backend = stack.backend || 'Spring Boot';
  }

  // PHP
  if (exists(path.join(repo, 'composer.json'))) {
    stack.languages.push('PHP');
    const composer = safeRead(path.join(repo, 'composer.json')) || '';
    if (/laravel\/framework/.test(composer)) stack.backend = stack.backend || 'Laravel';
    if (/symfony/.test(composer)) stack.backend = stack.backend || 'Symfony';
  }

  // Database / schema hints (filesystem)
  if (exists(path.join(repo, 'prisma', 'schema.prisma'))) stack.frameworks.push('Prisma (schema present)');
  if (exists(path.join(repo, 'alembic'))) stack.frameworks.push('Alembic migrations');
  if (exists(path.join(repo, 'db', 'migrate'))) stack.frameworks.push('Rails migrations');

  // Infra
  if (exists(path.join(repo, 'Dockerfile'))) stack.infra.push('Docker');
  if (exists(path.join(repo, 'docker-compose.yml')) || exists(path.join(repo, 'docker-compose.yaml'))) stack.infra.push('Docker Compose');
  if (exists(path.join(repo, '.github', 'workflows'))) stack.infra.push('GitHub Actions');
  if (exists(path.join(repo, 'terraform'))) stack.infra.push('Terraform');
  if (exists(path.join(repo, 'k8s')) || exists(path.join(repo, 'kubernetes'))) stack.infra.push('Kubernetes');
  if (exists(path.join(repo, 'helm'))) stack.infra.push('Helm');
  if (exists(path.join(repo, '.circleci'))) stack.infra.push('CircleCI');
  if (exists(path.join(repo, '.gitlab-ci.yml'))) stack.infra.push('GitLab CI');
  if (exists(path.join(repo, 'vercel.json'))) stack.infra.push('Vercel');
  if (exists(path.join(repo, 'netlify.toml'))) stack.infra.push('Netlify');

  return stack;
}

// ---------------------------- Docs inventory --------------------------------

function detectDocs(repo) {
  const docs = [];
  const candidates = [
    'README.md', 'README.rst', 'README.txt', 'README',
    'CHANGELOG.md', 'CONTRIBUTING.md', 'ARCHITECTURE.md', 'ROADMAP.md',
    'SECURITY.md', 'CODE_OF_CONDUCT.md',
  ];
  for (const name of candidates) {
    const p = path.join(repo, name);
    if (!exists(p)) continue;
    const text = safeRead(p) || '';
    const firstHeading = (text.match(/^#\s+(.+)$/m) || [])[1] || name;
    const summary = text.split('\n').slice(0, 3).join(' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    docs.push({ path: name, title: firstHeading.trim(), summary });
  }
  // docs/ subtree
  const docsDir = path.join(repo, 'docs');
  if (exists(docsDir)) {
    for (const entry of safeReaddir(docsDir)) {
      if (entry.isFile() && /\.(md|mdx|rst)$/i.test(entry.name)) {
        const rel = `docs/${entry.name}`;
        const text = safeRead(path.join(docsDir, entry.name)) || '';
        const title = (text.match(/^#\s+(.+)$/m) || [])[1] || entry.name;
        docs.push({ path: rel, title: title.trim(), summary: '' });
      }
    }
  }
  // adr folders
  for (const d of ['docs/adr', 'docs/decisions', 'adr', 'architecture']) {
    const p = path.join(repo, d);
    if (exists(p)) {
      for (const entry of safeReaddir(p)) {
        if (entry.isFile() && /\.md$/i.test(entry.name)) {
          docs.push({ path: `${d}/${entry.name}`, title: entry.name, summary: '' });
        }
      }
    }
  }
  return docs;
}

// ---------------------------- Route / model inventory -----------------------

const ROUTE_DIRS = ['routes', 'src/routes', 'app/api', 'pages/api', 'controllers', 'src/controllers', 'api'];
const MODEL_DIRS = ['models', 'src/models', 'app/models', 'db/models', 'domain/models'];

function inventory(repo, dirs, maxFiles) {
  const items = [];
  for (const d of dirs) {
    const full = path.join(repo, d);
    if (!exists(full)) continue;
    const files = walk(full, { maxDepth: 3 });
    for (const f of files) {
      if (!/\.(js|ts|tsx|py|rb|go|java|kt|rs|php)$/i.test(f)) continue;
      items.push({ path: relativize(repo, f) });
      if (items.length >= maxFiles) return items;
    }
  }
  return items;
}

function detectRoutes(repo, maxFiles) {
  const items = inventory(repo, ROUTE_DIRS, maxFiles);
  // Heuristic: peek inside to extract HTTP method + path for a few files.
  return items.map((it) => {
    const text = safeRead(path.join(repo, it.path)) || '';
    const m = text.match(/(?:app|router|api)\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/i);
    if (m) return { method: m[1].toUpperCase(), path: m[2], file: it.path };
    return it;
  });
}

function detectModels(repo, maxFiles) {
  const items = inventory(repo, MODEL_DIRS, maxFiles);
  return items.map((it) => {
    const base = path.basename(it.path).replace(/\.[^.]+$/, '');
    return { name: base, file: it.path };
  });
}

// ---------------------------- Dependencies ----------------------------------

function detectDependencies(repo) {
  const pkg = safeJson(safeRead(path.join(repo, 'package.json')));
  if (pkg) return Object.keys(pkg.dependencies || {}).slice(0, 30);
  const req = safeRead(path.join(repo, 'requirements.txt'));
  if (req) {
    return req.split('\n')
      .map((l) => l.trim().split(/[=<>!~;\s]/)[0])
      .filter(Boolean)
      .slice(0, 30);
  }
  const goMod = safeRead(path.join(repo, 'go.mod'));
  if (goMod) {
    const deps = [];
    for (const line of goMod.split('\n')) {
      const m = line.trim().match(/^require\s+([^\s]+)|^\s+([^\s]+)\s+v/);
      if (m) deps.push(m[1] || m[2]);
      if (deps.length >= 30) break;
    }
    return deps;
  }
  return [];
}

// ---------------------------- Main ------------------------------------------

function discover(repoPath, maxFiles) {
  const repo = path.resolve(repoPath);
  if (!exists(repo)) throw new Error(`Repo path does not exist: ${repo}`);

  return {
    repo: {
      path: repo,
      remote: gitRemote(repo),
      lastCommit: gitLastCommit(repo),
    },
    stack: detectStack(repo),
    docs: detectDocs(repo),
    routes: detectRoutes(repo, maxFiles),
    models: detectModels(repo, maxFiles),
    dependencies: detectDependencies(repo),
    generatedAt: new Date().toISOString(),
  };
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { printUsage(); process.exit(0); }
  let result;
  try {
    result = discover(args.repo, args.maxFiles);
  } catch (err) {
    console.error(`discover.js: ${err.message}`);
    process.exit(1);
  }
  const json = JSON.stringify(result, null, 2);
  if (args.out) {
    fs.writeFileSync(args.out, json);
    console.error(`Wrote ${args.out} (${json.length} bytes)`);
  } else {
    process.stdout.write(json + '\n');
  }
}

if (require.main === module) main();

module.exports = { discover };
