# Output Format — Hypothesis Document

## Filename

`outputs/YYYY-MM-DD-hypothesis-{topic-slug}.md`

## Required sections (in order)

1. **H1** — `# Hypothesis: {Topic}`
2. **Header block** — Date, Status (draft|approved|invalidated|validated)
3. **Statement** (blockquote, canonical format):
 > Kami percaya [IV] akan menghasilkan [DV terukur] untuk [segment].
 > Kami akan tahu berhasil ketika [metric] mencapai [threshold] dalam [timeframe].
4. **Falsification** — counter-conditions
5. **Variables** — IV / DV table + Confounders bullet list
6. **Underlying Assumptions** — numbered list, riskiest marked **[RISKY]**
7. **Validation Plan** — phases table
8. **Sign-off** — CPO + EM checklist

## Status lifecycle

- `draft` → `approved` (CPO sign-off) → `validated` | `invalidated`
- Update Status field in-place as state changes; keep change log in commit history.

## Multi-hypothesis Output (alternative ideation)

For step 4 multi-solution ideation, use:

```
# Multi-Solution Ideation: {Problem}

| Hypothesis ID | IV | Primary DV | Threshold | Risk Level |
|---|---|---|---|---|
| H1 | one-click checkout | conversion | 3.2% | Medium |
| H2 | guest checkout | conversion | 3.0% | Low |
| H3 | apple pay button | conversion | 2.9% | Low |

## H1 — One-click Checkout
{full hypothesis structure}

## H2 — Guest Checkout
{full hypothesis structure}

## H3 — Apple Pay
{full hypothesis structure}

## Comparative Analysis

| Criterion | H1 | H2 | H3 |
|---|---|---|---|
| Reach | 5000 | 8000 | 3000 |
| Effort (weeks) | 4 | 2 | 3 |
| Confidence | 70% | 85% | 60% |

## Recommendation
{which to pursue first, why}
```

## Anti-pattern

- ❌ Statement tanpa quantifiable threshold
- ❌ Falsification = "if it doesn't work" (vague — quantify)
- ❌ Skip riskiest marking
- ❌ Status `draft` selamanya — update saat eksperimen jalan
