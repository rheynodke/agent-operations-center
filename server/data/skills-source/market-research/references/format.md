# Output Format — Market Research Brief

## Filename

`outputs/YYYY-MM-DD-market-research-{topic-slug}.md`

## Required sections (in order)

1. **H1** — `# Market Research: {Topic}`
2. **Header block** — Date, Status (`draft|ready|approved`), Primary Question
3. **Executive Summary** — 2-3 sentences ending with recommendation
4. **Research Questions** — numbered atomic Qs (3-5)
5. **Sources Consulted** — min 3, table with channel + tool + URL refs
6. **Problem Prevalence** — bullet findings with source per claim
7. **Target Segments** — table (segment, size, pain, source)
8. **Competitive Landscape** — table (3-7 competitors) + Gap Analysis subsection
9. **Demand Signals** — quantified table (signal, volume, channel, citation)
10. **Risk Tagging Matrix** — finding × V/U/F/B grid
11. **Recommendation** — PROCEED | PIVOT | DROP + 3-bullet sourced rationale
12. **Next Step** — checklist (which downstream skill to dispatch)
13. **Sign-off** — PM Lead checkbox

## Status lifecycle

- `draft` — placeholders unfilled
- `ready` — all sections filled, awaiting PM Lead review
- `approved` — sign-off done, ready to dispatch to `hypothesis-generator` (if PROCEED)

## Source citation format

Every claim → cite. 3 acceptable formats:

1. **URL inline**: `15% YoY growth ([Statista 2026](https://statista.com/...))`
2. **Quote with attribution**: `"X" — User in r/SmallBusinessIndonesia, 2026-04-12`
3. **Internal ref**: `helpdesk pull, 2026-05-01, query saved at outputs/raw/.../internal-helpdesk.json`

## Anti-pattern

- ❌ Status `ready` dengan placeholder `_[fill]_` masih ada
- ❌ Single-source claim dengan confidence > 70%
- ❌ Competitive matrix < 3 rows
- ❌ Recommendation tanpa 3-bullet rationale, atau bullet tanpa source
- ❌ Demand Signal qualitatif tanpa angka
