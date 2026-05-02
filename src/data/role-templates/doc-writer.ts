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

export const DOC_WRITER_TEMPLATE: AgentRoleTemplate = {
  id: 'doc-writer',
  adlcAgentNumber: 6,
  role: 'Doc Writer',
  emoji: '📝',
  color: '#14b8a6',
  description: 'User guide generation, manual book, FAQ, troubleshooting guides, dan release notes dari QA-approved builds.',
  modelRecommendation: 'claude-sonnet-4-6',
  tags: ['docs', 'writing', 'release-notes', 'user-guide', 'adlc'],

  agentFiles: {
    identity: `# IDENTITY.md - Who Am I?

- **Name:** Doc Writer
- **Emoji:** 📝
- **Role:** ADLC Agent 6 — Documentation Writer
- **Vibe:** Clear, concise, user-focused technical writer

## My Mission

Saya adalah Doc Writer Agent dalam pipeline ADLC. Tugas utama saya:
1. **User Guide** — Buat user-friendly documentation
2. **Manual Book** — Comprehensive operational manual
3. **FAQ** — Common questions dari user feedback
4. **Troubleshooting Guide** — Step-by-step problem resolution
5. **Release Notes** — Changelog untuk setiap release

## My Position in ADLC Pipeline

- **Input dari:** QA (Agent 5) — release sign-off + feature list
- **Output ke:** Stakeholders + End Users — published documentation
- **Trigger:** Deploy event dari CI/CD pipeline
`,

    soul: `# Soul of Doc Writer

_Technical writer yang menulis untuk manusia, bukan untuk developer._

**Clarity.** Jika pembaca bingung, itu salah penulis — bukan pembaca.
**User-First.** Dokumentasi yang baik membuat user mandiri.
**Accurate.** Dokumentasi yang salah lebih buruk dari tidak ada dokumentasi.
**Maintained.** Dokumentasi harus diupdate setiap release.

## Communication Style

- Gunakan Bahasa Indonesia untuk dokumentasi user-facing
- Gunakan English untuk technical documentation
- Hindari jargon teknis tanpa penjelasan
- Sertakan screenshots atau diagram description untuk setiap step
`,

    tools: `# Tools

## Available to Doc Writer

### Core
- exec (shell commands)
- read / write / edit (filesystem)
- web_search / web_fetch
- memory_search / memory_get

### Sessions
- sessions_spawn / sessions_send / sessions_yield
- agents_list / sessions_list

### Connection Scripts (credentials handled automatically via AOC)
- check_connections.sh — List available connections. Usage: \`check_connections.sh [type]\`
- aoc-connect.sh — Access services via centralized connections (credentials never in stdout)

### Doc-Specific Scripts
- gdocs-export.sh — Export markdown to Google Docs (optional, requires gws CLI)
- notify.sh — Send notifications via agent's bound channel (WhatsApp/Telegram/Discord)
- email-notif.sh — Send email notifications via aoc-connect.sh or sendmail fallback
- deploy-trigger-listener.sh — Listen for deploy events to trigger doc updates

### Output Convention
All documents written to: \`outputs/YYYY-MM-DD-{slug}.md\`
`,
  },

  skillSlugs: [
    'user-guide-generator',
    'manual-book',
    'faq-generator',
    'troubleshooting-guide',
    'release-notes-writer',
  ],


  // All skill contents migrated to server/data/skills-source/ — resolved via skillSlugs at runtime
  skillContents: {},

  scriptTemplates: [
    { filename: 'gdocs-export.sh', content: GDOCS_SH },
    { filename: 'notify.sh', content: NOTIFY_SH },
    {
      filename: 'email-notif.sh',
      content: `#!/bin/bash
# Send an email notification for document publication.
# Usage: ./email-notif.sh <to> <subject> <body_file> [--connection "SMTP Server"]
#
# Tries aoc-connect.sh first (centralized SMTP credentials), falls back to sendmail.
# Register your SMTP server as a Website connection in AOC Dashboard.
set -euo pipefail
TO="\${1:-}"
SUBJECT="\${2:-}"
BODY_FILE="\${3:-}"
CONN_NAME="\${4:-SMTP}"
if [ -z "$TO" ] || [ -z "$SUBJECT" ] || [ -z "$BODY_FILE" ]; then
  echo "Usage: ./email-notif.sh <to> <subject> <body_file> [--connection name]"
  exit 1
fi
if [ ! -f "$BODY_FILE" ]; then echo "ERROR: Body file not found: $BODY_FILE"; exit 1; fi

source "\${OPENCLAW_HOME:-$HOME/.openclaw}/.aoc_env" 2>/dev/null || true

# Try centralized credentials via AOC
if [ -n "\${AOC_TOKEN:-}" ]; then
  CONN_JSON=$(curl -sf "$AOC_URL/api/agent/connections" \\
    -H "Authorization: Bearer $AOC_TOKEN" 2>/dev/null || echo "")
  SMTP_INFO=$(echo "$CONN_JSON" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    for c in data.get('connections', []):
        if c.get('name','').lower().find('smtp') >= 0 or c.get('name') == '$CONN_NAME':
            print(f'{c.get(\"url\",\"\")}|{c.get(\"username\",\"\")}|{c.get(\"password\",\"\")}')
            sys.exit(0)
except: pass
" 2>/dev/null || echo "")
  if [ -n "$SMTP_INFO" ]; then
    IFS='|' read -r SMTP_HOST SMTP_USER SMTP_PASS <<< "$SMTP_INFO"
    echo "Sending email via AOC connection: $SMTP_HOST"
    curl -sf --ssl-reqd \\
      --url "smtps://$SMTP_HOST:465" \\
      --user "$SMTP_USER:$SMTP_PASS" \\
      --mail-from "$SMTP_USER" \\
      --mail-rcpt "$TO" \\
      --upload-file "$BODY_FILE" 2>/dev/null && { echo "Email sent."; exit 0; } || echo "WARNING: SMTP delivery failed."
  fi
fi

# Fallback to sendmail
if command -v sendmail &> /dev/null; then
  echo "Sending via sendmail..."
  { echo "To: $TO"; echo "Subject: $SUBJECT"; echo ""; cat "$BODY_FILE"; } | sendmail "$TO"
  echo "Email queued via sendmail."
else
  echo "WARNING: No email delivery method configured."
  echo "Register an SMTP connection in AOC Dashboard, or install sendmail."
  echo "To: $TO | Subject: $SUBJECT"
  mkdir -p "\${HOME}/.openclaw/logs"
  echo "$(date -Iseconds) [email-pending] To: $TO Subject: $SUBJECT" >> "\${HOME}/.openclaw/logs/notifications.log" 2>/dev/null || true
fi
`,
    },
    {
      filename: 'deploy-trigger-listener.sh',
      content: `#!/bin/bash
# Listen for deploy events and trigger documentation updates.
# Usage: ./deploy-trigger-listener.sh [--once]
#
# Polls AOC API for deploy events tagged for this agent.
# When deploy event received, triggers documentation workflow.
set -euo pipefail
ONCE="\${1:-}"
AOC_URL="\${AOC_URL:-http://localhost:18800}"
AOC_TOKEN="\${AOC_TOKEN:-}"
AOC_AGENT_ID="\${AOC_AGENT_ID:-}"
if [ -z "$AOC_TOKEN" ]; then
  echo "ERROR: AOC_TOKEN not set."
  exit 1
fi
echo "Deploy trigger listener started for agent: $AOC_AGENT_ID"
echo "Polling: $AOC_URL/api/agents/$AOC_AGENT_ID/events?type=deploy"
while true; do
  EVENTS=$(curl -sf -H "Authorization: Bearer $AOC_TOKEN" \
    "$AOC_URL/api/agents/$AOC_AGENT_ID/events?type=deploy&limit=1" 2>/dev/null || echo "{}")
  if echo "$EVENTS" | grep -q '"type":"deploy"'; then
    echo "$(date -Iseconds) Deploy event received — triggering doc update workflow"
    ./notify.sh "Deploy event detected — starting documentation update"
    # Trigger doc update workflow here
    break
  fi
  [ "$ONCE" = "--once" ] && break
  sleep 60
done
echo "Done."
`,
    },
  ],

  fsWorkspaceOnly: false,
}
