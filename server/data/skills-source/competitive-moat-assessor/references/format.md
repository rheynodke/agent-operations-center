# Output Format — Competitive Moat Assessment

Strict format yang harus diikuti `assess.sh` output.

## Filename

`outputs/YYYY-MM-DD-competitive-moat-{slug}.md`

`slug` = lowercase product name, hyphenated.

## Required sections (in order)

1. **H1 title** — `# Competitive Moat Assessment — {Product}`
2. **Summary block**:
   - `**Date:**`
   - `**Author:**` — Biz Analyst (#7)
   - `**Defensibility Score:**` — `X / 10`
3. **Executive summary** — 5 bullets (product, strongest, weakest, overall, top rec)
4. **Competitor landscape** — table with type, market share, key strength
5. **Moat inventory** — table covering all 6 moat types. Each row: Applies? | Strength (/10) | Evidence | Trend
6. **Attack scenarios** — 1 section per competitor (min 3). Each: how attack, our defense, vulnerability, risk level
7. **Defensibility Score Rubric** — 5-tier rubric (9-10 to 1-2)
8. **Moat trajectory** — 3-row table (now, 1yr, 3yr) with projected score + driver
9. **Strengthening recommendations** — min 3, tagged [High/Medium/Low Impact]
10. **Decision** — Strong / Moderate / Weak + rationale + conditions
11. **Sign-off** — PM Lead + Strategy Team checkboxes

## Moat Types (standard 6)

| Type | Key Question |
|---|---|
| Network Effects | Does product value increase with more users? |
| Switching Costs | How painful is it to leave? (data, integration, habit) |
| Cost Advantages | Do we have structural cost edge? (scale, tech) |
| Intangible Assets | IP, brand, regulatory, proprietary data? |
| Efficient Scale | Is market too small for 2nd entrant to profit? |
| Counter-Positioning | Can incumbent copy without self-cannibalization? |

## Anti-pattern

- ❌ Moat claim tanpa evidence
- ❌ "First mover" listed as moat type
- ❌ Skip attack scenarios — strength is relative to attacker
- ❌ Static score tanpa trajectory
- ❌ Less than 3 competitors assessed
- ❌ Strength rating tanpa rubric reference
