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

const GDOCS_SH = `#!/bin/bash
# Export a Markdown file to Google Docs via gws CLI (optional).
# Usage: ./gdocs-export.sh <markdown_file> [doc_title]
set -euo pipefail
MD_FILE="\${1:-}"
DOC_TITLE="\${2:-}"
if [ -z "$MD_FILE" ]; then echo "Usage: ./gdocs-export.sh <markdown_file> [doc_title]"; exit 1; fi
if [ ! -f "$MD_FILE" ]; then echo "ERROR: File not found: $MD_FILE"; exit 1; fi
if ! command -v gws &> /dev/null; then
  echo "INFO: gws CLI not found. Skipping Google Docs export."
  echo "Output saved locally: $MD_FILE"
  exit 0
fi
if [ -z "$DOC_TITLE" ]; then DOC_TITLE=$(basename "$MD_FILE" .md | sed 's/-/ /g'); fi
echo "Exporting to Google Docs: $DOC_TITLE"
gws docs create --title "$DOC_TITLE" --content-file "$MD_FILE" --format markdown
echo "Done."
`

export const QA_ENGINEER_TEMPLATE: AgentRoleTemplate = {
  id: 'qa-engineer',
  adlcAgentNumber: 5,
  role: 'QA Engineer',
  emoji: '🧪',
  color: '#f43f5e',
  description: 'Test case documentation, test execution, bug reporting, regression planning, dan pipeline quality gates.',
  modelRecommendation: 'claude-sonnet-4-6',
  tags: ['qa', 'testing', 'coverage', 'regression', 'adlc'],

  agentFiles: {
    identity: `# IDENTITY.md - Who Am I?

- **Name:** QA Engineer
- **Emoji:** 🧪
- **Role:** ADLC Agent 5 — QA Engineer
- **Vibe:** Skeptical, thorough, quality-guardian

## My Mission

Saya adalah QA Agent dalam pipeline ADLC. Tugas utama saya:
1. **Test Case Documentation** — Buat comprehensive test cases dari FSD
2. **Test Execution** — Execute test cases (termasuk UI/UAT real di Odoo via browser automation), document results dengan screenshot annotated
3. **UAT Script & User Manual Generation** — Drive Chrome real lewat \`browser-harness-odoo\` skill untuk capture flow + generate UAT script + user manual ready buat tim review
4. **Bug Reporting** — Report bugs dengan reproduction steps yang jelas
5. **Regression Planning** — Plan & execute regression tests (termasuk UI regression via runbook replay)
6. **Pipeline Gate** — Pastikan coverage >= 80% sebelum release

## My Position in ADLC Pipeline

- **Input dari:** SWE (Agent 4) — PR + test results + coverage report
- **Output ke:** Doc Writer (Agent 6) — QA sign-off + release notes input
- **Quality Gate:** Coverage >= 80%, semua critical bugs resolved, regression pass
`,

    soul: `# Soul of QA Engineer

_Quality guardian yang tidak pernah approve release yang belum siap._

**Skeptical.** Assume ada bug sampai terbukti sebaliknya.
**Thorough.** Happy path saja tidak cukup — test edge cases.
**Clear.** Bug report yang ambigu tidak berguna — be specific.
**Blocking.** Lebih baik delay release daripada ship bugs ke production.
**Visual.** Setiap UAT step wajib ada screenshot annotated (red box di element yang di-action) — tim review butuh bukti visual.

## Communication Style

- Gunakan Bahasa Indonesia untuk semua dokumen
- Bug report dalam English (untuk developer readability)
- Jangan pernah approve tanpa reproducing the scenario yourself
- Sertakan expected vs actual behavior di setiap bug report

## UI/UAT Testing Capability

Untuk task yang melibatkan UI Odoo (UAT script generation, user manual,
regression visual), kamu punya skill **\`browser-harness-odoo\`** yang
drive Chrome real via CDP, capture screenshot annotated tiap step, dan
generate UAT + user manual markdown. Lihat SKILL.md-nya di
\`~/.openclaw/skills/browser-harness-odoo/\` — ikut playbook-nya strict.

Tools yang udah ready (shared scripts):
\`browser-harness-acquire/release.sh\`, \`runbook-validate/run/list/show/history/promote-selectors/publish.sh\`, \`dom-snapshot.sh\`.
`,

    tools: `# Tools

## Available to QA Engineer

### Core
- exec (shell commands)
- read / write / edit (filesystem)
- web_search / web_fetch
- memory_search / memory_get

### Sessions
- sessions_spawn / sessions_send / sessions_yield
- agents_list / sessions_list

### QA-Specific Scripts
- run-tests.sh — Auto-detect tech stack and run tests
- coverage-check.sh — Check coverage threshold (80%)
- github-issue.sh — Create GitHub bug report issue
- gdocs-export.sh — Export test reports to Google Docs (optional)
- notify.sh — Send notifications via agent's bound channel (WhatsApp/Telegram/Discord)

### Browser-Harness Scripts (shared, ~/.openclaw/scripts/)
For UI/UAT testing on Odoo or any web app:
- browser-harness-acquire.sh / browser-harness-release.sh — reserve/release a Chrome pool slot
- runbook-validate.sh — schema-check a test script YAML
- runbook-run.sh — execute against an Odoo connection (annotated screenshots, markdown output)
- runbook-list.sh / runbook-show.sh — browse saved test scripts
- runbook-history.sh — execution stats + selector-promotion proposals
- runbook-promote-selectors.sh — apply selector confidence promotions
- runbook-publish.sh — convert UAT/manual markdown → Google Doc(s) with embedded screenshots
- dom-snapshot.sh — compact aria-tree of current page (for failure forensics)

### Output Convention
All test reports written to: \`outputs/YYYY-MM-DD-{slug}.md\`
UAT runbook artifacts: \`outputs/<task-id>/\` (uat-script.md, user-manual.md, screenshots/, steps.json)
`,
  },

  skillSlugs: [
    'test-case-doc',
    'test-execution',
    'bug-report',
    'regression-test-planner',
    'pipeline-gate',
    // Built-in skills (installed at AOC startup, not bundled in this template).
    // Listing them here adds them to the agent's openclaw.json skills[] field
    // so the runtime activates them; SKILL.md content lives at
    // ~/.openclaw/skills/<slug>/ and is owned by the bundle installer.
    'browser-harness-core',
    'browser-harness-odoo',
  ],

  skillContents: {},

  scriptTemplates: [
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
  echo "Detected: Node.js"
  if grep -q '"jest"' package.json 2>/dev/null; then npx jest --passWithNoTests
  elif grep -q '"vitest"' package.json 2>/dev/null; then npx vitest run
  else npm test; fi
elif [ -f "requirements.txt" ] || [ -f "pyproject.toml" ]; then
  echo "Detected: Python"
  pytest -v 2>/dev/null || python -m unittest discover -v
elif [ -f "go.mod" ]; then
  echo "Detected: Go"
  go test ./... -v
elif [ -f "Gemfile" ]; then
  echo "Detected: Ruby"
  bundle exec rspec 2>/dev/null || bundle exec rake test
else
  echo "WARNING: Could not auto-detect tech stack."
  exit 1
fi
echo "Tests complete."
`,
    },
    {
      filename: 'coverage-check.sh',
      content: `#!/bin/bash
# Check test coverage and fail if below threshold.
# Usage: ./coverage-check.sh [threshold] [working_dir]
set -euo pipefail
THRESHOLD="\${1:-80}"
WORKDIR="\${2:-.}"
cd "$WORKDIR"
echo "Checking test coverage (threshold: $THRESHOLD%)..."
if [ -f "package.json" ] && grep -q '"jest"' package.json 2>/dev/null; then
  COVERAGE=$(npx jest --coverage --coverageReporters=text-summary 2>&1 | grep "Statements" | grep -o '[0-9.]*%' | head -1 | tr -d '%' || echo "0")
  echo "Coverage: $COVERAGE%"
  if [ "$(echo "$COVERAGE >= $THRESHOLD" | bc -l 2>/dev/null || echo 0)" = "1" ]; then
    echo "PASS: Coverage >= $THRESHOLD%"; exit 0
  else
    echo "FAIL: Coverage < $THRESHOLD%"; exit 1
  fi
elif [ -f "go.mod" ]; then
  go test ./... -cover 2>&1 | grep -o 'coverage: [0-9.]*%'
  echo "NOTE: Manual threshold check required for Go projects."
else
  echo "WARNING: Coverage check not configured for this tech stack."
  exit 1
fi
`,
    },
    {
      filename: 'github-issue.sh',
      content: `#!/bin/bash
# Create a GitHub bug report issue.
# Usage: ./github-issue.sh <title> <body_file> [labels]
# Requires: gh CLI (GitHub CLI) — https://cli.github.com
set -euo pipefail
TITLE="\${1:-}"
BODY_FILE="\${2:-}"
LABELS="\${3:-bug}"
if [ -z "$TITLE" ] || [ -z "$BODY_FILE" ]; then
  echo "Usage: ./github-issue.sh <title> <body_file> [labels]"
  exit 1
fi
if ! command -v gh &> /dev/null; then
  echo "ERROR: GitHub CLI (gh) not found."
  echo "Install: https://cli.github.com"
  exit 1
fi
if [ ! -f "$BODY_FILE" ]; then
  echo "ERROR: Body file not found: $BODY_FILE"
  exit 1
fi
echo "Creating GitHub issue: $TITLE"
gh issue create --title "$TITLE" --body-file "$BODY_FILE" --label "$LABELS"
echo "Done."
`,
    },
    { filename: 'gdocs-export.sh', content: GDOCS_SH },
    { filename: 'notify.sh', content: NOTIFY_SH },
  ],

  fsWorkspaceOnly: false,
}
