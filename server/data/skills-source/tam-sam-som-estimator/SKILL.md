---
name: tam-sam-som-estimator
description: "WAJIB DIGUNAKAN: Setiap kali Biz Analyst agent perlu mengestimasi market size, assess market opportunity, atau sizing TAM/SAM/SOM. Trigger juga untuk frasa 'market sizing', 'TAM SAM SOM', 'seberapa besar market-nya', 'market opportunity', 'addressable market', 'berapa potensi revenue market ini', 'top-down bottom-up'. Skill ini structured framework: top-down + bottom-up estimation → cross-validation → growth projection. Setiap angka WAJIB cite source. Output: tam-sam-som-{market}.md."
---

# TAM / SAM / SOM Estimator

Estimate market opportunity pakai **dual-methodology** (top-down + bottom-up) dengan cross-validation. Bukan random large number — structured, source-cited, confidence-tagged market sizing.

<HARD-GATE>
WAJIB gunakan KEDUA metode (top-down + bottom-up) lalu cross-validate — single-method = unreliable.
Setiap angka WAJIB cite source (research report, public data, comparable company, government stats, interview).
SOM WAJIB realistis — jangan claim >5% market share di tahun 1 tanpa strong evidence.
TAM ≠ "everyone who could possibly use this" — be specific about buyer persona + geography + willingness to pay.
Growth rate (CAGR) WAJIB dari credible source — bukan wishful thinking.
Confidence level WAJIB tagged per estimate: 🟢 High (data-backed) / 🟡 Medium (comparable) / 🔴 Low (assumption).
JANGAN mix currency tanpa explicit conversion + date.
JANGAN present TAM as single number — always range (low/likely/high).
</HARD-GATE>

## When to use

- Pre-discovery: PM/Biz evaluating whether market worth entering
- Business case: feeding market size into `biz-viability-report`
- Investor pitch: defensible market size narrative
- Annual strategic review: market growth tracking
- Feature-level opportunity sizing: is this segment big enough to justify build?

## When NOT to use

