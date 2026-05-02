#!/bin/bash
# Competitive Moat Assessor — scaffold a structured moat assessment report.
#
# Usage:
#  ./assess.sh --product "<name>" \
#    --competitors "Comp A|Comp B|Comp C" \
#    [--moats "network-effects|switching-costs|cost-advantages|intangible-assets|efficient-scale|counter-positioning"] \
#    [--output outputs/PATH.md]
#
# Generates a skeleton moat assessment with all 6 moat types pre-filled,
# attack scenarios for each competitor, and defensibility score rubric.

set -euo pipefail

PRODUCT=""
COMPETITORS=""
MOATS="network-effects|switching-costs|cost-advantages|intangible-assets|efficient-scale|counter-positioning"
OUTPUT=""

while [ $# -gt 0 ]; do
 case "$1" in
 --product) PRODUCT="$2"; shift 2;;
 --competitors) COMPETITORS="$2"; shift 2;;
 --moats) MOATS="$2"; shift 2;;
 --output) OUTPUT="$2"; shift 2;;
 -h|--help) grep '^#' "$0" | sed 's/^# \?//'; exit 0;;
 *) echo "Unknown arg: $1"; exit 1;;
 esac
done

[ -z "$PRODUCT" ] && { echo "ERROR: --product required"; exit 1; }
[ -z "$COMPETITORS" ] && { echo "ERROR: --competitors required (pipe-separated)"; exit 1; }

DATE=$(date +%Y-%m-%d)
SLUG=$(echo "$PRODUCT" | tr ' /' '--' | tr '[:upper:]' '[:lower:]')
[ -z "$OUTPUT" ] && OUTPUT="outputs/${DATE}-competitive-moat-${SLUG}.md"
mkdir -p "$(dirname "$OUTPUT")"

# Parse competitors
IFS='|' read -ra COMP_ARR <<< "$COMPETITORS"

# Parse moat types
IFS='|' read -ra MOAT_ARR <<< "$MOATS"

# Build moat inventory table
MOAT_TABLE=""
for m in "${MOAT_ARR[@]}"; do
 label=$(echo "$m" | sed 's/-/ /g' | sed 's/\b\(.\)/\u\1/g' 2>/dev/null || echo "$m")
 MOAT_TABLE="${MOAT_TABLE}| ${label} | ❓ TBD | _[/10]_ | _[fill evidence]_ | _[→/↗/↘]_ |
"
done

# Build attack scenarios
ATTACK_SCENARIOS=""
i=1
for c in "${COMP_ARR[@]}"; do
 ATTACK_SCENARIOS="${ATTACK_SCENARIOS}### Scenario ${i}: ${c}

- **How they attack:** _[specific narrative — timeline, resources, distribution]_
- **Our defense:** _[which moat protects us]_
- **Vulnerability:** _[where defense breaks]_
- **Risk level:** _[High / Medium / Low]_

"
 i=$((i+1))
done

cat > "$OUTPUT" <<EOF
# Competitive Moat Assessment — ${PRODUCT}

**Date:** ${DATE}
**Author:** Biz Analyst (#7)
**Defensibility Score:** _[X]_ / 10

## Executive summary

> 1. Product assessed: ${PRODUCT}
> 2. Strongest moat: _[fill]_ — _[evidence]_
> 3. Weakest flank: _[fill]_ — top attacker: _[competitor]_
> 4. Overall defensibility: _[Strong / Moderate / Weak]_
> 5. Top recommendation: _[fill]_

## Competitor landscape

| # | Competitor | Type | Est. Market Share | Key Strength |
|---|---|---|---|---|
$(i=1; for c in "${COMP_ARR[@]}"; do echo "| ${i} | ${c} | _[direct/indirect]_ | _[%]_ | _[fill]_ |"; i=$((i+1)); done)

## Moat inventory

| Moat Type | Applies? | Strength | Evidence | 1-yr Trend |
|---|---|---|---|---|
${MOAT_TABLE}

## Attack scenarios

${ATTACK_SCENARIOS}

## Defensibility Score Rubric

| Score | Meaning |
|---|---|
| 9-10 | Nearly unassailable (multiple strong moats) |
| 7-8 | Strong (1-2 durable moats, high friction for attackers) |
| 5-6 | Moderate (moats exist but attackable with effort) |
| 3-4 | Weak (moats shallow, 12-18 mo to replicate) |
| 1-2 | Very weak (commodity, no defensibility) |

**Current Score: _[X]_ / 10**

## Moat trajectory

| Timeframe | Projected Score | Key Driver |
|---|---|---|
| Now | _[X/10]_ | _[primary moat]_ |
| 1 year | _[X/10]_ | _[growth driver or threat]_ |
| 3 years | _[X/10]_ | _[depends on strategic action]_ |

## Strengthening recommendations

1. **[High Impact]** _[fill — increase strongest moat]_
2. **[High Impact]** _[fill — close weakest flank]_
3. **[Medium Impact]** _[fill — build new moat type]_

## Decision

**Defensibility: _[Strong / Moderate / Weak]_**

_[Fill: rationale, conditions, sign-off requirements]_

## Sign-off

- [ ] PM Lead — _Name, Date_
- [ ] Strategy Team — _Name, Date_
EOF

echo "Wrote: $OUTPUT"
echo "Product: $PRODUCT"
echo "Competitors: ${COMP_ARR[*]}"
echo "Moat types: ${#MOAT_ARR[@]}"
echo ""
echo "Next: agent must fill all _[fill]_ placeholders with evidence-backed data."
