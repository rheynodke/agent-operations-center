#!/bin/bash
# PA Adaptive Loop — orchestrate one full monitoring iteration.
#
# Usage:
#./run-loop.sh --feature "<slug>" --cadence weekly|monthly|quarterly|adhoc
# [--window "7d"] (default depends on cadence)
# [--output PATH] (default outputs/...-pa-loop-{feature}.md)
#
# Composes pa-metrics-report + decision logic. Outputs a loop-run document
# with explicit decision (noise / improve / re-discovery / kill) and dispatches
# the corresponding action.

set -euo pipefail

FEATURE=""
CADENCE="weekly"
WINDOW=""
OUTPUT=""

while [ $# -gt 0 ]; do
 case "$1" in
 --feature) FEATURE="$2"; shift 2;;
 --cadence) CADENCE="$2"; shift 2;;
 --window) WINDOW="$2"; shift 2;;
 --output) OUTPUT="$2"; shift 2;;
 -h|--help) grep '^#' "$0" | sed 's/^# \?//'; exit 0;;
 *) echo "Unknown arg: $1"; exit 1;;
 esac
done

[ -z "$FEATURE" ] && { echo "ERROR: --feature required"; exit 1; }

# Default window per cadence
if [ -z "$WINDOW" ]; then
 case "$CADENCE" in
 daily) WINDOW="1d";;
 weekly) WINDOW="7d";;
 monthly) WINDOW="28d";;
 quarterly) WINDOW="90d";;
 *) WINDOW="7d";;
 esac
fi

DATE=$(date +%Y-%m-%d)
[ -z "$OUTPUT" ] && OUTPUT="outputs/${DATE}-pa-loop-${FEATURE}.md"
mkdir -p "$(dirname "$OUTPUT")"

cat > "$OUTPUT" <<EOF
# PA Adaptive Loop Run: ${FEATURE}

**Date:** ${DATE}
**Cadence:** ${CADENCE}
**Window:** ${WINDOW}
**Status:** in-progress — agent must complete

## Step 1 — Input

- Feature: \`${FEATURE}\`
- Cadence: ${CADENCE}
- PRD monitoring-spec: _[fill: link to PRD section, or "no spec — using defaults"]_

## Step 2 — Metrics Report

Run \`pa-metrics-report\` skill via:
\`\`\`bash
./skills/pa-metrics-report/scripts/metrics.sh --feature "${FEATURE}" --window "${WINDOW}"
\`\`\`

Output report: _[fill: link to outputs/...-pa-metrics-${FEATURE}.md]_

## Step 3 — Severity Summary

| Pillar | # noise | # warning | # critical |
|---|---|---|---|
| Retention | _[]_ | _[]_ | _[]_ |
| Engagement | _[]_ | _[]_ | _[]_ |
| Error rates | _[]_ | _[]_ | _[]_ |
| Usability proxies | _[]_ | _[]_ | _[]_ |

## Step 4 — Trend Confirmation (if any non-noise)

Prior 2 cycle reports:
- _[link to prior cycle 1]_
- _[link to prior cycle 2]_

| Metric (flagged) | This cycle | Prior 1 | Prior 2 | Persistent? |
|---|---|---|---|---|
| _[fill]_ | _[]_ | _[]_ | _[]_ | yes/no |

## Step 5 — Hypotheses (if any critical confirmed)

> Generate ≥2 hipotesis penyebab via \`hypothesis-generator\` skill.

| ID | Hypothesis | Likelihood | Testability | Validate via |
|---|---|---|---|---|
| H1 | _[]_ | high/med/low | cheap/exp | _[]_ |
| H2 | _[]_ | _[]_ | _[]_ | _[]_ |

Rank: ${1:-?} → ${2:-?}

## Step 6 — Decision Tree Outcome

**Decision:** \_\_\_\_\_

- [ ] noise (all metrics within ±15%, or warnings <3 cycles)
- [ ] improve (warnings 3+ cycles, no critical, fixable)
- [ ] re-discovery (1+ critical, 7-day persistent, hypotheses generated)
- [ ] kill candidate (3+ cycles decline, post-action no improve)

**Rationale:**
_[fill: 2-3 sentences]_

## Step 7 — Evidence Package (only if re-discovery)

Bundle artefacts:
- Metrics report: _[link]_
- Hypotheses doc: _[link]_
- Trend chart screenshots: _[paths]_
- Segment breakdown: _[link]_

## Step 8 — Dispatch Action

| Decision | Action taken |
|---|---|
| noise | (nothing — log only) |
| improve | \`update_task.sh --create --tag improve --assignee [team]\` — task: _[id]_ |
| re-discovery | \`re-discovery-trigger\` skill — task: _[id]_ |
| kill | escalate task to PM with kill rec — task: _[id]_ |

## Step 9 — Loop Run Log

\`\`\`bash
update_task.sh --create \\
 --tag monitoring \\
 --tag "feature:${FEATURE}" \\
 --tag "outcome:_____" \\
 --body "PA loop run ${DATE} (${CADENCE}): _____"
\`\`\`

Task created: _[task id]_

## Step 10 — Next Iteration

| Cadence | Next run date |
|---|---|
| ${CADENCE} | _[fill: based on cadence + decision]_ |

## Sign-off

- [ ] PA Lead — _Name, Date_
EOF

echo "Wrote loop run skeleton: $OUTPUT"
echo ""
echo "Next: agent must execute steps 2-10, fill placeholders, mark Status: complete."
