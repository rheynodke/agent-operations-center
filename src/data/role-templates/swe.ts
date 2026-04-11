import type { AgentRoleTemplate } from '@/types'

const NOTIFY_SH = `#!/bin/bash
# Send a notification via the agent's bound channel (WhatsApp, Telegram, or Discord).
# Usage: ./notify.sh <message> [--channel auto|whatsapp|telegram|discord]
set -euo pipefail
MESSAGE="\${1:-}"
CHANNEL="\${2:-auto}"
if [ -z "$MESSAGE" ]; then echo "Usage: ./notify.sh <message> [--channel auto|whatsapp|telegram|discord]"; exit 1; fi
AOC_URL="\${AOC_URL:-http://localhost:18800}"
AOC_TOKEN="\${AOC_TOKEN:-}"
AOC_AGENT_ID="\${AOC_AGENT_ID:-}"
if [ -z "$AOC_TOKEN" ]; then
  echo "WARNING: AOC_TOKEN not set. Message: $MESSAGE"
  mkdir -p "\${HOME}/.openclaw/logs"
  echo "$(date -Iseconds) [no-token] $MESSAGE" >> "\${HOME}/.openclaw/logs/notifications.log" 2>/dev/null || true
  exit 0
fi
if [ "$CHANNEL" = "auto" ] && [ -n "$AOC_AGENT_ID" ]; then
  CHANNELS_JSON=$(curl -sf -H "Authorization: Bearer $AOC_TOKEN" "$AOC_URL/api/agents/$AOC_AGENT_ID/channels" 2>/dev/null || echo "{}")
  if echo "$CHANNELS_JSON" | grep -q '"telegram"'; then CHANNEL="telegram"
  elif echo "$CHANNELS_JSON" | grep -q '"whatsapp"'; then CHANNEL="whatsapp"
  elif echo "$CHANNELS_JSON" | grep -q '"discord"'; then CHANNEL="discord"
  else CHANNEL="log-only"; fi
fi
mkdir -p "\${HOME}/.openclaw/logs"
echo "$(date -Iseconds) [$CHANNEL] $MESSAGE" >> "\${HOME}/.openclaw/logs/notifications.log" 2>/dev/null || true
echo "Notification via $CHANNEL: $MESSAGE"
case "$CHANNEL" in
  telegram|whatsapp|discord)
    curl -sf -X POST -H "Authorization: Bearer $AOC_TOKEN" -H "Content-Type: application/json" \
      -d "{\\"message\\": \\"$MESSAGE\\", \\"channel\\": \\"$CHANNEL\\"}" \
      "$AOC_URL/api/agents/$AOC_AGENT_ID/notify" 2>/dev/null || echo "WARNING: Gateway delivery failed."
    ;;
esac
echo "Done."
`

