# Output Format — ADR

## Filename

`docs/adrs/ADR-{NNN}-{slug}.md`

- `NNN` = sequential, zero-padded 3 digits (`001`, `010`, `123`)
- `slug` = lowercase, hyphenated, descriptive (`use-postgres-for-orders`, `replace-mongo-with-pg`)

## Required sections

1. **H1** — `# ADR-{NNN}: {Title}`
2. **Header** — Status, Date, Authors, Reviewers
3. **Context** — 1-2 paragraphs (problem, constraints, trigger)
4. **Decision Drivers** — 4-6 numbered criteria
5. **Considered Options** — 2-4 alternatives, each with description + Pros/Cons
6. **Trade-off Matrix** — table (criterion × option) with scores 1-5 + rationale per cell
7. **Decision Outcome** — Chosen option + 3-bullet rationale
8. **Consequences** — Positive, **Negative (mandatory ≥1)**, Neutral
9. **Validation / Exit Criteria** — when to revisit
10. **Sign-off** — CTO + Senior EM
11. **Change Log** — date + author + change

## Status values (strict)

- `proposed` — drafting, awaiting review
- `accepted` — approved, in effect
- `rejected` — considered, declined
- `deprecated` — was accepted, no longer recommended (but legacy code may still use)
- `superseded by ADR-NNN` — replaced by newer ADR

## Score values

1-5 integer scale (5 = best fit for this driver). Decimal scores not allowed (forces clarity).

## Mandatory rules

1. ≥1 entry in "Negative" consequences — every decision has trade-offs
2. ADR sequential numbers never reused
3. Accepted ADR never edited — create new ADR with `superseded by` if changing
4. CTO sign-off required if ADR touches: data layer, security, cost > $500/month, vendor lock-in

## Anti-pattern

- ❌ Single option ADR — sekedar dokumentasi, bukan decision
- ❌ Negative consequences kosong — selalu ada trade-off
- ❌ Score override tanpa rationale eksplisit di Decision Outcome
- ❌ Edit accepted ADR — bikin ADR baru
- ❌ Drivers terlalu generic ("must be fast, must be scalable")
- ❌ Skip Validation / Exit — ADR tanpa exit criteria = unfalsifiable decision
