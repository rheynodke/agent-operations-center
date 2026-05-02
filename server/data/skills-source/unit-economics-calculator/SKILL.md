---
name: unit-economics-calculator
description: "WAJIB DIGUNAKAN: Setiap kali Biz Analyst agent perlu compute unit economics: CAC, LTV, payback, gross margin per customer. Trigger juga untuk frasa 'unit economics', 'CAC LTV', 'customer payback', 'gross margin per user', 'churn impact', 'cohort economics'. Skill ini canonical formulas + cohort-based vs blended distinction + sensitivity analysis. Output: unit-econ-{product}.md dengan dashboard-ready numbers."
---

# Unit Economics Calculator

Compute **unit economics** dengan canonical formulas — bukan gut-feel "per-user revenue minus per-user cost". Cohort-based, sensitivity-tested, sanity-checked.

<HARD-GATE>
Setiap report WAJIB compute: CAC, LTV, LTV:CAC ratio, payback period, gross margin per customer.
LTV WAJIB cohort-based kalau cohort data ada, blended kalau tidak — declare which.
LTV:CAC ratio target ≥3:1 untuk SaaS healthy — flag merah kalau <2:1.
Payback period target ≤12 months untuk SMB, ≤18 months untuk mid-market, ≤24 months untuk enterprise.
JANGAN gunakan ARPU sebagai proxy LTV — ARPU × tenure ≠ LTV (ignore churn dynamics).
JANGAN exclude support / infra cost dari gross margin — full-loaded only.
Churn assumption WAJIB explicit + cite source (cohort observed atau industry benchmark).
Sensitivity analysis WAJIB run pada churn rate (±25%) + CAC (±20%).
</HARD-GATE>

## When to use

- Pre-launch: validate model viability
- Quarterly: track unit econ trends
- Pricing change: re-compute LTV
- Funding round: investor expects clean unit econ slide
- Cohort analysis post-90d: confirm assumptions vs actual

## When NOT to use

- One-off transaction business (no recurring) — use simpler margin per sale
- Very early stage with <90d data — too noisy, use industry benchmarks instead
- Free product with no monetization — compute "cost per active user" instead

## Canonical Formulas

### CAC (Customer Acquisition Cost)

```
CAC = (Marketing Spend + Sales Spend) / New Customers Acquired
```

Time window: typically last 90 days, sometimes blended quarterly.

**Loaded CAC:** include sales rep salary, marketing tools, ad spend, fees.
**Fully-loaded CAC:** also include onboarding cost (SE time, free trial infra).

### Gross Margin per Customer

```
Gross Margin % = (Revenue - COGS) / Revenue
COGS includes: hosting, support, processing fees, third-party API costs
Gross Profit per Customer = ARPU × Gross Margin %
```

### Churn

```
Monthly churn rate = customers lost in month / customers at start of month
Annual churn ≈ 1 - (1 - monthly_churn)^12
Net Revenue Retention (NRR) = (start MRR - churn MRR + expansion MRR) / start MRR
```

### LTV (Customer Lifetime Value)

**Simple LTV (assumes constant churn):**
```
LTV = ARPU × Gross Margin % / monthly_churn_rate
```

**Cohort-based LTV (preferred if cohort data ≥6 months):**
```
LTV = Σ (cohort_revenue_month_n × gross_margin) for n=1..36
discount each month by (1 + WACC)^-n
```

### Payback Period

```
Payback (months) = CAC / (ARPU × Gross Margin %)
```

### LTV:CAC Ratio

```
LTV:CAC = LTV / CAC

Healthy: ≥3.0
Suspicious low: <2.0 (under-monetized or over-spending acquisition)
Suspicious high: >5.0 (likely under-spending acquisition, leaving growth on table)
```

## Required Inputs

- **Time window** — last 90d default
- **Revenue per customer** — ARPU monthly + annual
- **COGS per customer** — hosting, support, processing
- **Marketing + Sales spend** — fully-loaded
- **New customers acquired** — same window
- **Monthly churn rate** — cohort observed atau benchmark
- **Discount rate (WACC)** — for NPV-style LTV (default 10%)

## Output

`outputs/{date}-unit-econ-{product}.md`:
1. Inputs + assumptions
2. Computed metrics (CAC, LTV, payback, ratio)
3. Cohort vs blended comparison
4. Sensitivity analysis
5. Health check + flags
6. Recommendations

## Report Template

