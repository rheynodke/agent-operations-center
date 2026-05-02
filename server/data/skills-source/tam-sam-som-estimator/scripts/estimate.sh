#!/bin/bash
# TAM/SAM/SOM Estimator — scaffold a structured market sizing report.
#
# Usage:
#  ./estimate.sh --market "<market definition>" \
#    --geography "<scope>" \
#    --horizon <years> \
#    [--arpu <annual_revenue_per_user>] \
#    [--cagr <growth_rate_pct>] \
#    [--output outputs/PATH.md]
#
# Generates a skeleton with top-down + bottom-up frameworks pre-filled.

set -euo pipefail

MARKET=""
GEOGRAPHY=""
HORIZON=3
ARPU=""
CAGR=""
OUTPUT=""

while [ $# -gt 0 ]; do
 case "$1" in
 --market) MARKET="$2"; shift 2;;
 --geography) GEOGRAPHY="$2"; shift 2;;
 --horizon) HORIZON="$2"; shift 2;;
 --arpu) ARPU="$2"; shift 2;;
 --cagr) CAGR="$2"; shift 2;;
 --output) OUTPUT="$2"; shift 2;;
 -h|--help) grep '^#' "$0" | sed 's/^# \?//'; exit 0;;
 *) echo "Unknown arg: $1"; exit 1;;
 esac
done

[ -z "$MARKET" ] && { echo "ERROR: --market required"; exit 1; }
[ -z "$GEOGRAPHY" ] && { echo "ERROR: --geography required"; exit 1; }

DATE=$(date +%Y-%m-%d)
SLUG=$(echo "$MARKET" | tr ' /' '--' | tr '[:upper:]' '[:lower:]' | head -c 50)
[ -z "$OUTPUT" ] && OUTPUT="outputs/${DATE}-tam-sam-som-${SLUG}.md"
mkdir -p "$(dirname "$OUTPUT")"

# Build growth projection rows
GROWTH_ROWS=""
for y in $(seq 1 "$HORIZON"); do
 GROWTH_ROWS="${GROWTH_ROWS}| Y${y} | _[\$M]_ | _[driver]_ | ${CAGR:-_[X]_}% |
"
done

cat > "$OUTPUT" <<EOF
# TAM/SAM/SOM — ${MARKET}

**Date:** ${DATE}
**Author:** Biz Analyst (#7)
**Geography:** ${GEOGRAPHY}
**Time Horizon:** ${HORIZON}-year
**ARPU (if known):** ${ARPU:-_[fill or use pricing-strategy-analyzer]_}
**Industry CAGR:** ${CAGR:-_[fill — cite source]_}%

## Executive Summary

| Metric | Low | Likely | High | Confidence |
|---|---|---|---|---|
| TAM | _[\$M]_ | _[\$M]_ | _[\$M]_ | _[🟢/🟡/🔴]_ |
| SAM | _[\$M]_ | _[\$M]_ | _[\$M]_ | _[🟢/🟡/🔴]_ |
| SOM (Y1) | _[\$M]_ | _[\$M]_ | _[\$M]_ | _[🟢/🟡/🔴]_ |
| SOM (Y${HORIZON}) | _[\$M]_ | _[\$M]_ | _[\$M]_ | _[🟢/🟡/🔴]_ |

## Market definition

**Category:** ${MARKET}
**Geography:** ${GEOGRAPHY}
**Buyer persona:** _[role, company size, budget range]_
**Exclusions:** _[what's explicitly out of scope]_

## Top-down estimation

Start from total industry → narrow down.

| Layer | Value | Source | Confidence |
|---|---|---|---|
| Global market | _[\$B]_ | _[report name, year]_ | _[🟢/🟡/🔴]_ |
| Regional share | _[\$B]_ (_[X]_%) | _[report/regional split]_ | _[🟢/🟡/🔴]_ |
| Country share | _[\$M]_ (_[X]_%) | _[govt stats / GDP proportional]_ | _[🟢/🟡/🔴]_ |
| Segment filter | _[\$M]_ (_[X]_%) | _[industry vertical data]_ | _[🟢/🟡/🔴]_ |
| **TAM (top-down)** | **_[\$M]_** | narrowed from global | _[🟢/🟡/🔴]_ |

**SAM (top-down):** _[\$M]_ — _[filter rationale]_
**SOM Y1 (top-down):** _[\$M]_ (_[X]_% penetration)

## Bottom-up estimation

Start from addressable customers × ARPU.

| Factor | Value | Source | Confidence |
|---|---|---|---|
| Total addressable companies | _[N]_ | _[registry / association]_ | _[🟢/🟡/🔴]_ |
| % willing to pay | _[X]_% | _[interview n=N / survey]_ | _[🟢/🟡/🔴]_ |
| Addressable companies | _[N × X%]_ | computed | _[🟢/🟡/🔴]_ |
| ARPU (annual) | \$${ARPU:-_[fill]_} | _[pricing / comparable]_ | _[🟢/🟡/🔴]_ |
| **TAM (bottom-up)** | _[\$M]_ | computed | _[🟢/🟡/🔴]_ |

**SAM (bottom-up):** _[\$M]_ — _[reachable via channels]_
**SOM Y1 (bottom-up):** _[\$M]_ — _[pipeline × conversion]_

## Cross-validation

| Metric | Top-down | Bottom-up | Delta | Reconciled |
|---|---|---|---|---|
| TAM | _[\$M]_ | _[\$M]_ | _[X]_% | _[\$M]_ |
| SAM | _[\$M]_ | _[\$M]_ | _[X]_% | _[\$M]_ |
| SOM Y1 | _[\$M]_ | _[\$M]_ | _[X]_% | _[\$M]_ |

**Reconciliation notes:** _[if delta >30%, explain which estimate is more reliable and why]_

## Growth projection

| Year | SOM | Growth Driver | CAGR |
|---|---|---|---|
${GROWTH_ROWS}

## Confidence assessment

| Estimate | Confidence | Why |
|---|---|---|
| TAM | _[🟢/🟡/🔴]_ | _[rationale]_ |
| SAM | _[🟢/🟡/🔴]_ | _[rationale]_ |
| SOM | _[🟢/🟡/🔴]_ | _[rationale]_ |
| CAGR | _[🟢/🟡/🔴]_ | _[rationale]_ |

## Data sources

1. _[Report name, publisher, year, URL]_
2. _[Government stats source, date]_
3. _[Interview data: n=X, methodology]_
4. _[Comparable company data]_

## Sign-off

- [ ] PM Lead — _Name, Date_
- [ ] Finance — _Name, Date_
EOF

echo "Wrote: $OUTPUT"
echo "Market: $MARKET"
echo "Geography: $GEOGRAPHY"
echo "Horizon: ${HORIZON} years"
echo ""
echo "Next: agent must fill all _[fill]_ placeholders with source-cited data."
