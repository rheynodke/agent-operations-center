---
name: biz-viability-report
description: "WAJIB DIGUNAKAN: Setiap kali Biz Analyst agent perlu assess business viability dari feature/product proposal — apakah ekonomi-nya masuk akal. Trigger juga untuk frasa 'biz viability', 'business case', 'go/no-go financial', 'ROI assessment', 'payback period', 'feature business case'. Skill ini integrate revenue model + cost structure + payback + risk → output structured report. Bukan generic SWOT — concrete numbers + assumptions + sensitivity. Output: biz-viability-{feature}.md untuk PM/EM/CEO go-no-go."
---

# Business Viability Report

Assess **business viability** dari feature/product proposal dengan concrete numbers — bukan generic SWOT. Output: structured report untuk go/no-go decision.

<HARD-GATE>
Setiap report WAJIB include: revenue model, cost structure, payback period, sensitivity analysis, key risks.
Setiap angka WAJIB cite assumption source (data point / interview / industry benchmark / educated guess).
"Educated guess" assumptions WAJIB flagged explicit + sensitivity test (low/likely/high).
Payback period WAJIB ≤24 months untuk feature-level proposals — kalau lebih, escalate ke product strategy review.
JANGAN gunakan vanity metrics ("user engagement up") tanpa $ translation.
JANGAN skip sensitivity analysis — single-point estimate masking uncertainty.
Decision frame WAJIB explicit: GO / NO-GO / DEFER / PIVOT — bukan "looks promising".
Hidden costs (maintenance, support, opportunity cost) WAJIB included — bukan cuma build cost.
</HARD-GATE>

## When to use

- Pre-greenlight: PM/PA proposes feature, need biz validation before EM commits
- Product strategy review (quarterly)
- Competitive response decision (build vs buy vs ignore)
- Sunset decision (kill underperforming feature)

## When NOT to use

- Simple bug fix / tech debt / refactor — zero biz angle
- Compliance-mandated work — biz angle moot, must do
- Internal dev tooling — separate ROI framing (productivity not revenue)

## Required Inputs

- **Feature/proposal name + scope**
- **Target segment / user count** — TAM/SAM data (from `tam-sam-som-estimator` if available)
- **Pricing strategy** — from `pricing-strategy-analyzer` if applicable
- **Effort estimate** — from EM `effort-estimator` (person-months)
- **Cost model** — engineering rate, infrastructure, support, opportunity cost
- **Revenue model** — how this feature monetizes (direct, retention, upsell, free)

## Output

`outputs/{date}-biz-viability-{feature}.md`:
1. Executive summary (1 page)
2. Revenue model
3. Cost structure
4. Payback + ROI
5. Sensitivity analysis (low/likely/high)
6. Key risks + mitigation
7. Decision recommendation

## Report Template

