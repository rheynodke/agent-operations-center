#!/bin/bash
# Usability Testing — scaffold a final scored report.
#
# Usage:
#   ./test-report.sh --feature "<slug>" --participants <N> --mode moderated|unmoderated|guerilla [--output PATH]

set -euo pipefail

FEATURE=""
PARTICIPANTS=""
MODE="moderated"
OUTPUT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --feature)      FEATURE="$2"; shift 2;;
    --participants) PARTICIPANTS="$2"; shift 2;;
    --mode)         MODE="$2"; shift 2;;
    --output)       OUTPUT="$2"; shift 2;;
    -h|--help)      grep '^#' "$0" | sed 's/^# \?//'; exit 0;;
    *) echo "Unknown arg: $1"; exit 1;;
  esac
done

[ -z "$FEATURE" ] && { echo "ERROR: --feature required"; exit 1; }
[ -z "$PARTICIPANTS" ] && { echo "ERROR: --participants required"; exit 1; }

DATE=$(date +%Y-%m-%d)
[ -z "$OUTPUT" ] && OUTPUT="outputs/${DATE}-usability-report-${FEATURE}.md"
mkdir -p "$(dirname "$OUTPUT")"

CONFIDENCE_FLAG=""
if [ "$PARTICIPANTS" -lt 5 ] 2>/dev/null; then
  CONFIDENCE_FLAG="

> ⚠️ **Below threshold:** n=$PARTICIPANTS < 5 (Nielsen rule for usability issue saturation). Findings directional only."
fi

cat > "$OUTPUT" <<EOF
# Usability Test Report: ${FEATURE}

**Date:** ${DATE}
**Status:** draft
**Mode:** ${MODE}
**Sample size:** n=${PARTICIPANTS}${CONFIDENCE_FLAG}

## Executive Summary

> Overall verdict + key TCR + SUS + top 3 recommendations.

- **Overall TCR:** _[X%]_ (gate ≥ 80%: _[PASS / FAIL]_)
- **SUS Score:** _[N]_ / 100 (industry baseline: 68; excellent: 80+)
- **Top 3 issues:** _[]_

## Test Plan Reference

- Test goal: _[fill]_
- Tasks tested: _[N]_
- Test plan doc: \`outputs/YYYY-MM-DD-usability-plan-${FEATURE}.md\`
- Per-session notes: \`outputs/YYYY-MM-DD-usability-session-${FEATURE}-P*.md\`

## Participants

| ID | Segment | Recruitment | Compensated |
|---|---|---|---|
| P1 | _[]_ | _[]_ | _[]_ |
| P2 | _[]_ | _[]_ | _[]_ |
| ... (${PARTICIPANTS} rows) | | | |

## Per-Task Results

| Task | TCR | Avg Time | Median Errors | Severity if Failed |
|---|---|---|---|---|
| 1 — _[task name]_ | _[%]_ | _[s]_ | _[N]_ | _[major/moderate/minor]_ |
| 2 — _[]_ | _[]_ | _[]_ | _[]_ | _[]_ |
| 3 — _[]_ | _[]_ | _[]_ | _[]_ | _[]_ |

**Overall TCR:** _[avg %]_

## SUS Score

| Participant | Raw Score | Normalized (0-100) |
|---|---|---|
| P1 | _[]_ | _[]_ |
| P2 | _[]_ | _[]_ |

**Average SUS:** _[N]_

| Benchmark | Range |
|---|---|
| Below average | < 68 |
| Above average | 68-80 |
| Excellent | 80+ |

**Verdict:** _[which range]_

## Issues Identified

### Major (blocks task completion)

| Issue | Frequency | Suggested Fix | Effort |
|---|---|---|---|
| _[issue description]_ | _[n participants]_ | _[]_ | _[low/med/high]_ |

### Moderate (slows down significantly)

_[same shape]_

### Minor (cosmetic / preference)

_[same shape]_

## Recommendations (ranked by impact)

1. **[MAJOR]** _[recommendation]_
   - Rationale: _[evidence]_
   - Estimated impact: TCR _[X%]_ → _[Y%]_
   - Effort: _[low/med/high]_
2. **[MODERATE]** _[]_
3. **[MINOR]** _[]_

## Gate Decision

- [ ] **PASS** — TCR ≥ 80%, SUS ≥ 68, no major issues unresolved
- [ ] **REDESIGN NEEDED** — TCR < 80% OR major issues unresolved → trigger \`prototype-generator\` redesign cycle
- [ ] **CONDITIONAL** — TCR borderline but issues resolvable in build phase, with sign-off

## Sign-off

- [ ] UX Lead — _Name, Date_
- [ ] PM Owner — _Name, Date_
- [ ] CPO Override — _Name, Date_ (only if conditional pass)

## Next Steps

- [ ] If PASS → green-light PRD lock
- [ ] If REDESIGN → dispatch \`prototype-generator\` with issues list
- [ ] If CONDITIONAL → log issues as build-phase tasks tag \`ux-must-fix\`
EOF

echo "Wrote: $OUTPUT"
echo "Sample: n=$PARTICIPANTS · Mode: $MODE"
[ -n "$CONFIDENCE_FLAG" ] && echo "⚠️  Below threshold flagged."
