'use strict';

// DLP regex catalog — hardcoded patterns for egress filtering.
// Each entry: { id, category, severity, reason, regex }
// All regex compiled once at module load.
//
// NOTE: regex entries do NOT carry the /g flag so that repeated .test() calls
// are stateless. Stage A scanner uses new RegExp(p.regex.source, 'g') when
// it needs matchAll iteration over large text chunks.

const FILESYSTEM = [
  { id: 'fs-users', reason: 'filesystem-path', regex: /\/Users\/[^/\s'"<>]+/ },
  { id: 'fs-home', reason: 'filesystem-path', regex: /\/home\/[^/\s'"<>]+/ },
  { id: 'fs-opt', reason: 'filesystem-path', regex: /\/opt\/[^/\s'"<>]+/ },
  { id: 'fs-var', reason: 'filesystem-path', regex: /\/var\/[^/\s'"<>]+/ },
  { id: 'fs-etc', reason: 'filesystem-path', regex: /\/etc\/[^/\s'"<>]+/ },
  { id: 'fs-windows', reason: 'filesystem-path', regex: /[A-Za-z]:\\\\?[^\s'"<>]+/ },
  { id: 'fs-tilde-openclaw', reason: 'internal-path', regex: /~\/\.openclaw\// },
  { id: 'fs-tilde-aoc', reason: 'internal-path', regex: /~\/\.aoc\// },
  { id: 'fs-tilde-bun', reason: 'internal-path', regex: /~\/\.bun\// },
  { id: 'fs-tilde-config', reason: 'internal-path', regex: /~\/\.config\// },
];

const CREDENTIALS = [
  { id: 'cred-env-style', reason: 'credential', regex: /\b(?:TOKEN|SECRET|API[_-]?KEY|PASSWORD|PASS|PWD|AUTH)\s*[=:]\s*[^\s'"<>;]{6,}/i },
  { id: 'cred-bearer', reason: 'credential', regex: /\bBearer\s+[A-Za-z0-9_\-]{20,}/ },
  { id: 'cred-sk', reason: 'credential', regex: /\bsk-[A-Za-z0-9_\-]{20,}/ },
  { id: 'cred-slack-bot', reason: 'credential', regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { id: 'cred-github', reason: 'credential', regex: /\b(?:ghp|gho|ghs|ghr|ghu)_[A-Za-z0-9]{20,}/ },
  { id: 'cred-aws-access', reason: 'credential', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'cred-json', reason: 'credential', regex: /"(?:token|secret|api_?key|password|auth)"\s*:\s*"[^"]{6,}"/i },
];

const INTERNAL = [
  { id: 'int-openclaw-json', reason: 'internal-config', regex: /\bopenclaw\.json\b/ },
  { id: 'int-aoc-db', reason: 'internal-config', regex: /\baoc\.db\b/ },
  { id: 'int-aoc-env', reason: 'internal-config', regex: /\.aoc_env\b/ },
  { id: 'int-aoc-paths', reason: 'internal-config', regex: /\.aoc_paths\b/ },
  { id: 'int-odoocli', reason: 'internal-config', regex: /\.odoocli\.toml\b/ },
  { id: 'int-table-agent-profiles', reason: 'internal-config', regex: /\bagent_profiles\b/ },
  { id: 'int-table-mission-rooms', reason: 'internal-config', regex: /\bmission_rooms\b/ },
  { id: 'int-sqlite-error', reason: 'internal-error', regex: /\bSQLITE_[A-Z_]+/ },
  { id: 'int-near-error', reason: 'internal-error', regex: /near "[^"]+":\s+syntax error/ },
];

const PII = [
  { id: 'pii-email', reason: 'pii-email', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/ },
  { id: 'pii-phone-id', reason: 'pii-phone', regex: /\+62[\s-]?\d{2,3}[\s-]?\d{3,4}[\s-]?\d{3,4}/ },
  { id: 'pii-phone-intl', reason: 'pii-phone', regex: /\+\d{1,3}[\s-]?\d{1,4}[\s-]?\d{1,4}[\s-]?\d{4,}/ },
  { id: 'pii-nik', reason: 'pii-nik', regex: /\b\d{16}\b/ },  // 16-digit Indonesian national ID
  { id: 'pii-credit-card', reason: 'pii-credit-card', regex: /\b(?:\d[ -]*?){13,19}\b/ },  // Luhn validation downstream
];

const ALL = [
  ...FILESYSTEM.map(p => ({ ...p, category: 'filesystem', severity: 'critical' })),
  ...CREDENTIALS.map(p => ({ ...p, category: 'credentials', severity: 'critical' })),
  ...INTERNAL.map(p => ({ ...p, category: 'internal', severity: 'warning' })),
  ...PII.map(p => ({ ...p, category: 'pii', severity: 'warning' })),
];

const PRESET_CATEGORIES = {
  'internal-tool-default': ['filesystem', 'credentials', 'internal'],
  'customer-service-default': ['filesystem', 'credentials', 'internal', 'pii'],
};

function getCategoryPatterns(category) {
  return ALL.filter(p => p.category === category);
}

function getAllPatterns() {
  return ALL;
}

function getPatternsForPreset(preset) {
  const cats = PRESET_CATEGORIES[preset] || PRESET_CATEGORIES['internal-tool-default'];
  return ALL.filter(p => cats.includes(p.category));
}

module.exports = { getCategoryPatterns, getAllPatterns, getPatternsForPreset, PRESET_CATEGORIES };