```markdown
# Unit Economics — {Product}

**Date:** {YYYY-MM-DD}
**Window:** Q1 2026 (Jan 1 – Mar 31)
**Method:** Cohort-based (Jan 2026 cohort, 90d observed)

## Inputs

| Input | Value | Source |
|---|---|---|
| ARPU (monthly) | $35 | Stripe MRR / active customers |
| Gross margin % | 76% | Hosting + support + processing fully loaded |
| Monthly churn | 3.2% | Cohort observed (Q1 2026) |
| Marketing spend (90d) | $180,000 | HubSpot + ad platforms |
| Sales spend (90d) | $120,000 | Salaries + tools |
| New customers (90d) | 480 | Stripe new subs |
| WACC | 10% | Standard |

## Computed metrics

| Metric | Value | Calculation |
|---|---|---|
| CAC | $625 | (180K + 120K) / 480 |
| Gross profit / customer / mo | $26.60 | $35 × 76% |
| Simple LTV | $831 | $26.60 / 0.032 |
| Cohort LTV (NPV) | $720 | Σ discounted gross profit, 36 months |
| Payback period | 23.5 months | $625 / $26.60 |
| LTV:CAC | 1.15 | $720 / $625 |
| Annual churn | 32% | 1 - (1-0.032)^12 |

## Health check

🔴 **LTV:CAC = 1.15 — UNHEALTHY** (target ≥3.0)
🔴 **Payback 23.5 mo — TOO LONG for SMB target** (target ≤12 mo)
🟡 **Annual churn 32% — high** (industry benchmark 20-25%)

## Sensitivity analysis

| Scenario | Churn | CAC | LTV:CAC | Payback |
|---|---|---|---|---|
| Pessimistic | 4.0% | $750 | 0.84 | 28 mo |
| Likely (current) | 3.2% | $625 | 1.15 | 23.5 mo |
| Optimistic | 2.4% | $500 | 2.22 | 18.8 mo |

**Even optimistic case below 3:1 target.**

## Diagnosis

Three pressure points:

1. **Churn too high (32% annual)** — investigate top churn reasons (interview lapsed users)
2. **CAC heavy** — sales-led model, but ARPU too low to support sales loaded cost
3. **ARPU low** — $35/mo SMB pricing, but acquisition cost matches mid-market

## Recommendations

1. **Reduce churn** — onboarding flow audit (target 2.5% monthly = 26% annual)
2. **Shift to product-led growth** — slash sales loaded cost; freemium with strict cost cap
3. **OR raise ARPU** — move to $79/mo Pro tier with feature gating; eliminate $35 starter

**Decision required:**
- (A) Stay course, fix churn → 6-mo experiment
- (B) Pivot pricing up → repricing exercise
- (C) Pivot to PLG → bigger restructure

## Approval

- [ ] Finance reviewer
- [ ] PM lead
- [ ] Sales/marketing lead
```

## Checklist

You MUST create a TodoWrite task for each item and complete them in order:

1. **Define Time Window** — typically 90d cohort
2. **Pull ARPU** — revenue / active customers
3. **Pull COGS** — fully-loaded gross margin
4. **Pull Marketing + Sales Spend** — fully-loaded CAC
5. **Pull / Estimate Churn** — cohort observed or benchmark
6. **Compute CAC**
7. **Compute Simple LTV** — ARPU × GM% / churn
8. **Compute Cohort LTV** (kalau cohort ≥6 months data)
9. **Compute Payback Period**
10. **Compute LTV:CAC Ratio**
11. **Run Sensitivity** — pessimistic / likely / optimistic
12. **Health Check + Flag** — vs targets
13. **Diagnose Pressure Points** — churn / CAC / ARPU
14. **Recommend Actions**
15. **Output Report**

## Anti-Pattern

- ❌ ARPU × tenure as LTV — ignores churn dynamics
- ❌ Exclude support cost from GM — over-rosy
- ❌ Single-point CAC (no time window declared)
- ❌ Skip cohort, blended only — masks improving/degrading trends
- ❌ No sensitivity test — false precision
- ❌ Compute LTV:CAC tanpa interpretation (just number drop)
- ❌ Churn assumed flat industry benchmark when cohort data exists — ignore your own signal
- ❌ Recommend tactics without diagnosis — random fixes

## Inter-Agent Handoff

| Direction | Trigger | Skill / Tool |
|---|---|---|
| **Biz** ← **PA** | Cohort data 90d ready | compute unit econ |
| **Biz** ← finance API | Spend + revenue snapshots | inputs |
| **Biz** → `pricing-strategy-analyzer` | LTV:CAC unhealthy | re-price |
| **Biz** → `biz-viability-report` | Y1 unit econ available | feed forecast |
| **Biz** → **PM** | Diagnosis done | recommend product changes (onboarding, churn) |