- Individual customer opportunity (that's sales pipeline)
- Competitor revenue estimation alone (separate analysis)
- Micro-feature impact estimation (use `value-score-calculator`)

## Terminology

| Term | Definition | Think of as |
|---|---|---|
| **TAM** (Total Addressable Market) | Total revenue opportunity if 100% market share, globally | "The whole pie" |
| **SAM** (Serviceable Addressable Market) | Portion of TAM your product can realistically serve (geography, segment, capability) | "The slice we can reach" |
| **SOM** (Serviceable Obtainable Market) | Portion of SAM you can capture in target timeframe (1-3 yr) | "The bite we'll take" |

## Required Inputs

- **Market definition** — product category, buyer persona, geography
- **Time horizon** — typically 3-5 year projection
- **Pricing model** — ARPU / ACV / transaction value (from `pricing-strategy-analyzer` if available)
- **Competitive landscape** — market leaders + share distribution
- **Growth context** — industry CAGR, secular trends

## Script Helper

Scaffold a market sizing report skeleton:

```bash
./scripts/estimate.sh --market "Cloud PM for SME Manufacturing Indonesia" \
  --geography "Indonesia" --horizon 3 \
  --arpu 3600 --cagr 12 \
  --output outputs/$(date +%Y-%m-%d)-tam-sam-som-cloud-pm.md
```

The script:
- Pre-fills top-down + bottom-up estimation frameworks
- Generates cross-validation comparison table
- Creates growth projection rows for N years
- Includes confidence assessment + data sources section

Agent MUST fill all `_[fill]_` placeholders with source-cited data after scaffolding.

See `references/format.md` for the strict output format specification.

## Output

`outputs/{date}-tam-sam-som-{market}.md`:
1. Market definition + scope
2. Top-down estimation
3. Bottom-up estimation
4. Cross-validation + reconciliation
5. Growth projection (3-5 yr)
6. Confidence assessment
7. Data sources + methodology notes

## Estimation Template

```markdown
# TAM/SAM/SOM — {Market Definition}

**Date:** {YYYY-MM-DD}
**Author:** Biz Analyst (#7)
**Geography:** {scope}
**Time Horizon:** {N}-year

## Executive summary

| Metric | Low | Likely | High | Confidence |
|---|---|---|---|---|
| TAM | $Xm | $Ym | $Zm | 🟡 Medium |
| SAM | $Am | $Bm | $Cm | 🟡 Medium |
| SOM (Y1) | $Dm | $Em | $Fm | 🔴 Low |
| SOM (Y3) | $Gm | $Hm | $Im | 🔴 Low |

## Market definition

**Category:** {e.g., "Cloud-based project management for SME manufacturers in Indonesia"}
**Buyer persona:** {role, company size, geography, budget range}
**Exclusions:** {what's explicitly out of scope — e.g., "enterprise >500 employees, non-manufacturing"}

## Top-down estimation

Start from total industry → narrow down.

| Layer | Value | Source | Confidence |
|---|---|---|---|
| Global {category} market | $X B | {Gartner/Statista/McKinsey 2025 report} | 🟢 High |
| Asia-Pacific share | $Y B ({Z}%) | {same report regional split} | 🟢 High |
| Indonesia share | $W M ({V}% of APAC) | {BPS data + GDP proportional} | 🟡 Medium |
| SME segment | $U M ({T}% of ID total) | {BPS UMKM stats} | 🟡 Medium |
| Manufacturing vertical | $S M ({R}% of SME IT) | {industry vertical report} | 🟡 Medium |
| **TAM (top-down)** | **$S M** | Narrowed from global | 🟡 Medium |

**SAM filter:**
- Can serve companies with {criteria}: $P M ({Q}% of TAM)
- **SAM (top-down):** $P M

**SOM filter:**
- Realistic Y1 penetration: {X}% of SAM → $N M
- Y3 target: {Y}% of SAM → $O M
- **SOM (top-down):** Y1=$N M, Y3=$O M

## Bottom-up estimation

Start from addressable customers × ARPU.

| Factor | Value | Source | Confidence |
|---|---|---|---|
| Total addressable companies | {N} | {BPS registry / industry association} | 🟡 Medium |
| % willing to pay for solution | {X}% | {interview n=20 / survey n=100} | 🔴 Low |
| Addressable companies | {N × X%} | Computed | 🔴 Low |
| ARPU (annual) | ${Y} | {pricing strategy / comparable product} | 🟡 Medium |
| **TAM (bottom-up)** | {addressable × ARPU} | Computed | 🟡 Medium |

**SAM (bottom-up):**
- Reachable via our channels: {Z}% of addressable → {N'} companies
- SAM = {N'} × ARPU = ${M'}

**SOM (bottom-up):**
- Y1 pipeline target: {A} companies × conversion {B}% × ARPU
- Y3 pipeline target: {C} companies × conversion {D}% × ARPU

## Cross-validation

| Metric | Top-down | Bottom-up | Delta | Reconciled |
|---|---|---|---|---|
| TAM | $X M | $Y M | {Z}% | $W M |
| SAM | $A M | $B M | {C}% | $D M |
| SOM Y1 | $E M | $F M | {G}% | $H M |

**Reconciliation notes:**
- If delta < 30%: average the two estimates
- If delta > 30%: investigate source of discrepancy, adjust the weaker estimate
- Disclose which estimate you have higher confidence in and why

## Growth projection

| Year | SOM | Growth driver | CAGR applied |
|---|---|---|---|
| Y1 | $X M | Initial sales + partnerships | — |
| Y2 | $Y M | Word-of-mouth + channel expansion | {N}% |
| Y3 | $Z M | Market expansion + upsell | {N}% |
| Y5 | $W M | New segment + geography | {M}% |

**Industry CAGR:** {X}% (source: {report})

## Confidence assessment

| Estimate | Confidence | Why |
|---|---|---|
| TAM | 🟡 Medium | Based on credible reports but Indonesia-specific data limited |
| SAM | 🟡 Medium | Channel reach assumptions need validation |
| SOM Y1 | 🔴 Low | No sales history, pure projection |
| CAGR | 🟢 High | Multiple corroborating sources |

## Data sources

1. {Report name, publisher, year, URL}
2. {Government stats source, date}
3. {Interview data: n=X, methodology}
4. {Comparable company data source}
```

## Checklist

You MUST create a TodoWrite task for each item and complete them in order:

1. **Define Market Scope** — category, buyer persona, geography, exclusions
2. **Gather Data Sources** — research reports, government stats, interviews, comparables
3. **Top-Down Estimation** — global → regional → country → segment → vertical
4. **Bottom-Up Estimation** — addressable companies × ARPU
5. **Cross-Validate** — compare both methods, reconcile discrepancies
6. **Confidence Tag** — 🟢🟡🔴 per estimate
7. **Growth Projection** — CAGR-based 3-5 year forecast
8. **Sensitivity Range** — low / likely / high for each tier
9. **Document Sources** — every number has a citation
10. **Output Report** — `outputs/{date}-tam-sam-som-{slug}.md`

## Anti-Pattern

- ❌ Top-down only (no bottom-up grounding)
- ❌ Bottom-up only (miss macro trends)
- ❌ TAM = "everyone on earth" — be specific about buyer
- ❌ SOM = 10%+ of TAM in Y1 — unrealistic without evidence
- ❌ Single-point estimate (no range)
- ❌ Growth projection without CAGR source
- ❌ Mix currencies without explicit conversion
- ❌ Ignore market maturity (early vs saturated)
- ❌ Confuse willingness-to-pay with ability-to-pay
- ❌ "Educated guess" ARPU without anchoring to comparable

## Inter-Agent Handoff

| Direction | Trigger | Skill / Tool |
|---|---|---|
| **Biz** ← **PM** | Market opportunity question | estimate TAM/SAM/SOM |
| **Biz** ← `market-research` | Research data available | feed into sizing |
| **Biz** ← `pricing-strategy-analyzer` | ARPU finalized | feed into bottom-up |
| **Biz** → `biz-viability-report` | Market sizing done | feed revenue model |
| **Biz** → `competitive-moat-assessor` | SAM defined | feed efficient-scale moat analysis |
| **Biz** → **PM** | SOM too small | recommend pivot or expand scope |
