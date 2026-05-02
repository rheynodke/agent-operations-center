---
name: competitive-moat-assessor
description: "WAJIB DIGUNAKAN: Setiap kali Biz Analyst agent perlu assess competitive advantage, evaluate defensibility, atau analisa apakah produk/feature punya sustainable moat. Trigger juga untuk frasa 'competitive moat', 'defensibility', 'barrier to entry', 'switching cost', 'network effects', 'competitive advantage', 'kenapa competitor gak bisa copy', 'apakah kita bisa digeser'. Skill ini structured assessment: moat type identification → strength rating → attack scenario → defensibility score → recommendation. Bukan generic competitive analysis — concrete moat evaluation. Output: competitive-moat-{product}.md."
---

# Competitive Moat Assessor

Assess **sustainable competitive advantage** dari produk/feature — apakah defensible terhadap competitor attack. Output: structured moat assessment dengan defensibility score + attack scenarios.

<HARD-GATE>
Setiap moat claim WAJIB punya evidence (data point, user behavior, contract terms, tech advantage) — bukan opinion.
Attack scenario WAJIB include top 3 competitors by name + specific how-they-could-attack narrative.
Defensibility score WAJIB 0-10 scale dengan rubric yang explicit — bukan arbitrary.
"First mover advantage" WAJIB rejected sebagai moat type — it's not a moat, it's a head start.
Brand alone WAJIB rejected sebagai moat — unless tied to measurable loyalty metrics (NPS > 50, churn < 2%).
Moat assessment WAJIB time-bounded — moat strength degrades, include 1-yr / 3-yr outlook.
JANGAN claim "no competitor" — there's always alternatives (including doing nothing).
JANGAN rate moat tanpa testing attack scenario dulu — strength is relative to attacker capability.
</HARD-GATE>

## When to use

- Pre-build: evaluate if feature/product worth building from defensibility angle
- Competitive response: competitor launched similar — assess our remaining moat
- Investor / board prep: defensibility narrative for fundraising
- Annual strategic review: are our moats strengthening or eroding?

## When NOT to use

- Comparing feature parity (use competitor analysis instead)
- UX competitor benchmarking (use `competitor-ux-analysis` from UX Agent)
- Pricing comparison (use `pricing-strategy-analyzer`)

## Moat Types Framework

| Moat Type | Description | Durability | Examples |
|---|---|---|---|
| **Network Effects** | Product more valuable with more users | Very High | Marketplace, social, protocol |
| **Switching Costs** | Painful to leave (data, integration, habit) | High | ERP, workflow tools, data platforms |
| **Cost Advantages** | Structural cost edge (scale, technology) | Medium-High | Infra, manufacturing, vertical integration |
| **Intangible Assets** | IP, brand, regulatory, data assets | Medium-High | Patents, licenses, proprietary datasets |
| **Efficient Scale** | Market too small for 2nd entrant to profit | Medium | Niche B2B, regulated verticals |
| **Counter-Positioning** | Incumbent can't copy without cannibalizing | Medium | Disruption plays (free vs paid incumbent) |

## Required Inputs

- **Product/feature scope** — what exactly are we assessing
- **Competitor landscape** — top 3-5 direct + 2-3 indirect competitors
- **User data** — retention, switching behavior, NPS if available
- **Business model** — how we monetize (relevant to counter-positioning)

## Script Helper

Scaffold a moat assessment report skeleton:

```bash
./scripts/assess.sh --product "Product Name" \
  --competitors "Competitor A|Competitor B|Competitor C" \
  --output outputs/$(date +%Y-%m-%d)-competitive-moat-product-name.md
```

The script:
- Pre-fills all 6 moat types in inventory table
- Generates attack scenario sections per competitor
- Includes defensibility score rubric
- Creates sign-off checklist

Agent MUST fill all `_[fill]_` placeholders with evidence-backed data after scaffolding.

See `references/format.md` for the strict output format specification.

## Output

`outputs/{date}-competitive-moat-{product}.md`:
1. Moat inventory (which types apply)
2. Moat strength rating per type
3. Attack scenarios (top 3 competitors)
4. Defensibility score (0-10)
5. Moat trajectory (1-yr / 3-yr)
6. Strengthening recommendations

## Assessment Template

