---
name: pricing-strategy-analyzer
description: "WAJIB DIGUNAKAN: Setiap kali Biz Analyst agent perlu propose atau evaluate pricing strategy untuk produk/feature. Trigger juga untuk frasa 'pricing strategy', 'analisis harga', 'tier pricing', 'value-based pricing', 'price elasticity', 'penetration vs skim', 'discount strategy'. Skill ini structured framework: pricing model selection (subscription/usage/tier/freemium/perpetual) + value-vs-cost-vs-competitor positioning + WTP analysis + tier design + discount policy. Output: pricing-strategy-{product}.md."
---

# Pricing Strategy Analyzer

Propose / evaluate pricing strategy pakai **structured framework**: model selection + WTP positioning + tier design + discount policy. Bukan "harga ditentukan competitor" autopilot.

<HARD-GATE>
Setiap pricing proposal WAJIB include: model rationale, value/cost/competitor anchor, WTP evidence, tier structure (kalau multi-tier).
WTP (Willingness to Pay) WAJIB cite source (van Westendorp survey / interview / industry benchmark).
Cost-plus pricing alone WAJIB rejected — must compare with value-based + competitive.
Tier design WAJIB punya clear feature-gating logic (kalau apa lah masuk tier mana).
Discount policy WAJIB explicit (when allowed, max %, approval level) — preventing race-to-bottom.
JANGAN kasih single price tanpa rationale framework.
JANGAN tier dengan >5 levels — analysis paralysis.
JANGAN free-tier tanpa explicit conversion path / cost cap.
Localization (PPP / per-currency) WAJIB considered untuk global product.
</HARD-GATE>

## When to use

- New product launch — initial pricing
- Quarterly pricing review
- Competitive pricing pressure (need response)
- Tier restructure (consolidate / split)
- Discount policy refresh

## When NOT to use

- One-off custom enterprise deal — that's sales negotiation
- Internal cost allocation pricing (transfer pricing) — separate domain
- Open-source / free product with no monetization — not applicable

## Pricing Models (decision matrix)

| Model | Best for | Pros | Cons |
|---|---|---|---|
| **Subscription (flat)** | Predictable usage, B2B SaaS | Predictable revenue | Heavy users overpay perceived |
| **Usage-based** | Variable consumption (API, infra) | Aligned to value | Bill shock risk, harder to forecast |
| **Tiered** | Diverse personas | Capture WTP across segments | Complexity, overlap risk |
| **Freemium** | Network effect, viral | Low CAC | Free-rider cost cap critical |
| **Perpetual + maintenance** | On-prem enterprise | Large upfront | Cash flow cyclical |
| **Per-seat** | Team SaaS | Predictable scaling | Discourages adoption breadth |
| **Value-metric (custom)** | Vertical-specific | Strong PMF signal | Hard to communicate |

## Required Inputs

- **Product/feature scope**
- **Target segment(s)** — persona + size + WTP signal
- **Cost base** — unit cost per user/transaction
- **Competitor pricing** — top 3-5 alternatives
- **Strategic positioning** — premium / value / penetration / skim

## Output

`outputs/{date}-pricing-strategy-{product}.md`:
1. Strategic positioning
2. Model selection + rationale
3. Triangulated price (cost / value / competitor)
4. WTP evidence summary
5. Tier design
6. Discount policy
7. Localization notes
8. Risk + sensitivity

## Strategy Template

