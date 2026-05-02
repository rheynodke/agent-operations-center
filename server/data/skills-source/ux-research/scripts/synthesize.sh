#!/bin/bash
# UX Research synthesis — scaffold an insight memo from raw research data.
#
# Usage:
#   ./synthesize.sh --topic "<slug>" --question "<research question>" \
#                   --participants <N> [--output PATH]

set -euo pipefail

TOPIC=""
QUESTION=""
PARTICIPANTS=""
OUTPUT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --topic)        TOPIC="$2"; shift 2;;
    --question)     QUESTION="$2"; shift 2;;
    --participants) PARTICIPANTS="$2"; shift 2;;
    --output)       OUTPUT="$2"; shift 2;;
    -h|--help)      grep '^#' "$0" | sed 's/^# \?//'; exit 0;;
    *) echo "Unknown arg: $1"; exit 1;;
  esac
done

[ -z "$TOPIC" ] && { echo "ERROR: --topic required"; exit 1; }
[ -z "$QUESTION" ] && { echo "ERROR: --question required"; exit 1; }
[ -z "$PARTICIPANTS" ] && { echo "ERROR: --participants required"; exit 1; }

DATE=$(date +%Y-%m-%d)
[ -z "$OUTPUT" ] && OUTPUT="outputs/${DATE}-ux-insights-${TOPIC}.md"
mkdir -p "$(dirname "$OUTPUT")"

CONFIDENCE_FLAG=""
if [ "$PARTICIPANTS" -lt 5 ] 2>/dev/null; then
  CONFIDENCE_FLAG="

> ⚠️ **Low confidence:** sample n=$PARTICIPANTS < 5 (theme saturation threshold). Treat themes as directional, not validated."
fi

cat > "$OUTPUT" <<EOF
# UX Insights: ${TOPIC}

**Date:** ${DATE}
**Status:** draft
**Research Question:** ${QUESTION}
**Sample size:** n=${PARTICIPANTS}${CONFIDENCE_FLAG}

## Executive Summary

> 5-7 bullets, the agent fills these.

- _[top finding 1]_
- _[top finding 2]_
- _[top recommendation]_
- _[etc.]_

## Method

| | |
|---|---|
| Participants | ${PARTICIPANTS} (anonymized) |
| Recruitment | _[fill: criteria]_ |
| Format | _[interview / observation / survey]_ |
| Duration | _[per session]_ |
| Recording | _[yes/no, link to storage]_ |

## Participants (anonymized profile)

| ID | Segment | Key context |
|---|---|---|
| P1 | _[]_ | _[]_ |
| P2 | _[]_ | _[]_ |

## Themes

> Each theme = a recurring pattern across multiple participants.
> Theme name should contain tension or specific behavior — avoid generic categories.

### Theme 1: _[name with tension]_

**Affinity rationale:** _[why these codes/quotes are grouped]_

**Supporting evidence (≥2):**
- > _[Quote 1, P_id]_
- > _[Quote 2, P_id]_
- _[Observation: e.g. "6/9 sessions show >5s delay before finding X"]_

**Insight:**
- **What:** _[specific behavior pattern]_
- **Why:** _[motivation / pain underneath]_
- **Implication:** _[design implication]_

### Theme 2: _[name]_

_[same shape]_

### Theme 3: _[name]_

_[same shape]_

## Hierarchical Insights

| Theme | Insight (one-line) | Implication |
|---|---|---|
| _[theme 1]_ | _[]_ | _[]_ |
| _[theme 2]_ | _[]_ | _[]_ |
| _[theme 3]_ | _[]_ | _[]_ |

## Recommendations

### Design Actions

1. _[specific design change with rationale + expected outcome]_
2. _[]_

### Hypotheses to Test

1. _[testable claim → dispatch \`hypothesis-generator\`]_

### Further Research

1. _[gap that needs more research]_

### Stop / Deprecate

1. _[features showing low value that should be considered for removal]_

## Open Questions

> Apa yang belum bisa dijawab dari data ini.

- _[gap 1]_
- _[gap 2]_

## Sign-off

- [ ] UX Lead Review — _Name, Date_
- [ ] PM Owner Acknowledgment — _Name, Date_
EOF

echo "Wrote: $OUTPUT"
echo "Sample: n=$PARTICIPANTS"
[ -n "$CONFIDENCE_FLAG" ] && echo "⚠️  Low confidence flagged (n<5)"
