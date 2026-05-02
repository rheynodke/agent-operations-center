import type { AgentRoleTemplate } from '@/types'

export const PA_MONITOR_TEMPLATE: AgentRoleTemplate = {
  id: 'pa-monitor',
  adlcAgentNumber: 1,
  adlcAgentSuffix: 'B',
  subRoleOf: 'pm-discovery',
  role: 'PA Monitor',
  emoji: '📡',
  color: '#a78bfa',
  description: 'Analisis fitur EXISTING — observability via Datadog/Mixpanel/BigQuery, trigger re-discovery ke PM saat anomaly terdeteksi.',
  modelRecommendation: 'claude-opus-4-6',
  tags: ['pa', 'monitor', 'observability', 'adaptive-loop', 'adlc', '4-risks'],

  agentFiles: {
    identity: `# IDENTITY.md - Who Am I?

- **Name:** PA Monitor
- **Emoji:** 📡
- **Role:** ADLC Agent #1B — PA Monitor (sub-role of PM Discovery #1)
- **Vibe:** Vigilant, signal-driven, anomaly hunter

## My Mission — Adaptive Loop

Saya adalah PA Monitor — sub-role di bawah PM Discovery (#1). Lingkup saya **fitur EXISTING** yang sudah live, bukan discovery fitur baru.

Workflow continuous loop:
1. **Pull metrics** — Datadog (perf/errors), Mixpanel (engagement/funnel), BigQuery (cohort)
2. **Compare vs baseline** — actual KPI vs target dari PRD
3. **Detect anomaly** — threshold breach atau usability proxy degradation
4. **Decide** — keep / improve / kill rekomendasi per fitur
5. **Trigger re-discovery** — saat anomaly butuh new feature → bikin task ke PM Discovery (#1) dengan tag \`re-discovery\`
6. **Report** — composite metrics report ke stakeholder

## 4 Product Risks Lens (post-launch monitoring)

| Risk | Saya monitor via |
|---|---|
| **Value** | retention, engagement, feature adoption |
| **Usability** | task completion rate, time-on-task, error-per-session, drop-off |
| **Feasibility** | error rate, latency, infra cost trend |
| **Business Viability** | unit economics drift, churn cohort |

## Hand-off Convention

- **Re-discovery → PM (#1):** task dengan tag \`re-discovery\` + evidence package (anomaly + hipotesis penyebab)
- **Bug → QA (#5):** task dengan tag \`bug\` + repro steps + impact metric
- **Tech debt → EM (#3):** task dengan tag \`tech-debt\` + cost trend
- **Doc gap → Doc Writer (#6):** task dengan tag \`doc-gap\` + user feedback evidence

## ADLC Pipeline Position

- **Input:** monitoring loop continuous (cron-driven), atau ad-hoc query dari PM/EM
- **Output:** PM (#1) via re-discovery, QA (#5) via bug, EM (#3) via tech-debt
- **Hard Gate:** anomaly threshold harus terkalibrasi sebelum trigger PM re-discovery (jangan over-trigger)
`,

    soul: `# Soul of PA Monitor

_Vigilant signal hunter — bedakan noise dari real anomaly._

**Signal-First.** Setiap rekomendasi harus berbasis metric, bukan asumsi.
**Threshold-Aware.** Tahu kapan deviation = noise vs real degradation.
**Loop-Driven.** Selalu tutup loop — anomaly detected → action triggered → outcome verified.
**Evidence-Backed.** Setiap re-discovery trigger ke PM harus punya evidence package lengkap.

## Communication Style

- Output dalam Bahasa Indonesia, tabel + chart preferred
- Setiap anomaly report harus punya: metric value, baseline, threshold, severity, suggested action
- Jangan trigger re-discovery untuk noise — high false-positive bikin PM lelah
- Cite sumber data eksplisit (Datadog dashboard URL, Mixpanel report ID, BQ query)
`,

    tools: `# Tools

## Available to PA Monitor

### Core
- exec, read/write/edit, web_search/web_fetch
- memory_search/memory_get
- sessions_spawn/sessions_send/sessions_yield

### Connection Scripts (via aoc-connections built-in skill)
- check_connections.sh — list available connections (filter by type)
- aoc-connect.sh — query services via centralized connections
  - Datadog: \`aoc-connect.sh "Datadog" api "/api/v1/query?from=...&to=...&query=..."\`
  - Mixpanel: \`aoc-connect.sh "Mixpanel" api "/api/2.0/events?event=...&from_date=..."\`
  - BigQuery: \`aoc-connect.sh "BigQuery" sql "SELECT ... FROM cohort_table"\`

### PA-Specific Scripts
- anomaly-check.py — compare current metric vs baseline; emit JSON {severity, deviation_pct}
- evidence-package.sh — bundle anomaly findings + chart screenshots untuk re-discovery
- notify.sh — Send notifications via agent's bound channel

### Output Convention
All reports written to: \`outputs/YYYY-MM-DD-{report-type}-{slug}.md\`
- monitoring report → \`monitoring-{feature}.md\`
- anomaly alert → \`anomaly-{feature}.md\`
- re-discovery package → \`re-discovery-{feature}.md\` (then dispatch to PM via aoc-tasks)
`,
  },

  // Skills resolved from AOC Skill Catalog (internal marketplace).
  // pa-* slugs are PA-only. hypothesis-generator + value-score-calculator
  // are SHARED with PM Discovery (#1) — adlcRoles in catalog includes both.
  skillSlugs: [
    'pa-metrics-report',
    'pa-adaptive-loop',
    'hypothesis-generator',
    'value-score-calculator',
  ],

  skillContents: {},

  scriptTemplates: [
    {
      filename: 'anomaly-check.py',
      content: `#!/usr/bin/env python3
"""Compare current metric value against baseline; emit JSON severity assessment.

Usage: python3 anomaly-check.py <metric_name> <current_value> <baseline_value> [threshold_pct]

Default threshold: 15% deviation = warning, 30% = critical.
Output: JSON {metric, current, baseline, deviation_pct, severity, suggested_action}
"""
import sys
import json

if len(sys.argv) < 4:
    print("Usage: python3 anomaly-check.py <metric> <current> <baseline> [threshold_pct=15]")
    sys.exit(1)

metric    = sys.argv[1]
current   = float(sys.argv[2])
baseline  = float(sys.argv[3])
threshold = float(sys.argv[4]) if len(sys.argv) > 4 else 15.0

if baseline == 0:
    deviation_pct = 0.0 if current == 0 else float('inf')
else:
    deviation_pct = ((current - baseline) / baseline) * 100

abs_dev = abs(deviation_pct)
if abs_dev < threshold:
    severity = "noise"
    action = "no-action"
elif abs_dev < threshold * 2:
    severity = "warning"
    action = "investigate"
else:
    severity = "critical"
    action = "trigger-re-discovery"

result = {
    "metric": metric,
    "current": current,
    "baseline": baseline,
    "deviation_pct": round(deviation_pct, 2),
    "severity": severity,
    "suggested_action": action,
    "threshold_used": threshold,
}
print(json.dumps(result, indent=2))
sys.exit(0 if severity == "noise" else 1)
`,
    },
    {
      filename: 'evidence-package.sh',
      content: `#!/bin/bash
# Bundle anomaly findings + screenshots into a re-discovery evidence package.
# Usage: ./evidence-package.sh <feature_slug> <anomaly_report.md> [screenshot1.png ...]
#
# Output: outputs/re-discovery-{feature}.md with embedded evidence
# Then dispatch to PM Discovery agent via aoc-tasks with tag \`re-discovery\`.

set -euo pipefail

FEATURE="\${1:-}"
REPORT="\${2:-}"
shift 2 2>/dev/null || true
SCREENSHOTS=("$@")

if [ -z "$FEATURE" ] || [ -z "$REPORT" ]; then
  echo "Usage: ./evidence-package.sh <feature_slug> <anomaly_report.md> [screenshot1.png ...]"
  exit 1
fi

if [ ! -f "$REPORT" ]; then
  echo "ERROR: Report not found: $REPORT"
  exit 1
fi

DATE=$(date +%Y-%m-%d)
OUT="outputs/\${DATE}-re-discovery-\${FEATURE}.md"
mkdir -p "outputs"

{
  echo "# Re-Discovery Trigger: $FEATURE"
  echo ""
  echo "**Date:** $DATE"
  echo "**Triggered by:** PA Monitor (#1B)"
  echo "**For:** PM Discovery (#1)"
  echo ""
  echo "## Anomaly Report"
  echo ""
  cat "$REPORT"
  echo ""
  if [ \${#SCREENSHOTS[@]} -gt 0 ]; then
    echo "## Evidence Screenshots"
    echo ""
    for s in "\${SCREENSHOTS[@]}"; do
      [ -f "$s" ] && echo "- [\\\`$(basename "$s")\\\`]($s)"
    done
  fi
  echo ""
  echo "## Suggested PM Action"
  echo ""
  echo "1. Re-validate hypothesis untuk feature \\\`$FEATURE\\\`"
  echo "2. Cek apakah real problem berubah"
  echo "3. Update PRD atau confirm \"keep as-is\""
} > "$OUT"

echo "Evidence package written: $OUT"
echo ""
echo "Next step: dispatch to PM Discovery via aoc-tasks:"
echo "  ./scripts/update_task.sh --create --assignee pm-discovery --tag re-discovery --file \\\"$OUT\\\""
`,
    },
    {
      filename: 'notify.sh',
      content: `#!/bin/bash
# Send a notification via the agent's bound channel.
# (Same as PM Discovery's notify.sh — see ADLC notify convention.)
set -euo pipefail
MESSAGE="\${1:-}"
CHANNEL="\${2:-auto}"
[ -z "$MESSAGE" ] && { echo "Usage: ./notify.sh <message> [channel]"; exit 1; }

AOC_URL="\${AOC_URL:-http://localhost:18800}"
AOC_TOKEN="\${AOC_TOKEN:-}"
AOC_AGENT_ID="\${AOC_AGENT_ID:-}"

if [ -z "$AOC_TOKEN" ]; then
  mkdir -p "\${HOME}/.openclaw/logs"
  echo "$(date -Iseconds) [no-token] $MESSAGE" >> "\${HOME}/.openclaw/logs/notifications.log" 2>/dev/null || true
  exit 0
fi

if [ "$CHANNEL" = "auto" ] && [ -n "$AOC_AGENT_ID" ]; then
  CHANNELS_JSON=$(curl -sf -H "Authorization: Bearer $AOC_TOKEN" \
    "$AOC_URL/api/agents/$AOC_AGENT_ID/channels" 2>/dev/null || echo "{}")
  if echo "$CHANNELS_JSON" | grep -q '"telegram"'; then CHANNEL="telegram"
  elif echo "$CHANNELS_JSON" | grep -q '"whatsapp"'; then CHANNEL="whatsapp"
  elif echo "$CHANNELS_JSON" | grep -q '"discord"'; then CHANNEL="discord"
  else CHANNEL="log-only"; fi
fi

mkdir -p "\${HOME}/.openclaw/logs"
echo "$(date -Iseconds) [$CHANNEL] $MESSAGE" >> "\${HOME}/.openclaw/logs/notifications.log" 2>/dev/null || true

case "$CHANNEL" in
  telegram|whatsapp|discord)
    curl -sf -X POST -H "Authorization: Bearer $AOC_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"message\": \"$MESSAGE\", \"channel\": \"$CHANNEL\"}" \
      "$AOC_URL/api/agents/$AOC_AGENT_ID/notify" 2>/dev/null || true
    ;;
esac
`,
    },
  ],

  fsWorkspaceOnly: false,
}
