// ─── Task Management Script Templates ──────────────────────────────────────────

import type { ScriptTemplate } from '../types'

export const TASK_MANAGEMENT_SCRIPTS: ScriptTemplate[] = [

  {
    id: 'linear-create-task',
    name: 'Linear Task Creator',
    filename: 'linear-create-task.sh',
    description: 'Buat task di Linear untuk tracking ADLC sprint — Agent 3 & 4',
    category: 'Task Management',
    categoryEmoji: '📋',
    tags: ['linear', 'task', 'sprint', 'em-agent', 'adlc'],
    content: `#!/bin/zsh
# linear-create-task.sh — Buat task di Linear via aoc-connect.sh (FR-06)
# Usage: ./linear-create-task.sh <title> <description> [priority] [team_id] [label]
# Priority: 0=No, 1=Urgent, 2=High, 3=Medium, 4=Low
# Credentials: Managed via AOC Dashboard Connections (register Linear as Website connection)
#
# Examples:
#   ./linear-create-task.sh "Implement checkout API" "Based on FSD section 3.2" 2
#   ./linear-create-task.sh "BUG: Payment timeout" "Found in QA staging" 1 "" "bug"

set -euo pipefail

TITLE="\${1:?Usage: $0 <title> <description> [priority] [team_id] [label]}"
DESCRIPTION="\${2:-}"
PRIORITY="\${3:-3}"
TEAM_ID="\${4:-\${LINEAR_TEAM_ID:-}}"
LABEL="\${5:-}"
CONN_NAME="\${LINEAR_CONN_NAME:-Linear}"

source "\${OPENCLAW_HOME:-$HOME/.openclaw}/.aoc_env" 2>/dev/null || true
AOC_CONNECT="\${OPENCLAW_HOME:-$HOME/.openclaw}/scripts/aoc-connect.sh"

if [ ! -f "$AOC_CONNECT" ]; then
  echo "ERROR: aoc-connect.sh not found. Ensure AOC Dashboard connection scripts are installed."
  exit 1
fi

# Build label filter if provided
LABEL_MUTATION=""
if [[ -n "$LABEL" ]]; then
  LABEL_MUTATION=", labelIds: [\\"$LABEL\\"]"
fi

# If no team_id, discover teams first
if [[ -z "$TEAM_ID" ]]; then
  TEAMS=$($AOC_CONNECT "$CONN_NAME" api "graphql" 2>/dev/null <<< '{"query":"query { teams { nodes { id key name } } }"}' || echo "{}")
  echo "Available teams:"
  echo "$TEAMS" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for t in data.get('data',{}).get('teams',{}).get('nodes',[]):
    print(f'  {t[\"key\"]}: {t[\"name\"]} (id: {t[\"id\"]})')
" 2>/dev/null
  echo "ERROR: Provide team_id argument or set LINEAR_TEAM_ID env var"
  exit 1
fi

MUTATION=$(cat <<GRAPHQL
mutation {
  issueCreate(input: {
    title: "$(echo "$TITLE" | sed 's/"/\\"/g')"
    description: "$(echo "$DESCRIPTION" | sed 's/"/\\"/g')"
    priority: $PRIORITY
    teamId: "$TEAM_ID"
    $LABEL_MUTATION
  }) {
    success
    issue {
      id
      identifier
      title
      url
      priority
      state { name }
    }
  }
}
GRAPHQL
)

PAYLOAD=$(python3 -c "import json,sys; print(json.dumps({'query': sys.argv[1]}))" "$MUTATION")
RESPONSE=$($AOC_CONNECT "$CONN_NAME" api "graphql" 2>/dev/null <<< "$PAYLOAD" || echo "{}")

python3 -c "
import json, sys
data = json.loads('''$RESPONSE''')
result = data.get('data', {}).get('issueCreate', {})
if result.get('success'):
    issue = result['issue']
    print(json.dumps({
        'status': 'created',
        'id': issue['id'],
        'identifier': issue['identifier'],
        'title': issue['title'],
        'url': issue['url'],
        'priority': issue['priority'],
        'state': issue['state']['name'],
    }, indent=2))
else:
    errors = data.get('errors', [])
    print(json.dumps({'status': 'error', 'errors': errors}), file=sys.stderr)
    sys.exit(1)
"
`,
  },

]