```markdown
# Business Viability — {Feature}

**Date:** {YYYY-MM-DD}
**Author:** Biz Analyst (#7)
**Decision:** GO / NO-GO / DEFER / PIVOT

## Executive summary

> 5 bullets:
> 1. What we're proposing
> 2. Expected revenue impact (Y1)
> 3. Total cost (build + Y1 ops)
> 4. Payback period
> 5. Top risk

## Revenue model

| Source | Y1 | Y2 | Y3 | Assumption |
|---|---|---|---|---|
| New user acquisition | $X | $Y | $Z | 5% conversion of TAM (interviewed N=20, see ux-research-{date}) |
| Existing user upsell | ... | ... | ... | 10% of active base, $Z ACV uplift |
| Retention saved (churn ↓) | ... | ... | ... | 2pp churn reduction × $X LTV |
| **Total revenue** | $A | $B | $C | |

**Assumption strength:**
- 🟢 Strong (data-backed): conversion rate, LTV
- 🟡 Medium: upsell rate (interview-based)
- 🔴 Weak (educated guess): churn reduction (no historical baseline) → sensitivity test required

## Cost structure

| Cost type | Y1 | Y2 | Y3 | Notes |
|---|---|---|---|---|
| Build (eng) | $X | — | — | 4 PM × $15K/PM = $60K |
| Infra | $Y | $Y | $Y | $Z/mo × 12 + 30% growth |
| Support / docs | $Z | $Z' | $Z'' | 0.5 FTE Y1, 0.25 ongoing |
| Opportunity cost | $W | — | — | What else could this team do |
| **Total cost** | $T | $T' | $T'' | |

## Payback + ROI

- **Cumulative net cash flow:**
  - Y1: -$P (investment phase)
  - Y2: $Q (recovery)
  - Y3: $R (return)
- **Payback period:** ~14 months
- **3-year ROI:** {(R-T_total)/T_total × 100}%
- **NPV (10% discount):** $N

## Sensitivity analysis

| Scenario | Adoption | Y3 Net | Decision impact |
|---|---|---|---|
| Pessimistic | 50% of likely | -$X | Underwater, NO-GO |
| Likely | base estimate | $Y | GO |
| Optimistic | 150% of likely | $Z | Strong GO |

**Break-even adoption:** 38% of TAM (vs 50% likely target).

## Key risks + mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Conversion lower than estimated | Medium | High | Validate via prototype-test before full build |
| Competitor launches similar | High | Medium | Speed-to-market, differentiation focus |
| Maintenance cost escalates | Medium | Medium | Cap support hours, automate FAQ deflection |
| Churn reduction fails to materialize | Medium | High | Baseline measurement first 90d, kill-switch criteria |

## Hidden costs (often missed)

- Documentation refresh: 2 weeks tech writer
- Sales enablement: 1 week sales training
- Customer success training: 1 week
- Legal/compliance review: 0.5 week
- **Total hidden:** ~$15K (~10% of build cost)

## Decision

**GO** — payback within target (14 mo), Y3 NPV positive, top risk has prototype-test mitigation.

**Conditions:**
- Validate conversion via prototype-test before full build (gate)
- Baseline churn before launch (90-day measurement window)
- Kill-switch: if Y1 adoption < 30% of TAM by month 9, sunset

**Approver:** PM lead, EM lead, finance reviewer (sign-off task tag `biz-viability-signoff`).
```

## Checklist

You MUST create a TodoWrite task for each item and complete them in order:

1. **Define Scope** — feature, target segment, time horizon (3-yr default)
2. **Build Revenue Model** — sources × assumptions
3. **Build Cost Structure** — build + ops + support + opportunity cost
4. **Identify Hidden Costs** — docs, training, compliance, legal
5. **Compute Payback + NPV + 3-yr ROI**
6. **Run Sensitivity Analysis** — pessimistic/likely/optimistic
7. **Identify Key Risks + Mitigation**
8. **Strength-tag Assumptions** — 🟢🟡🔴
9. **Frame Decision** — GO / NO-GO / DEFER / PIVOT + conditions
10. **Output Report** — `outputs/{date}-biz-viability-{slug}.md`
11. **Stakeholder Sign-off** — task tag `biz-viability-signoff`

## Anti-Pattern

- ❌ Vanity metrics ("engagement +20%") tanpa $ translation
- ❌ Single-point estimate (no sensitivity)
- ❌ Skip hidden costs — under-budget surprise
- ❌ "Educated guess" disguised as data — credibility loss
- ❌ Generic SWOT — non-actionable
- ❌ Decision = "looks promising" — non-binary
- ❌ Skip kill-switch criteria — sunk-cost trap
- ❌ Payback >24 mo without strategic justification — feature-level overreach

## Inter-Agent Handoff

| Direction | Trigger | Skill / Tool |
|---|---|---|
| **Biz** ← **PM** | Feature proposal | author viability report |
| **Biz** ← `tam-sam-som-estimator` | Market size data | feed into revenue model |
| **Biz** ← `pricing-strategy-analyzer` | Pricing decided | feed into revenue model |
| **Biz** ← `unit-economics-calculator` | Unit econ data | feed into Y1 estimates |
| **Biz** → **EM** | GO decision | greenlight to build |
| **Biz** → **PM** | NO-GO/DEFER | propose pivot or shelve |
