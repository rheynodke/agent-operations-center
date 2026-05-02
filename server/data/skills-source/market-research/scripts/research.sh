#!/bin/bash
# Market Research — scaffold a research brief Markdown document.
# This script generates the OUTPUT skeleton; the agent fills it via web_search,
# aoc-connect, and other discovery tools.
#
# Usage:
#./research.sh --topic "<slug>" --question "<primary research question>" [--output PATH]
#
# Optional: --internal helpdesk|sales|all (pull from internal connections)
# --keyword "<keyword>" (filter for internal pull)
# --period "<duration>" (e.g. "90d", "12m")

set -euo pipefail

TOPIC=""
QUESTION=""
INTERNAL=""
KEYWORD=""
PERIOD="90d"
OUTPUT=""

while [ $# -gt 0 ]; do
 case "$1" in
 --topic) TOPIC="$2"; shift 2;;
 --question) QUESTION="$2"; shift 2;;
 --internal) INTERNAL="$2"; shift 2;;
 --keyword) KEYWORD="$2"; shift 2;;
 --period) PERIOD="$2"; shift 2;;
 --output) OUTPUT="$2"; shift 2;;
 -h|--help) grep '^#' "$0" | sed 's/^# \?//'; exit 0;;
 *) echo "Unknown arg: $1"; exit 1;;
 esac
done

[ -z "$TOPIC" ] && { echo "ERROR: --topic required"; exit 1; }
[ -z "$QUESTION" ] && { echo "ERROR: --question required"; exit 1; }

DATE=$(date +%Y-%m-%d)
[ -z "$OUTPUT" ] && OUTPUT="outputs/${DATE}-market-research-${TOPIC}.md"
mkdir -p "$(dirname "$OUTPUT")"
mkdir -p "outputs/raw/${DATE}-${TOPIC}"

# Optional internal pull
INTERNAL_NOTES=""
if [ -n "$INTERNAL" ] && command -v aoc-connect.sh &>/dev/null; then
 INTERNAL_NOTES="
## Internal Data Pull (raw)

> Saved to \`outputs/raw/${DATE}-${TOPIC}/internal-${INTERNAL}.json\`. Reference inline below.

"
 case "$INTERNAL" in
 helpdesk)
 aoc-connect.sh "Odoo" sql "SELECT name, description, create_date FROM helpdesk_ticket WHERE description ILIKE '%${KEYWORD}%' AND create_date > NOW() - INTERVAL '${PERIOD}' LIMIT 100" \
 > "outputs/raw/${DATE}-${TOPIC}/internal-helpdesk.json" 2>/dev/null || INTERNAL_NOTES="${INTERNAL_NOTES}_(internal pull failed — fill manual)_"
 ;;
 sales)
 aoc-connect.sh "Odoo" sql "SELECT name, partner_id, amount_total, state FROM sale_order WHERE create_date > NOW() - INTERVAL '${PERIOD}' LIMIT 100" \
 > "outputs/raw/${DATE}-${TOPIC}/internal-sales.json" 2>/dev/null || INTERNAL_NOTES="${INTERNAL_NOTES}_(internal pull failed — fill manual)_"
 ;;
 esac
fi

cat > "$OUTPUT" <<EOF
# Market Research: ${TOPIC}

**Date:** ${DATE}
**Status:** draft
**Primary Question:** ${QUESTION}

## Executive Summary

> _[2-3 sentences with recommendation: PROCEED / PIVOT / DROP]_

## Research Questions

1. _[atomic Q derived from primary]_
2. _[...]_
3. _[...]_

## Sources Consulted (min 3)

| Channel | Tool used | URLs / refs |
|---|---|---|
| _[fill]_ | _[fill]_ | _[fill]_ |
| _[fill]_ | _[fill]_ | _[fill]_ |
| _[fill]_ | _[fill]_ | _[fill]_ |

## Problem Prevalence

> Quantified evidence that this problem exists at scale. Source every number.

- _[finding 1]_ — source: _[url/quote]_
- _[finding 2]_ — source: _[url/quote]_

## Target Segments

| Segment | Size estimate | Pain intensity | Source |
|---|---|---|---|
| _[seg 1]_ | _[N users]_ | _[H/M/L]_ | _[url]_ |
| _[seg 2]_ | _[N users]_ | _[H/M/L]_ | _[url]_ |

## Competitive Landscape (3-7 competitors)

| Competitor | Pricing | Feature 1 | Feature 2 | Positioning | Avg Review | Source |
|---|---|---|---|---|---|---|
| _[fill]_ | _[fill]_ | _[fill]_ | _[fill]_ | _[fill]_ | _[N stars]_ | _[url]_ |

### Gap Analysis

- _[gap 1: e.g. nobody covers feature X]_ — opportunity for: V/U/F/B
- _[gap 2]_ — opportunity for: V/U/F/B

## Demand Signals (min 2 channels)

| Signal | Volume | Channel | Citation |
|---|---|---|---|
| _[search keyword]_ | _[N searches/month]_ | Google Trends | _[link]_ |
| _[forum thread keyword]_ | _[N threads / 90d]_ | Reddit / FB | _[link]_ |
| _[helpdesk ticket]_ | _[N tickets / period]_ | internal | _[query ref]_ |
${INTERNAL_NOTES}

## Risk Tagging Matrix

| Finding | V | U | F | B |
|---|:-:|:-:|:-:|:-:|
| _[finding 1]_ | _[ ]_ | _[ ]_ | _[ ]_ | _[ ]_ |
| _[finding 2]_ | _[ ]_ | _[ ]_ | _[ ]_ | _[ ]_ |

V=Value, U=Usability, F=Feasibility, B=Business Viability

## Recommendation

**Decision: \_\_\_\_\_** (PROCEED / PIVOT / DROP)

**Rationale (3 bullets, sourced):**
1. _[bullet]_ — source: _[]_
2. _[bullet]_ — source: _[]_
3. _[bullet]_ — source: _[]_

## Next Step

- [ ] If PROCEED → dispatch to \`hypothesis-generator\` skill
- [ ] If PIVOT → re-frame problem and re-run market-research
- [ ] If DROP → archive with rationale, notify stakeholder

## Sign-off

- [ ] PM Lead — _Name, Date_
EOF

echo "Wrote skeleton: $OUTPUT"
echo "Raw data dir: outputs/raw/${DATE}-${TOPIC}/"
echo ""
echo "Next: agent must fill placeholders via web_search + aoc-connect, then mark Status: ready."
