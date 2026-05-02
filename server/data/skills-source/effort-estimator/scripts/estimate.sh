#!/bin/bash
# Effort Estimator — scaffold a 3-point estimate document with PERT calculation.
#
# Usage:
#   ./estimate.sh --feature "<slug>" [--fsd-link PATH] [--team-size N] [--focus-factor 0.6] [--output PATH]

set -euo pipefail

FEATURE=""
FSD_LINK=""
TEAM_SIZE=2
FOCUS_FACTOR=0.6
BUFFER_PCT=30
OUTPUT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --feature)      FEATURE="$2"; shift 2;;
    --fsd-link)     FSD_LINK="$2"; shift 2;;
    --team-size)    TEAM_SIZE="$2"; shift 2;;
    --focus-factor) FOCUS_FACTOR="$2"; shift 2;;
    --buffer-pct)   BUFFER_PCT="$2"; shift 2;;
    --output)       OUTPUT="$2"; shift 2;;
    -h|--help)      grep '^#' "$0" | sed 's/^# \?//'; exit 0;;
    *) echo "Unknown arg: $1"; exit 1;;
  esac
done

[ -z "$FEATURE" ] && { echo "ERROR: --feature required"; exit 1; }

DATE=$(date +%Y-%m-%d)
[ -z "$OUTPUT" ] && OUTPUT="outputs/${DATE}-effort-${FEATURE}.md"
mkdir -p "$(dirname "$OUTPUT")"

CAPACITY=$(echo "$TEAM_SIZE * $FOCUS_FACTOR" | bc -l)

cat > "$OUTPUT" <<EOF
# Effort Estimate: ${FEATURE}

**Date:** ${DATE}
**Status:** draft
**FSD:** ${FSD_LINK:-_[fill: link]_}
**Team:** ${TEAM_SIZE} SWE @ focus factor ${FOCUS_FACTOR} = ${CAPACITY} person-weeks/calendar week

## Component Breakdown (3-point in person-days)

| Component | Best | Likely | Worst | PERT | Rationale |
|---|---|---|---|---|---|
| Frontend | _[]_ | _[]_ | _[]_ | _[(b+4l+w)/6]_ | _[]_ |
| Backend | _[]_ | _[]_ | _[]_ | _[]_ | _[]_ |
| Database / Migration | _[]_ | _[]_ | _[]_ | _[]_ | _[]_ |
| QA | _[]_ | _[]_ | _[]_ | _[]_ | _[]_ |
| Design (during build) | _[]_ | _[]_ | _[]_ | _[]_ | _[]_ |
| Documentation | _[]_ | _[]_ | _[]_ | _[]_ | _[]_ |
| DevOps / Deploy | _[]_ | _[]_ | _[]_ | _[]_ | _[]_ |
| Integration / 3rd-party | _[]_ | _[]_ | _[]_ | _[]_ | _[]_ |
| **Subtotal (coding)** | **_[sum]_** | **_[sum]_** | **_[sum]_** | **_[sum]_** | |

## Non-coding Buffer

Default ${BUFFER_PCT}% on top of coding estimates (code review, debug, ceremonies).

| | Best | Likely | Worst | PERT |
|---|---|---|---|---|
| Coding subtotal | _[]_ | _[]_ | _[]_ | _[]_ |
| + ${BUFFER_PCT}% buffer | _[]_ | _[]_ | _[]_ | _[]_ |
| **Total person-days** | **_[]_** | **_[]_** | **_[]_** | **_[]_** |
| Total person-weeks | _[÷5]_ | _[÷5]_ | _[÷5]_ | _[÷5]_ |

## Calendar Timeline

Capacity: ${CAPACITY} person-weeks/calendar week

| | Person-weeks | Calendar weeks |
|---|---|---|
| Best | _[]_ | _[÷ ${CAPACITY}]_ |
| Likely | _[]_ | _[÷ ${CAPACITY}]_ |
| Worst | _[]_ | _[÷ ${CAPACITY}]_ |
| **Recommended commitment (P75)** | **_[]_** | **_[÷ ${CAPACITY}]_** |

## External Dependencies (NOT counted in person-time)

| Dependency | Wait time | Critical path? | Mitigation |
|---|---|---|---|
| _[vendor / team]_ | _[]_ | yes/no | _[]_ |

## Risk Notes

> What could blow this estimate?

- **Scope creep**: _[describe likelihood]_
- **Key person availability**: _[]_
- **Vendor uncertainty**: _[]_
- **Performance tuning** (if benchmark fails): _[]_

## Confidence

- [ ] **High** — FSD complete, team familiar, similar work done before
- [ ] **Medium** — FSD draft, some unknowns
- [ ] **Low** — Only PRD, scope soft, novel tech

## Sign-off

- [ ] EM Approval — _Name, Date_
- [ ] PM acknowledgment of timeline — _Name, Date_

## Next Step

- [ ] If commitment accepted → break down into sprint tasks
- [ ] If commitment rejected → trim scope (gunakan PRD/FSD revision) atau add team capacity

EOF

echo "Wrote: $OUTPUT"
echo ""
echo "Capacity: ${CAPACITY} person-weeks/calendar week"
echo "Next: agent fills component estimates (3-point each), apply PERT, derive calendar."
