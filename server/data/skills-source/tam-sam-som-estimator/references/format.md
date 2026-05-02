# Output Format — TAM/SAM/SOM Estimation

Strict format yang harus diikuti `estimate.sh` output.

## Filename

`outputs/YYYY-MM-DD-tam-sam-som-{slug}.md`

## Required sections (in order)

1. **H1 title** — `# TAM/SAM/SOM — {Market Definition}`
2. **Summary block** — Date, Author, Geography, Horizon, ARPU, CAGR
3. **Executive summary** — table with Low/Likely/High/Confidence per TAM/SAM/SOM
4. **Market definition** — Category, Geography, Buyer Persona, Exclusions
5. **Top-down estimation** — layered table: global → regional → country → segment → TAM
6. **Bottom-up estimation** — addressable companies × ARPU table
7. **Cross-validation** — top-down vs bottom-up comparison + reconciliation
8. **Growth projection** — yearly SOM with CAGR
9. **Confidence assessment** — 🟢🟡🔴 per estimate with rationale
10. **Data sources** — numbered list with full citations
11. **Sign-off** — PM Lead + Finance checkboxes

## Confidence Tags

| Tag | Meaning | Evidence Level |
|---|---|---|
| 🟢 High | Data-backed from credible source | Published research, govt data |
| 🟡 Medium | Comparable or interview-based | Analogous company, n≥10 interviews |
| 🔴 Low | Educated guess / assumption | No direct evidence, must sensitivity-test |

## Cross-validation Rules

- Delta < 30%: average the two estimates
- Delta > 30%: investigate discrepancy, disclose which is more reliable
- Always show both methods — single-method = auto-reject

## Anti-pattern

- ❌ Top-down only (no bottom-up grounding)
- ❌ SOM > 5% of TAM in Y1 without strong evidence
- ❌ Numbers without source citation
- ❌ Single-point estimate (no range)
- ❌ CAGR without credible source
- ❌ Mixed currencies without explicit conversion
