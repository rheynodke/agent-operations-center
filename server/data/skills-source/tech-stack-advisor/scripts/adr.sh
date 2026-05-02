#!/bin/bash
# Tech Stack Advisor — scaffold an ADR (Architecture Decision Record).
#
# Usage:
#   ./adr.sh --number NNN --slug "<slug>" [--status proposed|accepted] [--output PATH]

set -euo pipefail

NUMBER=""
SLUG=""
STATUS="proposed"
OUTPUT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --number) NUMBER="$2"; shift 2;;
    --slug)   SLUG="$2"; shift 2;;
    --status) STATUS="$2"; shift 2;;
    --output) OUTPUT="$2"; shift 2;;
    -h|--help) grep '^#' "$0" | sed 's/^# \?//'; exit 0;;
    *) echo "Unknown arg: $1"; exit 1;;
  esac
done

[ -z "$NUMBER" ] && { echo "ERROR: --number required (zero-padded NNN)"; exit 1; }
[ -z "$SLUG" ] && { echo "ERROR: --slug required"; exit 1; }

DATE=$(date +%Y-%m-%d)
[ -z "$OUTPUT" ] && OUTPUT="docs/adrs/ADR-${NUMBER}-${SLUG}.md"
mkdir -p "$(dirname "$OUTPUT")"

# Convert slug to title
TITLE=$(echo "$SLUG" | tr '-' ' ' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) substr($i,2)} 1')

cat > "$OUTPUT" <<EOF
# ADR-${NUMBER}: ${TITLE}

**Status:** ${STATUS}
**Date:** ${DATE}
**Authors:** _[fill: name(s)]_
**Reviewers:** _[fill: CTO / senior EM]_

## Context

> 1-2 paragraphs answering "why are we deciding this now?". Cover problem, constraints, triggering signal.

_[fill]_

Related:
- _[link to feasibility brief / FSD / post-mortem]_

## Decision Drivers

> 4-6 specific criteria that matter for this decision.

1. _[criterion 1: e.g. team expertise]_
2. _[criterion 2: e.g. read/write pattern fit]_
3. _[criterion 3]_
4. _[criterion 4]_

## Considered Options

### Option A: _[name]_

_[1-paragraph description]_

**Pros:**
- _[]_

**Cons:**
- _[]_

### Option B: _[name]_

_[1-paragraph description]_

**Pros:**
- _[]_

**Cons:**
- _[]_

### Option C: _[name]_ (optional)

_[same shape]_

## Trade-off Matrix

| Criterion | Option A | Option B | Option C |
|---|---|---|---|
| _[driver 1]_ | _[1-5]_ | _[1-5]_ | _[1-5]_ |
| _[driver 2]_ | _[]_ | _[]_ | _[]_ |
| _[driver 3]_ | _[]_ | _[]_ | _[]_ |
| _[driver 4]_ | _[]_ | _[]_ | _[]_ |
| **Total** | **_[]_** | **_[]_** | **_[]_** |

> Score 1-5 (5 = best fit). Rationale per cell:
> - Option A · _[driver 1]_: _[1-line why this score]_
> - Option B · _[driver 1]_: _[]_
> - _[etc.]_

## Decision Outcome

**Chosen:** Option _[A | B | C]_ — _[name]_

**Rationale:**
1. _[bullet 1]_
2. _[bullet 2]_
3. _[bullet 3]_

## Consequences

### Positive

- _[what we gain]_

### Negative (mandatory ≥1)

- _[what we lose / accept]_

### Neutral

- _[changes that aren't clearly +/-]_

## Validation / Exit Criteria

> If this ADR turns out wrong, how do we know? What's the trigger to revisit?

- _[e.g. "If p99 latency > 200ms after 4 weeks → revisit DB choice"]_
- _[]_

## Sign-off

- [ ] CTO Approval — _Name, Date_ (required if data/security/cost-impact)
- [ ] Senior EM Review — _Name, Date_

## Change Log

| Date | Author | Change |
|---|---|---|
| ${DATE} | _[]_ | Initial draft |
EOF

echo "Wrote: $OUTPUT"
echo ""
echo "Next: agent fills placeholders, then update docs/adrs/README.md index."