```markdown
# Pricing Strategy — {Product}

## Strategic positioning

**Position:** Premium / Value / Penetration / Skim
**Rationale:** {why this position fits market + product maturity + competitive context}

## Model selection

**Selected:** Subscription tiered + per-seat
**Why:** {rationale based on usage pattern + segment heterogeneity + revenue predictability needs}
**Rejected alternatives:**
- Usage-based: customers prefer predictable bills (interview signal n=12)
- Freemium: support cost cap not feasible at our scale

## Price triangulation

| Anchor | Price point | Source |
|---|---|---|
| Cost-plus floor | $12/user/mo | unit cost $4 + 200% gross margin target |
| Competitive median | $25/user/mo | top 3 competitors avg ($20, $25, $30) |
| Value-based ceiling | $48/user/mo | ROI to customer = $480/mo, 10% capture |
| **Recommended** | $29/user/mo | between competitive median + cost floor, ~60% of value ceiling |

## WTP evidence

- **Van Westendorp survey** (n=82): Optimum Price Point = $27, Indifference = $32
- **Interview signals** (n=18): "$30 acceptable", "$50 too much", "$15 unsustainable for vendor"
- **Win/loss data** (last 90d): deals lost at $35 cited price; deals won at $25-30 range

## Tier design

| Tier | Price | Target persona | Key features | Annotated value |
|---|---|---|---|---|
| **Starter** | $19/seat/mo | Solo / small team | Core feature, basic support | "Get started, prove value" |
| **Pro** | $29/seat/mo | Mid-market | + Integrations, priority support | "Scale across teams" |
| **Enterprise** | $49/seat/mo (min 50 seats) | Enterprise | + SSO, audit log, SLA, CSM | "Compliance + dedicated success" |

**Feature-gating logic:**
- Starter has hard limits (3 users, 1 integration) — friction signals upgrade time
- Pro removes limits + adds collab features
- Enterprise gates on compliance/security only — no core feature gating (avoid "feature hostage")

## Discount policy

| Discount | Max % | Approval | Conditions |
|---|---|---|---|
| Annual prepay | 15% | Auto | Always available |
| Multi-year (3yr) | 25% | Sales rep | Locked term |
| Volume (>100 seats) | 20% | Sales lead | Combined with annual |
| Strategic logo | 30%+ | VP sales | Board-approved list only |
| Promo (launch / event) | 25% | Marketing lead | Time-bound, max 90d |

**Discount stacking:** max 35% total off list. No exceptions without exec approval + audit note.

## Localization

| Region | Multiplier | Currency | Notes |
|---|---|---|---|
| US/Canada | 1.0× | USD | Reference market |
| EU | 0.95× | EUR | Localized billing required |
| UK | 0.90× | GBP | — |
| Brazil | 0.55× | BRL | PPP-adjusted |
| India | 0.40× | INR | PPP-adjusted, common segment |
| SEA | 0.50× | USD | Single-currency for simplicity |

## Risks + sensitivity

| Risk | Mitigation |
|---|---|
| Competitor price drop | Watch quarterly, maintain differentiation narrative |
| Currency volatility | Annual price review, hedging for major currencies |
| WTP misjudgment | A/B test with cohorts, kill-switch at 6mo |
| Margin compression | Cost watchlist on top-3 cost drivers |

## Approval

- [ ] Finance reviewer
- [ ] Sales lead
- [ ] PM lead
- [ ] Exec sign-off (kalau Tier change atau >20% price move)
```

## Checklist

You MUST create a TodoWrite task for each item and complete them in order:

1. **Define Strategic Position** — premium / value / penetration / skim
2. **Select Pricing Model** — match decision matrix to product context
3. **Compute Cost Floor** — unit cost + target margin
4. **Map Competitor Prices** — top 3-5
5. **Estimate Value Ceiling** — customer ROI × capture %
6. **Triangulate Recommended Price** — between floor + competitive + ceiling
7. **Gather WTP Evidence** — survey / interview / win-loss
8. **Design Tiers** — feature-gating logic, max 5 tiers
9. **Define Discount Policy** — max %, approval, stacking rules
10. **Localize** — PPP-adjusted multipliers per region
11. **Run Sensitivity** — adoption × price elasticity
12. **Identify Risks + Mitigation**
13. **Output Strategy Doc** — `outputs/{date}-pricing-strategy-{slug}.md`

## Anti-Pattern

- ❌ Cost-plus only (no value or competitive anchor)
- ❌ Match-competitor only (no value differentiation)
- ❌ Single price tanpa tier rationale
- ❌ Freemium tanpa cost cap — bleeding
- ❌ Tier overlap (unclear what Pro adds vs Starter) — analysis paralysis
- ❌ Discount stacking unbounded — race to bottom
- ❌ Same price all regions — leaves money on table or prices out
- ❌ No kill-switch — price set-and-forget

## Inter-Agent Handoff

| Direction | Trigger | Skill / Tool |
|---|---|---|
| **Biz** ← **PM** | New product / pricing review | author strategy |
| **Biz** ← `unit-economics-calculator` | Unit cost confirmed | feed cost floor |
| **Biz** ← `tam-sam-som-estimator` | Segment sizing done | feed tier targeting |
| **Biz** → `biz-viability-report` | Pricing finalized | feed revenue model |
| **Biz** → sales team | Approved pricing | enablement docs |
