# Output Format — PA Metrics Report

## Filename

`outputs/YYYY-MM-DD-pa-metrics-{feature-slug}.md`

## Required sections (in order)

1. **H1** — `# PA Metrics Report: {Feature}`
2. **Header** — Date, Window, Baseline, Segments, Sources used, Status
3. **Executive Summary** — 2-3 sentences ending with rec
4. **Retention** (Value pillar) — table
5. **Engagement** (Value + Usability) — table
6. **Error Rates** (Feasibility + Usability) — table
7. **Usability Proxies** (Usability) — table
8. **Outliers / Segment Breakdown** — kalau applicable
9. **Risk Tagging Summary** — pillar × V/U/F/B grid
10. **Critical Findings** — list (or "none")
11. **Recommendation** — Keep / Improve / Kill candidate / Trigger pa-adaptive-loop
12. **Next Step** — checklist
13. **Sign-off** — PA Lead

## Cell format conventions

Per metric row:
- **Baseline & Current**: numeric value with unit (e.g. `12.4%`, `840ms`, `1240 users/day`)
- **Δ (delta)**: `+12%` / `-8%` (always with sign)
- **Severity**: literally `noise` | `warning` | `critical`
- **Source**: one of:
 - URL (Datadog, Mixpanel report)
 - Query ref (`outputs/raw/YYYY-MM-DD-feature/internal-helpdesk.json`)
 - Internal: `Odoo helpdesk` + ticket id range

## Severity coloring (when rendered)

UI / consumer should color severity column:
- `noise` → gray
- `warning` → amber/yellow
- `critical` → red

## Status lifecycle

- `draft` — placeholders unfilled
- `ready` — all values filled, awaiting PA Lead review
- `signed-off` — PA Lead approved, can dispatch downstream

## Anti-pattern

- ❌ Status `ready` dengan value `_[fill]_` masih ada
- ❌ Severity berbeda dari rule (Δ > 30% but tagged `warning` instead of `critical`)
- ❌ Source kolom kosong — tracking gak bisa
- ❌ Baseline = "N/A" tanpa flag explicit
- ❌ Skip rationale di Recommendation — keputusan gak audit-trail