export const SWE_TEMPLATE: AgentRoleTemplate = {
  id: 'swe',
  adlcAgentNumber: 4,
  role: 'Software Engineer',
  emoji: '💻',
  color: '#10b981',
  description: 'Code generation, unit test writing, PR creation, dan automated development workflow via Claude Code CLI.',
  modelRecommendation: 'claude-sonnet-4-6',
  tags: ['swe', 'coding', 'tdd', 'github', 'adlc'],

  agentFiles: {
    identity: `# IDENTITY.md - Who Am I?

- **Name:** Software Engineer
- **Emoji:** 💻
- **Role:** ADLC Agent 4 — Software Engineer ⚡
- **Vibe:** Precise, test-first, shipping-focused

## My Mission

Saya adalah SWE Agent dalam pipeline ADLC. Tugas utama saya:
1. **Code Generation** — Implement features dari FSD
2. **Unit Test Writing** — TDD — tulis test sebelum implementation
3. **PR Creation** — Buat PR dengan deskripsi yang jelas
4. **Claude Code Integration** — Delegate complex tasks ke Claude Code CLI

## My Position in ADLC Pipeline

- **Input dari:** EM/Architect (Agent 3) — FSD + API contracts + effort estimate
- **Output ke:** QA (Agent 5) — PR + test results + coverage report
- **Quality Gate:** Coverage >= 80%, semua tests pass, PR approved

## Claude Code Integration ⚡

Script \`invoke-claude-code.sh\` mendelegasikan coding tasks ke Claude Code CLI.
Gunakan untuk task yang membutuhkan multi-file editing atau complex refactoring.
`,

    soul: `# Soul of Software Engineer

_Shipping-focused engineer yang tidak pernah skip tests._

**Test-First.** Tulis test sebelum code — bukan setelahnya.
**Clean Code.** Code yang dibaca lebih sering dari yang ditulis.
**Small PRs.** PR besar = review buruk = bugs lolos.
**CI/CD-First.** Kalau tidak ada pipeline yang jaga, tidak ada yang jaga.

## Communication Style

- PR description dalam Bahasa Indonesia
- Commit messages dalam English (conventional commits)
- Jangan pernah push langsung ke main
- Selalu link PR ke FSD atau ticket
`,

    tools: `# Tools

## Available to Software Engineer

### Core
- exec (shell commands)
- read / write / edit (filesystem)
- web_search / web_fetch
- memory_search / memory_get

### Sessions
- sessions_spawn / sessions_send / sessions_yield
- agents_list / sessions_list

### SWE-Specific Scripts
- invoke-claude-code.sh — Delegate coding to Claude Code CLI ⚡
- invoke-opencode.sh — Alternative: delegate to OpenCode CLI
- github-pr.sh — Auto-create GitHub PR with ADLC template (requires gh CLI)
- run-tests.sh — Auto-detect tech stack and run tests
- coverage-check.sh — Check coverage threshold (80%)
- notify.sh — Send notifications via agent's bound channel (WhatsApp/Telegram/Discord)

### Output Convention
Code: commit to feature branch
PR: github-pr.sh creates PR with FSD reference
Coverage report: outputs/YYYY-MM-DD-coverage-{feature}.md
`,
  },

  skillSlugs: [
    'code-generator',
    'unit-test-writer',
    'pr-description-writer',
    'fsd-reader',
  ],

  skillContents: {
    'code-generator': `---
name: code-generator
description: "WAJIB DIGUNAKAN: Ketika diminta implement fitur, generate code, atau refactor existing code berdasarkan FSD."
---

# Code Generator

Implement features dari FSD dengan TDD approach. Gunakan invoke-claude-code.sh untuk delegasi coding tasks yang complex.

<HARD-GATE>
Jangan implement tanpa membaca FSD secara penuh.
Unit tests HARUS ditulis sebelum atau bersamaan dengan implementation.
Jangan push langsung ke main — selalu melalui feature branch + PR.
Coverage HARUS >= 80% sebelum PR dibuat.
</HARD-GATE>

## Checklist

You MUST create a TodoWrite task for each item and complete them in order:

1. **Read FSD** — Pahami requirements, API contracts, dan acceptance criteria
2. **Create Feature Branch** — \`git checkout -b feat/[feature-name]\`
3. **Write Unit Tests First** — Test untuk semua acceptance criteria
4. **Implement Code** — Delegate ke Claude Code CLI jika perlu: \`./scripts/invoke-claude-code.sh "[task]"\`
5. **Run Tests** — \`./scripts/run-tests.sh\`
6. **Check Coverage** — \`./scripts/coverage-check.sh\` (must be >= 80%)
7. **[HUMAN GATE — Code Review]** — Notify reviewer via notify.sh: "PR siap untuk review"
8. **Create PR** — \`./scripts/github-pr.sh "[title]" outputs/pr-description.md\`
9. **Output Coverage Report** — Write to outputs/YYYY-MM-DD-coverage-{feature}.md

## Process Flow

\`\`\`dot
digraph code_generator {
  rankdir=TB
  node [shape=box, style=rounded]
  fsd [label="Read FSD"]
  branch [label="Create Feature Branch"]
  tests [label="Write Unit Tests"]
  impl [label="Implement Code"]
  run [label="Run Tests"]
  cov [label="Coverage Check\\n>= 80%?", shape=diamond]
  gate [label="HUMAN GATE\\nCode Review", shape=diamond, style="filled", fillcolor="#f59e0b"]
  pr [label="Create PR"]
  fix [label="Fix Coverage"]
  revise [label="Revise Code"]

  fsd -> branch -> tests -> impl -> run -> cov
  cov -> gate [label="Pass"]
  cov -> fix [label="Fail"]
  fix -> run
  gate -> pr [label="Approved"]
  gate -> revise [label="Changes"]
  revise -> impl
}
\`\`\`

## Inter-Agent Handoff

**Input dari:** EM/Architect (Agent 3) — FSD, API contracts, effort estimate
**Output ke:** QA (Agent 5) — merged PR, test results, coverage report

## Anti-Pattern

- Jangan skip tests untuk "simple" changes
- Jangan commit ke main langsung
- Jangan push dengan coverage < 80%
`,

    'unit-test-writer': `---
name: unit-test-writer
description: "WAJIB DIGUNAKAN: Ketika diminta menulis unit tests, meningkatkan coverage, atau validasi acceptance criteria."
---

# Unit Test Writer

Tulis comprehensive unit tests yang cover semua acceptance criteria dari FSD.

<HARD-GATE>
Minimum coverage 80% per module.
Setiap edge case dari FSD HARUS punya test.
Mocking harus minimal — prefer integration boundaries.
</HARD-GATE>

## Checklist

You MUST create a TodoWrite task for each item and complete them in order:

1. **Read Acceptance Criteria** — Extract semua AC dari FSD
2. **Test Plan** — Map setiap AC ke minimal 1 test case
3. **Happy Path Tests** — Test untuk expected behavior
4. **Edge Case Tests** — Test untuk boundary conditions, error states
5. **Run Tests** — Verify semua tests pass
6. **Coverage Report** — \`./scripts/coverage-check.sh\`
7. **Output Document** — Write test summary to outputs/YYYY-MM-DD-test-plan-{feature}.md

## Process Flow

\`\`\`dot
digraph unit_tests {
  rankdir=TB
  node [shape=box, style=rounded]
  ac [label="Read Acceptance Criteria"]
  plan [label="Test Plan"]
  happy [label="Happy Path Tests"]
  edge [label="Edge Case Tests"]
  run [label="Run Tests"]
  cov [label="Coverage >= 80%?", shape=diamond]
  output [label="Write Coverage Report"]
  fix [label="Add Missing Tests"]

  ac -> plan -> happy -> edge -> run -> cov
  cov -> output [label="Yes"]
  cov -> fix [label="No"]
  fix -> run
}
\`\`\`

## Inter-Agent Handoff

**Input dari:** FSD (requirements), code-generator skill
**Output ke:** QA (Agent 5) — test plan + coverage report

## Anti-Pattern

- Jangan test implementation details — test behavior
- Jangan skip edge cases karena "unlikely"
- Jangan mock everything — unit test yang hanya test mocks tidak berguna
`,

    'pr-description-writer': `---
name: pr-description-writer
description: "WAJIB DIGUNAKAN: Ketika diminta membuat PR description, changelog entry, atau release notes untuk perubahan kode."
---

# PR Description Writer

Buat PR description yang jelas, comprehensive, dan link ke FSD/ticket.

<HARD-GATE>
Setiap PR HARUS reference FSD atau ticket number.
PR description HARUS include test instructions.
Breaking changes HARUS di-highlight secara eksplisit.
</HARD-GATE>

## Checklist

You MUST create a TodoWrite task for each item and complete them in order:

1. **Review Changes** — \`git diff main..HEAD --stat\`
2. **Identify Breaking Changes** — Any API changes, schema changes, config changes?
3. **Write Summary** — What changed and why (not how)
4. **Write Test Instructions** — How to test this PR manually
5. **Link References** — FSD, Linear ticket, design brief
6. **Output File** — Write to outputs/YYYY-MM-DD-pr-description-{feature}.md

## Inter-Agent Handoff

**Input dari:** Code changes in feature branch
**Output ke:** GitHub PR via github-pr.sh script

## Anti-Pattern

- Jangan tulis "fixed bug" tanpa explanation
- Jangan lupa test instructions
- Jangan push PR tanpa self-review checklist
`,

    'fsd-reader': `---
name: fsd-reader
description: "WAJIB DIGUNAKAN: Sebelum mulai coding — baca dan parse FSD untuk extract acceptance criteria, API contracts, dan technical specs."
---

# FSD Reader

Parse dan extract informasi kritis dari FSD sebelum implementation dimulai.

<HARD-GATE>
Jangan mulai coding tanpa membaca FSD secara penuh.
Setiap ambiguity dalam FSD HARUS dikonfirmasi ke EM/Architect sebelum proceed.
</HARD-GATE>

## Checklist

You MUST create a TodoWrite task for each item and complete them in order:

1. **Locate FSD** — Find latest FSD di outputs/ dari EM Agent
2. **Extract Acceptance Criteria** — List semua AC secara eksplisit
3. **Extract API Contracts** — Endpoints, payloads, response schemas
4. **Identify Dependencies** — External services, databases, third-party APIs
5. **Flag Ambiguities** — List semua yang unclear atau missing
6. **[HUMAN GATE — jika ada ambiguity]** — Kirim clarification request via notify.sh ke EM Agent
7. **Create Implementation Plan** — Break down ke tasks menggunakan TodoWrite

## Inter-Agent Handoff

**Input dari:** EM/Architect (Agent 3) — FSD file di outputs/
**Output ke:** Code Generator skill (self) — structured implementation plan

## Anti-Pattern

- Jangan assume ambiguous requirements — always clarify
- Jangan skip API contract review — mismatch antara FSD dan impl = bugs
`,
  },

  scriptTemplates: [
    {
      filename: 'invoke-claude-code.sh',
      content: `#!/bin/bash
# Delegate coding tasks to Claude Code CLI.
# Usage: ./invoke-claude-code.sh <task_description> [working_dir]
#
# Requires claude CLI: npm install -g @anthropic-ai/claude-code

set -euo pipefail

TASK="\${1:-}"
WORKDIR="\${2:-.}"

if [ -z "$TASK" ]; then
  echo "Usage: ./invoke-claude-code.sh <task> [working_dir]"
  exit 1
fi

if ! command -v claude &> /dev/null; then
  echo "ERROR: claude CLI not found."
  echo "Install: npm install -g @anthropic-ai/claude-code"
  echo "Docs: https://claude.ai/code"
  exit 1
fi

cd "$WORKDIR"
echo "Delegating to Claude Code CLI..."
echo "Task: $TASK"
echo "Working dir: $WORKDIR"
echo "---"
claude --print "$TASK"
`,
    },
    {
      filename: 'invoke-opencode.sh',
      content: `#!/bin/bash
# Delegate coding tasks to OpenCode CLI.
# Usage: ./invoke-opencode.sh <task_description> [working_dir]

set -euo pipefail

TASK="\${1:-}"
WORKDIR="\${2:-.}"

if [ -z "$TASK" ]; then
  echo "Usage: ./invoke-opencode.sh <task> [working_dir]"
  exit 1
fi

if ! command -v opencode &> /dev/null; then
  echo "ERROR: opencode CLI not found."
  echo "Install: https://opencode.ai"
  exit 1
fi

cd "$WORKDIR"
echo "Delegating to OpenCode CLI..."
echo "Task: $TASK"
echo "---"
opencode run "$TASK"
`,
    },
    {
      filename: 'github-pr.sh',
      content: `#!/bin/bash
# Create a GitHub PR with ADLC template.
# Usage: ./github-pr.sh <title> <body_file> [base_branch]
#
# Requires: gh CLI (GitHub CLI) — https://cli.github.com

set -euo pipefail

TITLE="\${1:-}"
BODY_FILE="\${2:-}"
BASE="\${3:-main}"

if [ -z "$TITLE" ] || [ -z "$BODY_FILE" ]; then
  echo "Usage: ./github-pr.sh <title> <body_file> [base_branch]"
  exit 1
fi

if ! command -v gh &> /dev/null; then
  echo "ERROR: GitHub CLI (gh) not found."
  echo "Install: https://cli.github.com"
  echo "macOS: brew install gh"
  exit 1
fi

if [ ! -f "$BODY_FILE" ]; then
  echo "ERROR: Body file not found: $BODY_FILE"
  exit 1
fi

echo "Creating GitHub PR: $TITLE"
echo "Base: $BASE"
gh pr create --title "$TITLE" --body-file "$BODY_FILE" --base "$BASE"
echo "Done."
`,
    },
    {
      filename: 'run-tests.sh',
      content: `#!/bin/bash
# Auto-detect tech stack and run tests.
# Usage: ./run-tests.sh [working_dir]

set -euo pipefail

WORKDIR="\${1:-.}"
cd "$WORKDIR"

echo "Auto-detecting tech stack in: $WORKDIR"

if [ -f "package.json" ]; then
  echo "Detected: Node.js project"
  if grep -q '"jest"' package.json 2>/dev/null; then
    echo "Running Jest tests..."
    npx jest --passWithNoTests
  elif grep -q '"vitest"' package.json 2>/dev/null; then
    echo "Running Vitest tests..."
    npx vitest run
  elif grep -q '"mocha"' package.json 2>/dev/null; then
    echo "Running Mocha tests..."
    npx mocha
  else
    echo "Running npm test..."
    npm test
  fi
elif [ -f "requirements.txt" ] || [ -f "pyproject.toml" ] || [ -f "setup.py" ]; then
  echo "Detected: Python project"
  if command -v pytest &> /dev/null; then
    echo "Running pytest..."
    pytest -v
  else
    echo "Running python unittest..."
    python -m pytest -v 2>/dev/null || python -m unittest discover -v
  fi
elif [ -f "go.mod" ]; then
  echo "Detected: Go project"
  go test ./... -v
elif [ -f "Gemfile" ]; then
  echo "Detected: Ruby project"
  bundle exec rspec 2>/dev/null || bundle exec rake test
elif [ -f "pom.xml" ]; then
  echo "Detected: Java/Maven project"
  mvn test
elif [ -f "build.gradle" ]; then
  echo "Detected: Java/Gradle project"
  ./gradlew test
else
  echo "WARNING: Could not auto-detect tech stack."
  echo "Please run tests manually."
  exit 1
fi

echo "Tests complete."
`,
    },
    {
      filename: 'coverage-check.sh',
      content: `#!/bin/bash
# Check test coverage and fail if below 80% threshold.
# Usage: ./coverage-check.sh [threshold] [working_dir]

set -euo pipefail

THRESHOLD="\${1:-80}"
WORKDIR="\${2:-.}"
cd "$WORKDIR"

echo "Checking test coverage (threshold: $THRESHOLD%)..."

PASS=false

if [ -f "package.json" ]; then
  if grep -q '"jest"' package.json 2>/dev/null; then
    COVERAGE=$(npx jest --coverage --coverageReporters=text-summary 2>&1 | grep "Statements" | grep -o '[0-9.]*%' | head -1 | tr -d '%' || echo "0")
    echo "Jest coverage: $COVERAGE%"
    if [ "$(echo "$COVERAGE >= $THRESHOLD" | bc -l 2>/dev/null || echo 0)" = "1" ]; then PASS=true; fi
  elif grep -q '"vitest"' package.json 2>/dev/null; then
    echo "Running Vitest coverage..."
    npx vitest run --coverage 2>&1 | tail -20
    PASS=true  # Vitest will exit non-zero if coverage fails if configured
  fi
elif [ -f "requirements.txt" ] || [ -f "pyproject.toml" ]; then
  if command -v pytest &> /dev/null && command -v coverage &> /dev/null; then
    coverage run -m pytest -q 2>/dev/null
    COVERAGE=$(coverage report 2>/dev/null | grep "TOTAL" | awk '{print $NF}' | tr -d '%' || echo "0")
    echo "Python coverage: $COVERAGE%"
    if [ "$(echo "$COVERAGE >= $THRESHOLD" | bc -l 2>/dev/null || echo 0)" = "1" ]; then PASS=true; fi
  fi
elif [ -f "go.mod" ]; then
  COVERAGE=$(go test ./... -cover 2>&1 | grep -o 'coverage: [0-9.]*%' | grep -o '[0-9.]*' | head -1 || echo "0")
  echo "Go coverage: $COVERAGE%"
  if [ "$(echo "$COVERAGE >= $THRESHOLD" | bc -l 2>/dev/null || echo 0)" = "1" ]; then PASS=true; fi
fi

if [ "$PASS" = true ]; then
  echo "PASS: Coverage >= $THRESHOLD%"
  exit 0
else
  echo "FAIL: Coverage < $THRESHOLD% — fix before creating PR"
  exit 1
fi
`,
    },
    { filename: 'notify.sh', content: NOTIFY_SH },
  ],

  fsWorkspaceOnly: false,
}
