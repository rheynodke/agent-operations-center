#!/bin/bash
# Feasibility Brief — scaffold a 1-2 page technical feasibility document.
#
# Usage:
#   ./brief.sh --feature "<slug>" --prd-link "<path or URL>" [--output PATH]

set -euo pipefail

FEATURE=""
PRD_LINK=""
OUTPUT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --feature)  FEATURE="$2"; shift 2;;
    --prd-link) PRD_LINK="$2"; shift 2;;
    --output)   OUTPUT="$2"; shift 2;;
    -h|--help)  grep '^#' "$0" | sed 's/^# \?//'; exit 0;;
    *) echo "Unknown arg: $1"; exit 1;;
  esac
done

[ -z "$FEATURE" ] && { echo "ERROR: --feature required"; exit 1; }

DATE=$(date +%Y-%m-%d)
[ -z "$OUTPUT" ] && OUTPUT="outputs/${DATE}-feasibility-${FEATURE}.md"
mkdir -p "$(dirname "$OUTPUT")"

cat > "$OUTPUT" <<EOF
# Feasibility Brief: ${FEATURE}

**Date:** ${DATE}
**PRD:** ${PRD_LINK:-_[fill: link to PRD]_}
**Status:** draft — pending CTO sign-off

## Decision

> **\_\_\_** (GO / GO-conditional / SPIKE-FIRST / NO-GO)

_[1-line rationale]_

## Context

_[2-3 sentences ringkas: feature is, who it's for, why now]_

## Technical Approach

_[1 paragraph high-level. Frontend, backend, data layer, integrations, real-time/async needs.]_

## Constraints

| Dimension | Constraint | Severity | Source |
|---|---|---|---|
| Infra | _[fill]_ | _[high/med/low]_ | _[link/ref]_ |
| Team | _[fill]_ | _[]_ | _[]_ |
| Timeline | _[fill]_ | _[]_ | _[]_ |
| Dependency | _[fill]_ | _[]_ | _[]_ |

## Complexity Assessment

| Component | Complexity | Rationale |
|---|---|---|
| _[component 1]_ | _[low/medium/high]_ | _[why]_ |
| _[component 2]_ | _[]_ | _[]_ |
| _[component 3]_ | _[]_ | _[]_ |

## Unknown Risks

> List of technical questions yang jawabannya menentukan approach. Propose spike kalau >1.

| ID | Question | Affects | Spike proposed? |
|---|---|---|---|
| U1 | _[unknown question]_ | _[component/decision]_ | yes/no |

### Spikes (if any)

\`\`\`
SPIKE: [N] days for [name]
- Goal: answer "[question]"
- Method: [prototype | doc reading | vendor call | benchmark]
- Output: memo + decision
- Owner: [SWE]
\`\`\`

## Conditions (only if Decision = GO-conditional)

1. _[explicit condition that must be met]_
2. _[another condition]_

## Sign-off

- [ ] CTO Approval — _Name, Date_

## Next Step

- [ ] If GO / GO-conditional → dispatch \`fsd-generator\` skill
- [ ] If SPIKE-FIRST → create task tag \`spike\`, run spike, re-run this brief
- [ ] If NO-GO → archive with reason, notify PM via \`re-discovery-trigger\`
EOF

echo "Wrote: $OUTPUT"
echo "Status: draft — agent must fill placeholders + obtain CTO sign-off."
