#!/bin/bash
# Value Score Calculator — produces a structured Markdown report.
# Usage:
#./score.sh --feature "<name>" --reach <N> --impact <1-5> --confidence <0-1> --effort <weeks>
# [--strategic 1.0] [--techdebt 1.0] [--sentiment 1.0]
# [--framework rice|ice|wsjf]
# [--output outputs/PATH.md]
#
# Reach=int, Impact=1-5, Confidence=0-1, Effort=weeks (positive int)
# Multipliers: 0.8-1.2 range each.

set -euo pipefail

FEATURE=""
REACH=0
IMPACT=0
CONFIDENCE=0
EFFORT=0
STRATEGIC=1.0
TECHDEBT=1.0
SENTIMENT=1.0
FRAMEWORK="rice"
OUTPUT=""

while [ $# -gt 0 ]; do
 case "$1" in
 --feature) FEATURE="$2"; shift 2;;
 --reach) REACH="$2"; shift 2;;
 --impact) IMPACT="$2"; shift 2;;
 --confidence) CONFIDENCE="$2"; shift 2;;
 --effort) EFFORT="$2"; shift 2;;
 --strategic) STRATEGIC="$2"; shift 2;;
 --techdebt) TECHDEBT="$2"; shift 2;;
 --sentiment) SENTIMENT="$2"; shift 2;;
 --framework) FRAMEWORK="$2"; shift 2;;
 --output) OUTPUT="$2"; shift 2;;
 -h|--help) grep '^#' "$0" | sed 's/^# \?//'; exit 0;;
 *) echo "Unknown arg: $1"; exit 1;;
 esac
done

if [ -z "$FEATURE" ] || [ "$REACH" = "0" ] || [ "$IMPACT" = "0" ] || [ "$EFFORT" = "0" ]; then
 echo "ERROR: --feature, --reach, --impact, --effort required."
 echo "Run with --help for usage."
 exit 1
fi

# Compute via python (portable arithmetic)
read BASE MULTIPLIED NORMALIZED REC < <(python3 - <<PY "$REACH" "$IMPACT" "$CONFIDENCE" "$EFFORT" "$STRATEGIC" "$TECHDEBT" "$SENTIMENT" "$FRAMEWORK"
import sys
R, I, C, E, S, T, U = map(float, sys.argv[1:8])
fw = sys.argv[8].lower()
if fw == "rice":
 base = (R * I * C) / max(E, 1)
elif fw == "ice":
 base = I * C * E # E means Ease here, but using effort inversely is wrong
 base = I * C * (10 - min(E, 10)) # Ease = 10 - effort (capped)
elif fw == "wsjf":
 base = (R * I + I * C * 5) / max(E, 1)
else:
 base = (R * I * C) / max(E, 1)

multiplied = base * S * T * U

# Normalize to 0-100 by piecewise mapping
def norm(x):
 if x < 500: return x * 20 / 500
 if x < 1500: return 20 + (x - 500) * 20 / 1000
 if x < 3000: return 40 + (x - 1500) * 20 / 1500
 if x < 6000: return 60 + (x - 3000) * 20 / 3000
 return min(100.0, 80 + (x - 6000) * 20 / 6000)

n = norm(multiplied)
if n >= 60: rec = "PROCEED"
elif n >= 40: rec = "DEFER"
else: rec = "REJECT"

print(f"{base:.1f} {multiplied:.1f} {n:.1f} {rec}")
PY
)

DATE=$(date +%Y-%m-%d)
[ -z "$OUTPUT" ] && OUTPUT="outputs/${DATE}-value-score-$(echo "$FEATURE" | tr ' /' '--' | tr '[:upper:]' '[:lower:]').md"
mkdir -p "$(dirname "$OUTPUT")"

# Sensitivity: optimistic and pessimistic
read OPT_N OPT_REC < <(python3 - <<PY "$REACH" "$IMPACT" "$CONFIDENCE" "$EFFORT" "$STRATEGIC" "$TECHDEBT" "$SENTIMENT"
import sys
R, I, C, E, S, T, U = map(float, sys.argv[1:8])
R *= 1.3; C = min(1.0, C + 0.15); E *= 0.8
base = (R * I * C) / max(E, 1)
multiplied = base * S * T * U
def norm(x):
 if x < 500: return x*20/500
 if x < 1500: return 20+(x-500)*20/1000
 if x < 3000: return 40+(x-1500)*20/1500
 if x < 6000: return 60+(x-3000)*20/3000
 return min(100.0, 80+(x-6000)*20/6000)
n = norm(multiplied)
rec = "PROCEED" if n >= 60 else "DEFER" if n >= 40 else "REJECT"
print(f"{n:.1f} {rec}")
PY
)

read PESS_N PESS_REC < <(python3 - <<PY "$REACH" "$IMPACT" "$CONFIDENCE" "$EFFORT" "$STRATEGIC" "$TECHDEBT" "$SENTIMENT"
import sys
R, I, C, E, S, T, U = map(float, sys.argv[1:8])
R *= 0.7; C = max(0.1, C - 0.15); E *= 1.3
base = (R * I * C) / max(E, 1)
multiplied = base * S * T * U
def norm(x):
 if x < 500: return x*20/500
 if x < 1500: return 20+(x-500)*20/1000
 if x < 3000: return 40+(x-1500)*20/1500
 if x < 6000: return 60+(x-3000)*20/3000
 return min(100.0, 80+(x-6000)*20/6000)
n = norm(multiplied)
rec = "PROCEED" if n >= 60 else "DEFER" if n >= 40 else "REJECT"
print(f"{n:.1f} {rec}")
PY
)

HIGH_RISK=""
if (( $(echo "$PESS_N < 40" | bc -l) )); then
 HIGH_RISK="⚠️ HIGH RISK — pessimistic case below REJECT threshold."
fi

cat > "$OUTPUT" <<EOF
# Value Score: $FEATURE

**Date:** $DATE
**Framework:** $(echo "$FRAMEWORK" | tr '[:lower:]' '[:upper:]')
**Composite Score:** $NORMALIZED / 100
**Recommendation:** $REC

$HIGH_RISK

## Inputs

| Input | Value | Source |
|---|---|---|
| Reach | $REACH | _[fill source]_ |
| Impact (1-5) | $IMPACT | _[fill source]_ |
| Confidence (0-1) | $CONFIDENCE | _[fill source]_ |
| Effort (weeks) | $EFFORT | _[fill source]_ |

## ADLC Multipliers

| Multiplier | Value | Rationale |
|---|---|---|
| Strategic Alignment | $STRATEGIC | _[OKR ref]_ |
| Tech Debt Reduction | $TECHDEBT | _[debt impact]_ |
| User Sentiment | $SENTIMENT | _[NPS/CSAT trend]_ |

## Calculation

- **Base Score:** $BASE
- **× Multipliers:** $MULTIPLIED
- **Normalized (0-100):** $NORMALIZED → **$REC**

## Sensitivity

| Scenario | Score | Rec |
|---|---|---|
| Base case | $NORMALIZED | $REC |
| Optimistic (R+30%, C+15%, E-20%) | $OPT_N | $OPT_REC |
| Pessimistic (R-30%, C-15%, E+30%) | $PESS_N | $PESS_REC |

## Recommendation Rationale

_[Fill: why this rec, key risks, alternative options considered]_

## Sign-off

- [ ] CPO Approval — _Name, Date_
EOF

echo "Wrote: $OUTPUT"
echo "Composite: $NORMALIZED / 100 → $REC"
[ -n "$HIGH_RISK" ] && echo "$HIGH_RISK"
