#!/bin/bash
# Competitor UX Analysis — scaffold a comparative analysis document.
#
# Usage:
#   ./analyze.sh --flow "<slug>" --competitors "comp1,comp2,comp3" \
#                [--captures-dir PATH] [--output PATH]

set -euo pipefail

FLOW=""
COMPETITORS=""
CAPTURES_DIR=""
OUTPUT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --flow)         FLOW="$2"; shift 2;;
    --competitors)  COMPETITORS="$2"; shift 2;;
    --captures-dir) CAPTURES_DIR="$2"; shift 2;;
    --output)       OUTPUT="$2"; shift 2;;
    -h|--help)      grep '^#' "$0" | sed 's/^# \?//'; exit 0;;
    *) echo "Unknown arg: $1"; exit 1;;
  esac
done

[ -z "$FLOW" ] && { echo "ERROR: --flow required"; exit 1; }
[ -z "$COMPETITORS" ] && { echo "ERROR: --competitors required (comma-separated)"; exit 1; }

DATE=$(date +%Y-%m-%d)
[ -z "$OUTPUT" ] && OUTPUT="outputs/${DATE}-competitor-ux-${FLOW}.md"
mkdir -p "$(dirname "$OUTPUT")"

# Build matrix header
IFS=',' read -ra COMPS <<< "$COMPETITORS"
COUNT=${#COMPS[@]}

if [ "$COUNT" -lt 3 ]; then
  echo "WARNING: Only $COUNT competitors specified. Recommended minimum: 3."
fi

# Generate matrix table header
HEADER="| Heuristic | Us |"
SEPARATOR="|---|---|"
for c in "${COMPS[@]}"; do
  HEADER="${HEADER} ${c} |"
  SEPARATOR="${SEPARATOR}---|"
done
HEADER="${HEADER} Best in class |"
SEPARATOR="${SEPARATOR}---|"

# Heuristics rows
HEURISTICS=(
  "H1 Visibility of system status"
  "H2 Match real world"
  "H3 User control & freedom"
  "H4 Consistency & standards"
  "H5 Error prevention"
  "H6 Recognition over recall"
  "H7 Flexibility & efficiency"
  "H8 Aesthetic & minimalist"
  "H9 Help recognize/recover errors"
  "H10 Help & documentation"
)

MATRIX_ROWS=""
for h in "${HEURISTICS[@]}"; do
  ROW="| ${h} | _[1-5]_ |"
  for _ in "${COMPS[@]}"; do
    ROW="${ROW} _[1-5]_ |"
  done
  ROW="${ROW} _[]_ |"
  MATRIX_ROWS="${MATRIX_ROWS}${ROW}
"
done

cat > "$OUTPUT" <<EOF
# Competitor UX Analysis: ${FLOW}

**Date:** ${DATE}
**Status:** draft
**Flow scope:** ${FLOW}
**Competitors:** ${COUNT} (${COMPETITORS})
**Captures dir:** ${CAPTURES_DIR:-_[fill]_}

## Executive Summary

> 5-7 bullets synthesizing top patterns and adopt/avoid recommendations.

- _[top finding 1]_
- _[top adopt]_
- _[top avoid]_

## Methodology

| | |
|---|---|
| Framework | Nielsen 10 Heuristics + flow-specific (${FLOW}) |
| Scoring | 1-5 scale (5=exemplary, 1=failed) |
| Capture method | browser-harness automated screen capture |
| Per competitor | minimum 3 screens (entry + flow midpoint + edge case) |

### Competitor selection rationale

_[fill: criteria for picking these ${COUNT} — direct, adjacent, industry leader]_

## Per-Competitor Analysis

EOF

for c in "${COMPS[@]}"; do
cat >> "$OUTPUT" <<EOF
### ${c}

**Captures:** ${CAPTURES_DIR}/${c}/

| Screen | Note |
|---|---|
| Entry | _[]_ |
| Flow midpoint | _[]_ |
| Edge case | _[]_ |

**Heuristic findings (top observations):**
- _[heuristic + screenshot citation]_
- _[]_
- _[]_

**Top 3 strengths:**
1. _[]_
2. _[]_
3. _[]_

**Top 3 weaknesses:**
1. _[]_
2. _[]_
3. _[]_

EOF
done

cat >> "$OUTPUT" <<EOF
## Comparative Matrix

${HEADER}
${SEPARATOR}
${MATRIX_ROWS}

> Each cell: score 1-5 + evidence (screenshot citation or 1-line quote).

## Pattern Inventory

### Convergent patterns (3+ competitors use this)

| Pattern | Used by | Visual ref | Hypothesized rationale |
|---|---|---|---|
| _[pattern name]_ | _[A, B, C]_ | _[screenshot]_ | _[why it works]_ |

### Divergent patterns (split approach)

| Pattern | Variant A | Variant B | Tradeoff |
|---|---|---|---|
| _[pattern name]_ | _[approach + who]_ | _[approach + who]_ | _[]_ |

### Unique patterns (only 1 competitor)

| Pattern | Used by | Assessment |
|---|---|---|
| _[]_ | _[]_ | _[novel / bad bet]_ |

## Adopt / Avoid List

| Pattern | Recommendation | Rationale (contextual) |
|---|---|---|
| _[]_ | ADOPT / AVOID / INVESTIGATE | _[why this fits or doesn't fit our product]_ |

## Open Questions

- _[behind-paywall flow not captured]_
- _[mobile vs desktop coverage]_
- _[localized version comparison]_

## Sign-off

- [ ] UX Lead Review — _Name, Date_
EOF

echo "Wrote: $OUTPUT"
echo "Competitors: $COUNT"
[ "$COUNT" -lt 3 ] && echo "⚠️  Recommended minimum: 3 competitors."
