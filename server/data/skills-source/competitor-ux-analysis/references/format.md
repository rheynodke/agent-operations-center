# Output Format — Competitor UX Analysis

## Filename

`outputs/YYYY-MM-DD-competitor-ux-{flow-slug}.md`

## Required sections (in order)

1. **H1** — `# Competitor UX Analysis: {Flow}`
2. **Header** — Date, Status, Flow scope, Competitors count + list, Captures dir
3. **Executive Summary** — 5-7 bullets
4. **Methodology** — framework, scoring scale, capture method, selection rationale
5. **Per-Competitor Analysis** — for each: captures table + top observations + 3 strengths + 3 weaknesses
6. **Comparative Matrix** — Heuristic × Competitor + Us baseline + Best in class
7. **Pattern Inventory** — Convergent / Divergent / Unique sections
8. **Adopt / Avoid List** — table with contextual rationale per pattern
9. **Open Questions** — capture gaps
10. **Sign-off** — UX Lead

## Capture conventions

- Path: `outputs/raw/competitor-screens/{competitor}/{flow-step}-{N}.png`
- Minimum 3 screens per competitor (entry + flow midpoint + edge case)
- Screenshots WAJIB referenced di evaluation, gak boleh klaim verbal

## Scoring values (strict)

1-5 integer per heuristic per competitor:
- **5** Exemplary
- **4** Solid
- **3** Adequate
- **2** Weak
- **1** Failed

Decimal values not allowed (forces clarity).

## Recommendation values (strict)

- `ADOPT` — pattern works for our context
- `AVOID` — conflicts with our positioning or user research
- `INVESTIGATE` — promising but needs validation

Rationale WAJIB contextual, bukan "everyone does it".

## Anti-pattern

- ❌ <3 competitors
- ❌ <3 screens per competitor
- ❌ Score tanpa screenshot citation
- ❌ Matrix tanpa "Us" baseline
- ❌ Adopt rationale "industry standard" — terlalu generic
- ❌ Capture dari paywall tanpa authorization
- ❌ Output sekedar gallery — harus ada sintesis
