// ─── Notifications Script Templates ────────────────────────────────────────────

import type { ScriptTemplate } from '../types'

export const NOTIFICATIONS_SCRIPTS: ScriptTemplate[] = [

  {
    id: 'whatsapp-notify',
    name: 'WhatsApp Notification',
    filename: 'whatsapp-notify.sh',
    description: 'Kirim notifikasi checkpoint approval via WhatsApp untuk ADLC workflow',
    category: 'Notifications',
    categoryEmoji: '📨',
    tags: ['whatsapp', 'notification', 'checkpoint', 'fr-12', 'adlc'],
    content: `#!/bin/zsh
# whatsapp-notify.sh — Kirim notifikasi via WhatsApp untuk ADLC checkpoint (FR-12)
# Usage: ./whatsapp-notify.sh <phone> <message>
# Requires: WA_API_URL and WA_API_TOKEN environment variables
#
# Examples:
#   ./whatsapp-notify.sh "+628123456789" "PRD Feature X siap untuk di-review CPO"
#   ./whatsapp-notify.sh "+628123456789" "$(cat /tmp/approval-message.txt)"

set -euo pipefail

PHONE="\${1:?Usage: $0 <phone_number> <message>}"
MESSAGE="\${2:?Provide message text}"

WA_API_URL="\${WA_API_URL:?WA_API_URL is required (e.g. https://api.whatsapp.com/v1)}"
WA_API_TOKEN="\${WA_API_TOKEN:?WA_API_TOKEN is required}"

# Format phone (ensure starts with country code, no +)
PHONE_CLEAN=$(echo "$PHONE" | sed 's/[^0-9]//g' | sed 's/^0/62/')

PAYLOAD=$(python3 -c "
import json
print(json.dumps({
    'phone': '$PHONE_CLEAN',
    'message': '''$MESSAGE''',
    'isGroup': False,
}))
")

RESPONSE=$(curl -sf -X POST "$WA_API_URL/send" \\
  -H "Authorization: Bearer $WA_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d "$PAYLOAD" 2>&1) || {
  echo '{"status":"error","message":"Failed to send WhatsApp notification"}' >&2
  exit 1
}

echo '{"status":"sent","phone":"'$PHONE_CLEAN'","preview":"'$(echo "$MESSAGE" | head -c 50 | tr -d '\n')'..."}'
`,
  },

  {
    id: 'slack-alert',
    name: 'Slack Alert',
    filename: 'slack-alert.sh',
    description: 'Kirim alert ke Slack channel untuk notifikasi ADLC dan AI Ops',
    category: 'Notifications',
    categoryEmoji: '📨',
    tags: ['slack', 'notification', 'ops', 'adlc'],
    content: `#!/bin/zsh
# slack-alert.sh — Kirim alert ke Slack untuk ADLC workflow dan AI Ops
# Usage: ./slack-alert.sh <channel> <message> [severity]
# Requires: SLACK_WEBHOOK_URL environment variable
#
# Examples:
#   ./slack-alert.sh "#adlc-ops" "FSD Feature X siap untuk review CTO" "info"
#   ./slack-alert.sh "#adlc-alerts" "QA FAILED: Coverage 67% < 80% threshold" "critical"

set -euo pipefail

CHANNEL="\${1:?Usage: $0 <channel> <message> [severity]}"
MESSAGE="\${2:?Provide message}"
SEVERITY="\${3:-info}"

SLACK_WEBHOOK_URL="\${SLACK_WEBHOOK_URL:?SLACK_WEBHOOK_URL is required}"

# Color by severity
case "$SEVERITY" in
  critical) COLOR="#FF0000"; EMOJI="🚨" ;;
  warning)  COLOR="#FFA500"; EMOJI="⚠️" ;;
  success)  COLOR="#36A64F"; EMOJI="✅" ;;
  *)        COLOR="#0078D4"; EMOJI="ℹ️" ;;
esac

HOSTNAME=$(hostname)
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

PAYLOAD=$(python3 -c "
import json
payload = {
    'channel': '$CHANNEL',
    'attachments': [{
        'color': '$COLOR',
        'blocks': [
            {
                'type': 'header',
                'text': {'type': 'plain_text', 'text': '$EMOJI ADLC Notification'}
            },
            {
                'type': 'section',
                'text': {'type': 'mrkdwn', 'text': '''$MESSAGE'''}
            },
            {
                'type': 'context',
                'elements': [{
                    'type': 'mrkdwn',
                    'text': 'Severity: *$SEVERITY* | Agent: $HOSTNAME | $TIMESTAMP'
                }]
            }
        ]
    }]
}
print(json.dumps(payload))
")

RESPONSE=$(curl -sf -X POST "$SLACK_WEBHOOK_URL" \\
  -H "Content-Type: application/json" \\
  -d "$PAYLOAD")

if [[ "$RESPONSE" == "ok" ]]; then
  echo '{"status":"sent","channel":"$CHANNEL","severity":"$SEVERITY"}'
else
  echo '{"status":"error","response":"'$RESPONSE'"}' >&2
  exit 1
fi
`,
  },

]
