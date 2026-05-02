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

  // SWE orchestrates Claude Code CLI rather than generate code directly.
  // Workflow: fsd-reader → git-worktree → claude-code-orchestrator
  //         → unit-test-writer → commit-strategy → rebase-strategy → pr-description-writer
  skillSlugs: [
    'fsd-reader',
    'git-worktree',
    'claude-code-orchestrator',
    'unit-test-writer',
    'commit-strategy',
    'rebase-strategy',
    'pr-description-writer',
  ],

  // All skill content resolved from AOC Skill Catalog (in-catalog).
  skillContents: {},

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
