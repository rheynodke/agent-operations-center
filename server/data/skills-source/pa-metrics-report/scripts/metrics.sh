#!/bin/bash
# PA Metrics Report — scaffold a composite observability report.
#
# Usage:
#./metrics.sh --feature "<slug>" --window "<duration>" [--output PATH]
#
# Optional: --baseline-window "<duration>" (default = same as --window prior period)
# --segments "mobile|desktop" (pipe-separated)
# --sources "datadog|mixpanel|bq|odoo" (which connections to use; default all available)

set -euo pipefail

FEATURE=""
WINDOW=""
BASELINE_WINDOW=""
SEGMENTS=""
SOURCES=""
OUTPUT=""

while [ $# -gt 0 ]; do
 case "$1" in
 --feature) FEATURE="$2"; shift 2;;
 --window) WINDOW="$2"; shift 2;;
 --baseline-window) BASELINE_WINDOW="$2"; shift 2;;
 --segments) SEGMENTS="$2"; shift 2;;
 --sources) SOURCES="$2"; shift 2;;
 --output) OUTPUT="$2"; shift 2;;
 -h|--help) grep '^#' "$0" | sed 's/^# \?//'; exit 0;;
 *) echo "Unknown arg: $1"; exit 1;;
 esac
done

[ -z "$FEATURE" ] && { echo "ERROR: --feature required"; exit 1; }
[ -z "$WINDOW" ] && { echo "ERROR: --window required (e.g. 14d, 4w)"; exit 1; }
[ -z "$BASELINE_WINDOW" ] && BASELINE_WINDOW="$WINDOW (prior period)"

DATE=$(date +%Y-%m-%d)
[ -z "$OUTPUT" ] && OUTPUT="outputs/${DATE}-pa-metrics-${FEATURE}.md"
mkdir -p "$(dirname "$OUTPUT")"
mkdir -p "outputs/raw/${DATE}-${FEATURE}"

# Discover available connections
AVAILABLE_CONNS=""
if command -v check_connections.sh &>/dev/null; then
 AVAILABLE_CONNS=$(check_connections.sh 2>/dev/null | grep -oE '(Datadog|Mixpanel|BigQuery|Odoo|PostHog)' | sort -u | tr '\n' ',' | sed 's/,$//')
fi

cat > "$OUTPUT" <<EOF
# PA Metrics Report: ${FEATURE}

**Date:** ${DATE}
**Window:** ${WINDOW}
**Baseline:** ${BASELINE_WINDOW}
**Segments:** ${SEGMENTS:-all (no segment breakdown)}
**Sources used:** ${AVAILABLE_CONNS:-_[fill: which connections accessible]_}
**Status:** draft — agent must fill metric values

---

## Executive Summary

> _[fill: 2-3 sentences. Top finding + recommendation: keep / improve / kill / trigger-loop]_

## 1. Retention (Value risk)

| Metric | Baseline | Current | Δ | Severity | Source |
|---|---|---|---|---|---|
| D1 retention | _[%]_ | _[%]_ | _[+/-%]_ | _[noise/warn/crit]_ | _[Mixpanel report URL]_ |
| D7 retention | _[%]_ | _[%]_ | _[+/-%]_ | _[]_ | _[]_ |
| D30 retention | _[%]_ | _[%]_ | _[+/-%]_ | _[]_ | _[]_ |
| Churn rate | _[%/month]_ | _[]_ | _[]_ | _[]_ | _[]_ |

## 2. Engagement (Value + Usability risk)

| Metric | Baseline | Current | Δ | Severity | Source |
|---|---|---|---|---|---|
| DAU | _[N]_ | _[]_ | _[]_ | _[]_ | _[]_ |
| MAU | _[N]_ | _[]_ | _[]_ | _[]_ | _[]_ |
| DAU/MAU ratio | _[]_ | _[]_ | _[]_ | _[]_ | _[]_ |
| Avg session length | _[min]_ | _[]_ | _[]_ | _[]_ | _[]_ |
| Time-on-task (key flow) | _[s]_ | _[]_ | _[]_ | _[]_ | _[]_ |
| Feature adoption | _[%]_ | _[]_ | _[]_ | _[]_ | _[]_ |

## 3. Error Rates (Feasibility + Usability risk)

| Metric | Baseline | Current | Δ | Severity | Source |
|---|---|---|---|---|---|
| Server 5xx rate | _[per 1k req]_ | _[]_ | _[]_ | _[]_ | _[Datadog]_ |
| Client error rate | _[per 1k req]_ | _[]_ | _[]_ | _[]_ | _[]_ |
| Validation failures | _[%]_ | _[]_ | _[]_ | _[]_ | _[]_ |
| API p95 latency | _[ms]_ | _[]_ | _[]_ | _[]_ | _[]_ |

## 4. Usability Proxies (Usability risk)

| Metric | Baseline | Current | Δ | Severity | Source |
|---|---|---|---|---|---|
| Drop-off (key flow step) | _[%]_ | _[]_ | _[]_ | _[]_ | _[]_ |
| Errors per session | _[]_ | _[]_ | _[]_ | _[]_ | _[]_ |
| Support ticket volume | _[N/day]_ | _[]_ | _[]_ | _[]_ | _[Odoo helpdesk]_ |
| Self-service success rate | _[%]_ | _[]_ | _[]_ | _[]_ | _[]_ |

## Outliers / Segment Breakdown

> _[fill: kalau ada metric anomalous, breakdown per segment di sini]_

| Segment | Metric | Δ | Note |
|---|---|---|---|
| _[mobile]_ | _[]_ | _[]_ | _[]_ |
| _[desktop]_ | _[]_ | _[]_ | _[]_ |

## Risk Tagging Summary

| Pillar | V | U | F | B |
|---|:-:|:-:|:-:|:-:|
| Retention | _[]_ | | | |
| Engagement | _[]_ | _[]_ | | |
| Error rates | | _[]_ | _[]_ | |
| Usability proxies | | _[]_ | | |

## Critical Findings (severity: critical)

> _[fill: list metric yang severity critical, atau "none"]_

## Recommendation

**Decision: \_\_\_\_\_** (Keep / Improve / Kill candidate / Trigger pa-adaptive-loop)

**Rationale:**
1. _[finding]_ — _[implication]_
2. _[finding]_ — _[implication]_
3. _[finding]_ — _[implication]_

## Next Step

- [ ] If "Trigger pa-adaptive-loop" → run \`pa-adaptive-loop\` skill with this report as input
- [ ] If "Improve" → create task for owning team with specific change request
- [ ] If "Kill candidate" → escalate to PM via \`re-discovery-trigger\` with evidence
- [ ] If "Keep" → schedule next routine check per cadence

## Sign-off

- [ ] PA Lead — _Name, Date_
EOF

echo "Wrote skeleton: $OUTPUT"
echo "Raw data dir: outputs/raw/${DATE}-${FEATURE}/"
echo ""
echo "Next: agent must pull metric values via aoc-connect.sh, fill placeholders, mark Status: ready."
