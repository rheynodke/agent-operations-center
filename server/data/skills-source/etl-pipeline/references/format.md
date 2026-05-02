# Output Format — ETL Pipeline Report

Strict format yang harus diikuti `pipeline.sh --report` output.

## Filename

`outputs/YYYY-MM-DD-etl-{slug}.md`

Extract files: `outputs/data/YYYY-MM-DD-etl-{slug}-src{N}.csv`
Joined output: `outputs/data/YYYY-MM-DD-etl-{slug}-joined.csv`

## Required sections (in order)

1. **H1 title** — `# ETL Pipeline: {Name}`
2. **Summary block** — Date, Author, Status
3. **Pipeline Definition** — table: name, sources, join key, output
4. **Stage 1: Extract** — per-source table + extract validation
5. **Stage 2: Transform** — cleaning steps + join operations + transform validation
6. **Stage 3: Load** — output file, row count, size
7. **Pipeline Log** — timestamp-ordered log of every action
8. **Error Log** — any errors or "none"
9. **Output Files** — list of all generated files

## Validation Rules (mandatory per stage)

### Extract Validation
- Row count per source
- Column count per source
- Expected vs actual comparison

### Transform Validation
- Row count before/after join (no silent data loss)
- Required columns present after transform
- Join: left count + right count + joined count + dropped count

### Load Validation
- Final row count matches transform output
- File written successfully

## Pipeline Log Format

Every action MUST be logged with:
- Timestamp (HH:MM)
- Stage (Extract / Transform / Load)
- Action (what was done)
- Result (row count, status)

## Anti-pattern

- ❌ No validation between stages
- ❌ Silent row drops during transform
- ❌ Overwrite source data
- ❌ No pipeline log — non-auditable
- ❌ Type coercion without documentation
- ❌ Missing error log section
