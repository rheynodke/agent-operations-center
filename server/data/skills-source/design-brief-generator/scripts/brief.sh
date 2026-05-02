#!/bin/bash
# Design Brief Generator — synthesize PRD + UX research + competitor analysis into a 2-page brief.
#
# Usage:
#   ./brief.sh --feature "<slug>" --prd PATH [--research PATH] [--competitors PATH] [--output PATH]

set -euo pipefail

FEATURE=""
PRD=""
RESEARCH=""
COMPETITORS=""
OUTPUT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --feature)     FEATURE="$2"; shift 2;;
    --prd)         PRD="$2"; shift 2;;
    --research)    RESEARCH="$2"; shift 2;;
    --competitors) COMPETITORS="$2"; shift 2;;
    --output)      OUTPUT="$2"; shift 2;;
    -h|--help)     grep '^#' "$0" | sed 's/^# \?//'; exit 0;;
    *) echo "Unknown arg: $1"; exit 1;;
  esac
done

[ -z "$FEATURE" ] && { echo "ERROR: --feature required"; exit 1; }
[ -z "$PRD" ] && { echo "ERROR: --prd required (path to locked PRD)"; exit 1; }

DATE=$(date +%Y-%m-%d)
[ -z "$OUTPUT" ] && OUTPUT="outputs/${DATE}-design-brief-${FEATURE}.md"
mkdir -p "$(dirname "$OUTPUT")"

cat > "$OUTPUT" <<EOF
# Design Brief: ${FEATURE}

**Date:** ${DATE}
**Status:** draft
**Inputs:**
- PRD: \`${PRD}\`
- UX Research: \`${RESEARCH:-_[fill or "not available"]_}\`
- Competitor Analysis: \`${COMPETITORS:-_[fill or "not available"]_}\`

## 1. Problem Statement

> 1 paragraph, designer-readable, no PM jargon.

_[fill: distill PRD problem into 3-5 sentences]_

## 2. Target User & Context

| | |
|---|---|
| Who | _[user segment from PRD]_ |
| Skill level | _[tech-savvy / casual / first-time]_ |
| Tier | _[free / paid / enterprise / N/A]_ |
| Trigger to encounter | _[what they were doing before]_ |
| Expected next action | _[what they want to accomplish after]_ |
| Device | _[mobile / desktop / both]_ |
| Network | _[good wifi / flaky / both]_ |
| Mental state | _[calm browse / urgent buy / problem-solving]_ |

## 3. Success Criteria (measurable)

1. _[criterion derived from PRD success metric]_
2. _[criterion from UX research finding]_
3. _[criterion testable via usability test]_

> NO subjective criteria like "looks modern" or "feels premium".

## 4. Constraints

| Type | Constraint | Source |
|---|---|---|
| Brand | _[colors, typography]_ | _[brand guide]_ |
| Technical | _[browser/device support]_ | _[tech-stack ADR]_ |
| Time | _[designer days]_ | _[sprint capacity]_ |
| Accessibility | _[WCAG AA minimum]_ | _[compliance]_ |
| Regression | _[existing UX cannot break]_ | _[risk]_ |

## 5. References (3-5 visual examples)

> Each ref WAJIB: source + adopt rationale + caveats.

### Ref 1: _[name]_
- **Source:** _[URL or screenshot path]_
- **Adopt:** _[specific pattern to learn from]_
- **Avoid:** _[what NOT to copy]_

### Ref 2: _[name]_
- _[same shape]_

### Ref 3: _[name]_
- _[same shape]_

## 6. Deliverables (enumerated)

- [ ] High-fidelity mockup (Figma):
  - [ ] _[viewport 1: e.g. mobile portrait]_ + _[N]_ states
  - [ ] _[viewport 2]_ + states
- [ ] Interactive prototype (clickable Figma) covering happy path
- [ ] Component spec sheet (padding, type, colors)
- [ ] Edge cases: _[list]_
- [ ] Asset export: _[SVGs / icons / images]_

## 7. Out-of-Scope (explicit)

- [ ] DO NOT _[redesign Y]_ — separate ticket
- [ ] DO NOT _[change Z globally]_ — only this flow
- [ ] DO NOT _[add gamification]_ — out of brand voice
- [ ] DO NOT _[propose backend changes]_ — out of designer scope

## 8. Timeline & Review Points

| Milestone | Day | Reviewer |
|---|---|---|
| Brief ack + questions | 1 | Designer + UX Lead |
| Wireframe / low-fi review | 2 | UX Lead + PM |
| High-fi review #1 | 3 | UX Lead + PM + EM |
| Final review | 4 | UX Lead + PM + Stakeholder |
| Handoff to dev | 5 | EM + SWE |

## Sign-off

- [ ] UX Lead — _Name, Date_
- [ ] PM — _Name, Date_
- [ ] Designer ack — _Name, Date_
EOF

echo "Wrote: $OUTPUT"
echo "Inputs: PRD ✓, Research ${RESEARCH:+✓}${RESEARCH:-✗}, Competitors ${COMPETITORS:+✓}${COMPETITORS:-✗}"
