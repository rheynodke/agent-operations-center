# Output Format — UX Insight Memo

## Filename

`outputs/YYYY-MM-DD-ux-insights-{topic-slug}.md`

## Required sections (in order)

1. **H1** — `# UX Insights: {Topic}`
2. **Header** — Date, Status, Research Question, Sample size (with low-confidence flag if n<5)
3. **Executive Summary** — 5-7 bullets
4. **Method** — table (participants count, recruitment, format, duration, recording)
5. **Participants** — anonymized table (ID, segment, key context)
6. **Themes** — minimum 2 themes; each with: affinity rationale, ≥2 supporting evidence, insight (What/Why/Implication)
7. **Hierarchical Insights** — summary table (theme → insight → implication)
8. **Recommendations** — 4 categories (Design Actions, Hypotheses to Test, Further Research, Stop/Deprecate)
9. **Open Questions** — gaps that this round can't answer
10. **Sign-off** — UX Lead + PM Owner

## Theme name conventions

✅ Good: tension or behavior-specific
- "Users want speed but distrust auto-fill"
- "Discount field discoverable only after frustration"

❌ Bad: generic category
- "User Experience"
- "Pain Points"

## Evidence rules

- Quotes WAJIB attributed (P_id format, e.g. P3, P7)
- Observations WAJIB include count (e.g. "6/9 sessions show...")
- Single-quote insight = anekdot, NOT insight
- Mix of quotes + observations is preferred over single-source

## Confidence rules

- n ≥ 5: theme saturation acceptable
- n < 5: flag at top, treat themes as directional only
- n ≥ 12: high confidence for B2C; B2B may still need more

## Anti-pattern

- ❌ Verbatim transcript dump
- ❌ Generic theme names
- ❌ Single-quote insight
- ❌ Recommendation "improve UX" tanpa specific action
- ❌ Mix observation + interpretation
- ❌ Skip Open Questions
- ❌ n<5 tanpa low-confidence flag
- ❌ Memo > 5 pages — sintesis = compression
