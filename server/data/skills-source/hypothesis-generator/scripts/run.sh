#!/bin/bash
# Hypothesis Generator — produces a structured hypothesis Markdown document.
#
# Usage:
#./run.sh --topic "<slug>" \
# --action "<what we'll change>" \
# --outcome "<measurable outcome>" \
# --segment "<target user segment>" \
# --metric "<metric name>" \
# --threshold "<target value>" \
# --timeframe "<duration>" \
# --falsification "<counter-condition>" \
# [--output outputs/PATH.md]
#
# Optional: --assumptions "assumption 1|assumption 2|assumption 3"
# --confounders "confounder 1|confounder 2"

set -euo pipefail

TOPIC=""
ACTION=""
OUTCOME=""
SEGMENT=""
METRIC=""
THRESHOLD=""
TIMEFRAME=""
FALSIFICATION=""
ASSUMPTIONS=""
CONFOUNDERS=""
OUTPUT=""

while [ $# -gt 0 ]; do
 case "$1" in
 --topic) TOPIC="$2"; shift 2;;
 --action) ACTION="$2"; shift 2;;
 --outcome) OUTCOME="$2"; shift 2;;
 --segment) SEGMENT="$2"; shift 2;;
 --metric) METRIC="$2"; shift 2;;
 --threshold) THRESHOLD="$2"; shift 2;;
 --timeframe) TIMEFRAME="$2"; shift 2;;
 --falsification) FALSIFICATION="$2"; shift 2;;
 --assumptions) ASSUMPTIONS="$2"; shift 2;;
 --confounders) CONFOUNDERS="$2"; shift 2;;
 --output) OUTPUT="$2"; shift 2;;
 -h|--help) grep '^#' "$0" | sed 's/^# \?//'; exit 0;;
 *) echo "Unknown arg: $1"; exit 1;;
 esac
done

for var in TOPIC ACTION OUTCOME SEGMENT METRIC THRESHOLD TIMEFRAME FALSIFICATION; do
 if [ -z "${!var}" ]; then
 echo "ERROR: --$(echo "$var" | tr '[:upper:]' '[:lower:]') is required"
 exit 1
 fi
done

DATE=$(date +%Y-%m-%d)
[ -z "$OUTPUT" ] && OUTPUT="outputs/${DATE}-hypothesis-${TOPIC}.md"
mkdir -p "$(dirname "$OUTPUT")"

# Render assumptions
ASSUMPTIONS_BLOCK=""
if [ -n "$ASSUMPTIONS" ]; then
 IFS='|' read -ra ARR <<< "$ASSUMPTIONS"
 i=1
 for a in "${ARR[@]}"; do
 flag=""
 [ "$i" = "1" ] && flag=" **[RISKY]**"
 ASSUMPTIONS_BLOCK="${ASSUMPTIONS_BLOCK}${i}.${flag} ${a}
"
 i=$((i+1))
 done
else
 ASSUMPTIONS_BLOCK="1. **[RISKY]** _[fill: riskiest assumption]_
2. _[fill: assumption 2]_
3. _[fill: assumption 3]_
"
fi

# Render confounders
CONFOUNDERS_BLOCK=""
if [ -n "$CONFOUNDERS" ]; then
 IFS='|' read -ra ARR <<< "$CONFOUNDERS"
 for c in "${ARR[@]}"; do
 CONFOUNDERS_BLOCK="${CONFOUNDERS_BLOCK}- ${c}
"
 done
else
 CONFOUNDERS_BLOCK="- _[fill: confounding variable to control]_
"
fi

cat > "$OUTPUT" <<EOF
# Hypothesis: ${TOPIC}

**Date:** ${DATE}
**Status:** draft — pending CPO approval

## Statement

> **Kami percaya** ${ACTION} **akan menghasilkan** ${OUTCOME} **untuk** ${SEGMENT}.
> **Kami akan tahu berhasil ketika** \`${METRIC}\` **mencapai** ${THRESHOLD} **dalam** ${TIMEFRAME}.

## Falsification

${FALSIFICATION}

## Variables

| Role | Variable |
|---|---|
| Independent (IV) — what we change | ${ACTION} |
| Dependent (DV) — what we measure | \`${METRIC}\` |

### Confounders to control

${CONFOUNDERS_BLOCK}

## Underlying Assumptions

${ASSUMPTIONS_BLOCK}

## Validation Plan

| Phase | Method | Duration |
|---|---|---|
| Validate riskiest assumption | _[qualitative interview / data check]_ | _[1 week]_ |
| Build minimum testable | _[scope]_ | _[2-4 weeks]_ |
| Measure | _[A/B test or pre/post comparison]_ | ${TIMEFRAME} |

## Sign-off

- [ ] CPO Approval — _Name, Date_
- [ ] EM Feasibility Check — _Name, Date_
EOF

echo "Wrote: $OUTPUT"
echo "Topic: $TOPIC"
echo "Metric: $METRIC | Target: $THRESHOLD | Timeframe: $TIMEFRAME"
