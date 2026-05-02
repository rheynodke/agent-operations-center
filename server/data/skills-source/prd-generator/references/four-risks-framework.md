# 4 Risks of Product Management — How to Apply

Reference: **Marty Cagan** (Silicon Valley Product Group) — from *Inspired* and *Empowered*.

Every PRD must address the 4 key risks with **balanced** depth. The most common failure mode is teams over-indexing on Value Risk ("will anyone use it?") while ignoring Usability, Feasibility, or Business Viability — the PRD sails through review but the product stalls in production.

## 1. Value Risk — "Will users actually want this?"

Key questions:

- Who has this problem? How many people?
- How painful is it? What supporting data do we have?
- Are there existing alternatives (built-in features, competitors, workarounds)?
- Why would a user choose this over the alternatives?
- What's the strongest evidence we have that this will be used?

Ways to validate before build:

- Interview 5+ target users.
- Landing page / prototype test (click-through rate, sign-up rate).
- Paid-ad smoke test.
- Review support tickets, forum complaints, review sites.

Strong signal: users **ask** for this repeatedly, or have already cobbled together a workaround.

## 2. Usability Risk — "Can users figure this out?"

Key questions:

- Who is most likely to fail at using this?
- What language do they speak (formal, technical, informal)?
- What device do they use (desktop / mobile / tablet)?
- How computer-literate are they?
- Do we need to provide training?

Ways to validate:

- Usability testing (Think-Aloud Protocol) with 5 target users.
- Error rate from logs (if a prior version exists).
- Support ticket volume — hard-to-use features pile up in support.
- SUS (System Usability Scale) score — target ≥ 68.

Weak signal: the feature only works after a 1-hour training session.

## 3. Feasibility Risk — "Can engineers actually build this?"

Key questions:

- Does our stack support this, or do we need something new?
- Is there a mature library / SDK, or do we build from scratch?
- How big is the effort (engineer-days)?
- Are there integration risks with upstream systems (ERP, CRM, legacy APIs)?
- Is the required data available and shaped correctly?
- Is the expected performance / scale realistic?
- Are there security / compliance complications?

Ways to validate:

- Spike / technical prototype (1–3 engineer-days).
- Load test on staging.
- Review with the tech lead / architect.
- Benchmark libraries / vendors (e.g. Mixpanel vs Amplitude, Postgres vs MongoDB).

Danger signal: engineers say "yeah we can do it" without having tried.

## 4. Business Viability Risk — "Is this healthy for the business?"

Key questions:

- Cost (development, ongoing hosting, third-party fees, LLM tokens) vs. revenue uplift?
- Is the per-transaction / per-user margin still positive?
- Legal / compliance implications (privacy law, B2B contracts)?
- Brand impact (will a broken product burn user trust)?
- Sales impact (GTM, pricing, positioning)?
- Support impact (new ticket volume)?
- Long-term maintenance burden?

Ways to validate:

- Unit-economics modeling (cost/user, revenue/user, break-even).
- Legal review (vendor contract, privacy policy).
- Review with Finance + Legal + Customer Success.
- Cost forecast at 6 and 12 months.

Danger signal: positive ROI only when every optimistic assumption comes true.

## How to write a balanced "Risks & Mitigation" section

Anti-pattern to avoid:

❌ **Over-indexed on Value Risk**
> "Main risk: users may not adopt it. Mitigation: marketing campaign."

This leaves 3 of 4 risks untouched. The PRD passes review but the product fails in production.

✅ **Balanced 4 Risks**

Each risk has ≥1 identified risk and ≥1 concrete mitigation. Analysis weight ~25% each:

| Risk | Risk | Mitigation |
|---|---|---|
| Value | Low adoption because users don't know the feature exists | In-app tour, onboarding email, launch webinar |
| Usability | Finance persona confused by technical jargon | Role-specific language, 2-minute tutorial video |
| Feasibility | Chosen library untested at 100k events/day scale | 2-day spike, staging load test, fallback to vendor B |
| Business Viability | LLM cost balloons if query volume spikes | Circuit breaker at $500/day, cheaper model fallback for non-critical flows |

## Scoring rubric for trade-off analyses

When comparing options (e.g. Mixpanel vs Amplitude vs PostHog), score each against the 4 risks with **equal weight**:

| Option | Value | Usability | Feasibility | Viability | Total |
|---|---|---|---|---|---|
| A | 5 | 4 | 3 | 4 | 16 / 20 = 4.00 |
| B | 4 | 5 | 5 | 3 | 17 / 20 = 4.25 |

Score per risk: `1` (very poor) … `5` (very good). Divide total by 20 to normalize to a 5-point scale.

Avoid unequal weights (e.g. 40% Value, 20% rest) unless the PRD explicitly explains why.

## Further reading

- Marty Cagan — *Inspired: How to Create Tech Products Customers Love* (2017).
- Marty Cagan — *Empowered: Ordinary People, Extraordinary Products* (2021).
- SVPG Blog — https://svpg.com/articles/
