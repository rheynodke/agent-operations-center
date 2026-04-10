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
# linear-create-task.sh — Buat task di Linear untuk ADLC sprint (FR-06)
# Usage: ./linear-create-task.sh <title> <description> [priority] [team_id] [label]
# Priority: 0=No, 1=Urgent, 2=High, 3=Medium, 4=Low
# Requires: LINEAR_API_KEY environment variable
#
# Examples:
#   ./linear-create-task.sh "Implement checkout API" "Based on FSD section 3.2" 2
#   ./linear-create-task.sh "BUG: Payment timeout" "Found in QA staging" 1 "" "bug"

set -euo pipefail

TITLE="\${1:?Usage: $0 <title> <description> [priority] [team_id] [label]}"
DESCRIPTION="\${2:-}"
PRIORITY="\${3:-3}"
TEAM_ID="\${4:-$LINEAR_TEAM_ID}"
LABEL="\${5:-}"

LINEAR_API_KEY="\${LINEAR_API_KEY:?LINEAR_API_KEY is required}"
TEAM_ID="\${TEAM_ID:?Provide team_id or set LINEAR_TEAM_ID env var}"

# Build label filter if provided
LABEL_MUTATION=""
if [[ -n "$LABEL" ]]; then
  # This assumes you have the label ID — in production, look it up first
  LABEL_MUTATION=", labelIds: [\\"$LABEL\\"]"
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

RESPONSE=$(curl -sf "https://api.linear.app/graphql" \\
  -H "Authorization: $LINEAR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d "$(python3 -c "import json,sys; print(json.dumps({'query': sys.argv[1]}))" "$MUTATION")")

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