```markdown
# Competitive Moat Assessment — {Product}

**Date:** {YYYY-MM-DD}
**Author:** Biz Analyst (#7)
**Defensibility Score:** {X}/10

## Executive summary

> 5 bullets:
> 1. What we're assessing
> 2. Strongest moat type + evidence
> 3. Weakest flank + top attacker
> 4. Overall defensibility (Strong / Moderate / Weak)
> 5. Top recommendation to strengthen

## Moat inventory

| Moat Type | Applies? | Strength | Evidence | 1-yr trend |
|---|---|---|---|---|
| Network Effects | ✅ Yes | Moderate (5/10) | 2-sided marketplace, 8K sellers, cross-side value visible | ↗ Growing |
| Switching Costs | ✅ Yes | Strong (7/10) | Avg user has 14 mo of data, 3+ integrations | → Stable |
| Cost Advantages | ❌ No | — | No structural cost edge vs competitors | — |
| Intangible Assets | ✅ Yes | Weak (3/10) | No patents, brand NPS 42 (moderate) | → Stable |
| Efficient Scale | ❌ No | — | Market large enough for 3+ players | — |
| Counter-Positioning | ✅ Yes | Moderate (5/10) | Incumbent would cannibalize $X revenue to match | ↘ Weakening |

## Attack scenarios

### Scenario 1: {Competitor A} copies our core feature
- **How they attack:** {specific narrative — launch timeline, resources, distribution}
- **Our defense:** {switching costs + data moat protect existing users}
- **Vulnerability:** {new user acquisition — no moat for prospects}
- **Risk level:** High

### Scenario 2: {Competitor B} undercuts on price
- **How they attack:** {freemium / loss-leader / VC-subsidized}
- **Our defense:** {value-based pricing, higher retention}
- **Vulnerability:** {price-sensitive segment could churn}
- **Risk level:** Medium

### Scenario 3: {Competitor C} builds on a platform shift
- **How they attack:** {AI-native, different architecture}
- **Our defense:** {data moat, established workflows}
- **Vulnerability:** {greenfield customers choose new arch}
- **Risk level:** Medium-High

## Defensibility Score Rubric

| Score | Meaning |
|---|---|
| 9-10 | Nearly unassailable (multiple strong moats, no viable attack path) |
| 7-8 | Strong (1-2 durable moats, attackers face high friction) |
| 5-6 | Moderate (moats exist but attackable with effort) |
| 3-4 | Weak (moats shallow, 12-18 mo to replicate) |
| 1-2 | Very weak (essentially commodity, no defensibility) |

**Current Score: {X}/10**

## Moat trajectory

| Timeframe | Projected Score | Key driver |
|---|---|---|
| Now | 6/10 | Switching costs + early network effects |
| 1 year | 7/10 | Network effects compound if growth holds |
| 3 years | 5/10 or 8/10 | Depends on platform shift response |

## Strengthening recommendations

1. **[High Impact]** Increase switching costs — deeper integrations, export friction
2. **[High Impact]** Accelerate network effects — cross-sell, community, marketplace features
3. **[Medium Impact]** Build data moat — proprietary insights layer competitors can't replicate
4. **[Low Impact]** Brand investment — NPS push to 60+

## Decision

**Defensibility: Moderate** — moats exist but require active strengthening. Recommend proceed with build + invest in recommendations 1-2 concurrently.

**Approver:** PM lead, strategy team (sign-off task tag `moat-assessment-signoff`).
```

## Checklist

You MUST create a TodoWrite task for each item and complete them in order:

1. **Define Scope** — product/feature being assessed
2. **Map Competitor Landscape** — top 3-5 direct + indirect competitors
3. **Inventory Moat Types** — which of the 6 moat types apply
4. **Collect Evidence** — data points per moat type
5. **Rate Moat Strength** — 0-10 per type
6. **Build Attack Scenarios** — top 3 competitor attack narratives
7. **Test Defenses** — for each attack, what protects us
8. **Identify Vulnerabilities** — where defenses fail
9. **Compute Defensibility Score** — weighted composite
10. **Project Trajectory** — 1-yr and 3-yr outlook
11. **Formulate Strengthening Recommendations**
12. **Output Report** — `outputs/{date}-competitive-moat-{slug}.md`

## Anti-Pattern

- ❌ "First mover advantage" as moat — it's not
- ❌ Brand alone = moat — only if measurable loyalty
- ❌ "No competitor" claim — alternatives always exist
- ❌ Rate strength without attack scenario test
- ❌ Static moat score — no trajectory projection
- ❌ Moat by assertion ("our tech is better") without evidence
- ❌ Ignore indirect competitors (substitutes, workarounds)
- ❌ Single moat reliance — diversify moat portfolio

## Inter-Agent Handoff

| Direction | Trigger | Skill / Tool |
|---|---|---|
| **Biz** ← **PM** | New feature proposal | assess defensibility |
| **Biz** ← `market-research` | Competitor landscape mapped | feed into attack scenarios |
| **Biz** ← `tam-sam-som-estimator` | Market sizing done | assess efficient scale moat |
| **Biz** → `biz-viability-report` | Moat score finalized | feed into viability assessment |
| **Biz** → **PM** | Weak moat + high value | recommend strengthening before build |
