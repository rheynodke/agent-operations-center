// ─── Data Integration Script Templates ─────────────────────────────────────────

import type { ScriptTemplate } from '../types'

export const DATA_INTEGRATION_SCRIPTS: ScriptTemplate[] = [

  {
    id: 'datadog-query',
    name: 'Datadog Metrics Query',
    filename: 'datadog-query.sh',
    description: 'Query metrics dari Datadog API — retention, error rate, latency per fitur',
    category: 'Data Integration',
    categoryEmoji: '📡',
    tags: ['datadog', 'metrics', 'pa-agent', 'adlc'],
    content: `#!/bin/zsh
# datadog-query.sh — Query Datadog metrics via aoc-connect.sh (FR-02)
# Usage: ./datadog-query.sh <metric_name> <from_hours_ago> [tag_filter]
# Credentials: Managed via AOC Dashboard Connections (register Datadog as Website connection)
#
# Examples:
#   ./datadog-query.sh "avg:web.response_time" 168 "feature:checkout"
#   ./datadog-query.sh "sum:errors.count" 24 "env:production"

set -euo pipefail

METRIC="\${1:?Usage: $0 <metric_name> <from_hours_ago> [tag_filter]}"
HOURS="\${2:?Provide hours ago (e.g. 24, 168 for 7 days)}"
TAG_FILTER="\${3:-}"
CONN_NAME="\${DD_CONN_NAME:-Datadog}"

source "\${OPENCLAW_HOME:-$HOME/.openclaw}/.aoc_env" 2>/dev/null || true
AOC_CONNECT="\${OPENCLAW_HOME:-$HOME/.openclaw}/scripts/aoc-connect.sh"

if [ ! -f "$AOC_CONNECT" ]; then
  echo "ERROR: aoc-connect.sh not found. Ensure AOC Dashboard connection scripts are installed."
  exit 1
fi

NOW=$(date +%s)
FROM=$(( NOW - HOURS * 3600 ))

QUERY="$METRIC{*}"
if [[ -n "$TAG_FILTER" ]]; then
  QUERY="$METRIC{$TAG_FILTER}"
fi

RESPONSE=$($AOC_CONNECT "$CONN_NAME" api "api/v1/query?from=$FROM&to=$NOW&query=$QUERY" 2>/dev/null || echo "{}")

# Extract and summarize
echo "$RESPONSE" | python3 -c "
import json, sys
data = json.load(sys.stdin)
series = data.get('series', [])
if not series:
    print(json.dumps({'status': 'no_data', 'metric': '$METRIC', 'hours': $HOURS}))
    sys.exit(0)

results = []
for s in series:
    points = [p[1] for p in s.get('pointlist', []) if p[1] is not None]
    if points:
        results.append({
            'metric': s.get('metric', ''),
            'scope': s.get('scope', ''),
            'avg': round(sum(points) / len(points), 4),
            'min': round(min(points), 4),
            'max': round(max(points), 4),
            'latest': round(points[-1], 4),
            'datapoints': len(points),
        })

print(json.dumps({'status': 'ok', 'metric': '$METRIC', 'hours': $HOURS, 'results': results}, indent=2))
"
`,
  },

  {
    id: 'mixpanel-report',
    name: 'Mixpanel User Behavior Report',
    filename: 'mixpanel-report.sh',
    description: 'Pull user behavior data dari Mixpanel — engagement, retention, funnel per fitur',
    category: 'Data Integration',
    categoryEmoji: '📡',
    tags: ['mixpanel', 'analytics', 'pa-agent', 'adlc'],
    content: `#!/bin/zsh
# mixpanel-report.sh — Pull user behavior dari Mixpanel via aoc-connect.sh (FR-02)
# Usage: ./mixpanel-report.sh <event_name> <from_date> <to_date>
# Credentials: Managed via AOC Dashboard Connections (register Mixpanel as Website connection)
#
# Examples:
#   ./mixpanel-report.sh "checkout_complete" "2026-03-01" "2026-03-31"
#   ./mixpanel-report.sh "feature_used" "2026-04-01" "2026-04-09"

set -euo pipefail

EVENT="\${1:?Usage: $0 <event_name> <from_date> <to_date>}"
FROM="\${2:?Provide from date (YYYY-MM-DD)}"
TO="\${3:?Provide to date (YYYY-MM-DD)}"
CONN_NAME="\${MIXPANEL_CONN_NAME:-Mixpanel}"

source "\${OPENCLAW_HOME:-$HOME/.openclaw}/.aoc_env" 2>/dev/null || true
AOC_CONNECT="\${OPENCLAW_HOME:-$HOME/.openclaw}/scripts/aoc-connect.sh"

if [ ! -f "$AOC_CONNECT" ]; then
  echo "ERROR: aoc-connect.sh not found. Ensure AOC Dashboard connection scripts are installed."
  exit 1
fi

ENCODED_EVENT=$(python3 -c "import urllib.parse; print(urllib.parse.quote('[\"$EVENT\"]'))")
RESPONSE=$($AOC_CONNECT "$CONN_NAME" api "api/2.0/export/?event=$ENCODED_EVENT&from_date=$FROM&to_date=$TO&limit=1000" 2>/dev/null || echo "")

# Parse NDJSON response and aggregate
echo "$RESPONSE" | python3 -c "
import json, sys
from collections import Counter, defaultdict
from datetime import datetime

events = []
for line in sys.stdin:
    line = line.strip()
    if line:
        try:
            events.append(json.loads(line))
        except:
            pass

if not events:
    print(json.dumps({'status': 'no_data', 'event': '$EVENT', 'period': '$FROM to $TO'}))
    sys.exit(0)

# Count by date
by_date = Counter()
unique_users = set()
for e in events:
    props = e.get('properties', {})
    ts = props.get('time', 0)
    date = datetime.fromtimestamp(ts).strftime('%Y-%m-%d')
    by_date[date] += 1
    uid = props.get('distinct_id', '')
    if uid:
        unique_users.add(uid)

print(json.dumps({
    'status': 'ok',
    'event': '$EVENT',
    'period': '$FROM to $TO',
    'total_events': len(events),
    'unique_users': len(unique_users),
    'avg_daily': round(len(events) / max(len(by_date), 1), 1),
    'by_date': dict(sorted(by_date.items())),
}, indent=2))
"
`,
  },

  {
    id: 'github-pr-status',
    name: 'GitHub PR Status Checker',
    filename: 'github-pr-status.sh',
    description: 'Cek status PR di GitHub — review, CI, merge readiness untuk Agent 4',
    category: 'Data Integration',
    categoryEmoji: '📡',
    tags: ['github', 'pr', 'swe-agent', 'adlc'],
    content: `#!/bin/zsh
# github-pr-status.sh — Cek status PR GitHub untuk Agent 4 & QA (FR-06, FR-08)
# Usage: ./github-pr-status.sh <owner> <repo> <pr_number>
# Requires: GITHUB_TOKEN environment variable
#
# Examples:
#   ./github-pr-status.sh myorg myrepo 42
#   ./github-pr-status.sh myorg myrepo latest

set -euo pipefail

OWNER="\${1:?Usage: $0 <owner> <repo> <pr_number|latest>}"
REPO="\${2:?Provide repo name}"
PR_NUM="\${3:?Provide PR number or 'latest'}"
GITHUB_TOKEN="\${GITHUB_TOKEN:?GITHUB_TOKEN is required}"

API="https://api.github.com/repos/$OWNER/$REPO"
HEADERS=(-H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json")

# Resolve 'latest' to actual PR number
if [[ "$PR_NUM" == "latest" ]]; then
  PR_NUM=$(curl -sf "$API/pulls?state=open&sort=updated&direction=desc&per_page=1" "\${HEADERS[@]}" | python3 -c "import json,sys; prs=json.load(sys.stdin); print(prs[0]['number'] if prs else 0)")
  if [[ "$PR_NUM" == "0" ]]; then
    echo '{"status":"error","message":"No open PRs found"}'; exit 1
  fi
fi

# Get PR details
PR=$(curl -sf "$API/pulls/$PR_NUM" "\${HEADERS[@]}")

# Get reviews
REVIEWS=$(curl -sf "$API/pulls/$PR_NUM/reviews" "\${HEADERS[@]}")

# Get CI checks
CHECKS=$(curl -sf "$API/commits/$(echo "$PR" | python3 -c "import json,sys; print(json.load(sys.stdin)['head']['sha'])")/check-runs" "\${HEADERS[@]}")

python3 -c "
import json, sys

pr = $PR
reviews_raw = $REVIEWS
checks_raw = $CHECKS

# Aggregate reviews
review_states = {}
for r in reviews_raw:
    reviewer = r['user']['login']
    state = r['state']
    review_states[reviewer] = state

approved = sum(1 for s in review_states.values() if s == 'APPROVED')
changes_requested = sum(1 for s in review_states.values() if s == 'CHANGES_REQUESTED')

# CI checks
checks = checks_raw.get('check_runs', [])
passed = sum(1 for c in checks if c['conclusion'] == 'success')
failed = sum(1 for c in checks if c['conclusion'] in ['failure', 'cancelled'])
pending = sum(1 for c in checks if c['status'] == 'in_progress')

merge_ready = (
    pr['mergeable'] and
    approved >= 1 and
    changes_requested == 0 and
    failed == 0 and
    pending == 0
)

print(json.dumps({
    'pr': {
        'number': pr['number'],
        'title': pr['title'],
        'state': pr['state'],
        'draft': pr.get('draft', False),
        'url': pr['html_url'],
        'branch': pr['head']['ref'],
        'author': pr['user']['login'],
    },
    'reviews': {
        'approved': approved,
        'changes_requested': changes_requested,
        'reviewers': review_states,
    },
    'ci': {
        'passed': passed,
        'failed': failed,
        'pending': pending,
        'checks': [{'name': c['name'], 'status': c['status'], 'conclusion': c.get('conclusion')} for c in checks],
    },
    'merge_ready': merge_ready,
    'blockers': (
        (['changes_requested_by_reviewer'] if changes_requested > 0 else []) +
        (['ci_checks_failed'] if failed > 0 else []) +
        (['ci_checks_pending'] if pending > 0 else []) +
        (['no_approvals'] if approved == 0 else []) +
        (['not_mergeable'] if not pr.get('mergeable') else [])
    ),
}, indent=2))
"
`,
  },

]
