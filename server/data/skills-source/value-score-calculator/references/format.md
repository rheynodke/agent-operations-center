# Output Format — Value Score Document

Strict format yang harus diikuti `score.sh` dan PRD embedded blocks.

## Filename

`outputs/YYYY-MM-DD-value-score-{slug}.md`

`slug` = lowercase feature name, hyphenated.

## Required sections (in order)

1. **H1 title** — `# Value Score: {Feature Name}`
2. **Summary block**:
 - `**Date:**`
 - `**Framework:**` — RICE | ICE | WSJF
 - `**Composite Score:**` — `N / 100`
 - `**Recommendation:**` — PROCEED | DEFER | REJECT
 - Optional `⚠️ HIGH RISK` line jika pessimistic < 40
3. **Inputs** — table with Value + Source columns. Source column WAJIB diisi (no `_[fill]_` placeholder di final).
4. **ADLC Multipliers** — table with rationale per multiplier.
5. **Calculation** — Base, × Multipliers, Normalized.
6. **Sensitivity** — 3-row table (base, optimistic, pessimistic).
7. **Recommendation Rationale** — prose, 100-300 words. Include:
 - Top 2 risks
 - Alternative options considered
 - Why chosen rec is right
8. **Sign-off** — checkbox CPO Approval.

## Mandatory in every PRD

PRD output wajib include block ini di section 6:

```markdown
## Value Score (mandatory)

- **Score:** {N} / 100 → **{REC}**
- **Framework:** {FW}
- **Sensitivity:** base={N1}, optimistic={N2}, pessimistic={N3}
- **Detailed scoring:** [link ke outputs/...md]
- **CPO Sign-off:** {Name, Date} | _pending_
```

## Anti-pattern

- ❌ Score tanpa link ke detailed sheet
- ❌ Source column berisi placeholder
- ❌ Sensitivity row di-skip
- ❌ Pessimistic < 40 tanpa HIGH RISK warning
