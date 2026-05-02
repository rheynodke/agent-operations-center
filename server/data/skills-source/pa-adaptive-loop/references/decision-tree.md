# Adaptive Loop Decision Tree (canonical reference)

Used by `pa-adaptive-loop` skill to route observability findings to action.

## Inputs

- Severity per metric: `noise` / `warning` / `critical`
- Cycle history: prior 2-3 reports for same feature
- PRD monitoring-spec (optional override on thresholds)

## Decision Rules (priority order)

```
IF any metric severity == "critical"
 AND 7-day trend confirmed (or fail-safe critical e.g. >50% drop)
 THEN
 generate ≥2 hypotheses
 IF kill criteria met (3+ cycles decline, no improve post-action,
 or strategic re-prioritization signal)
 DECIDE = "kill candidate" → escalate to PM with rec
 ELSE
 DECIDE = "re-discovery" → re-discovery-trigger skill → PM Discovery #1

ELSE IF warnings present in 3+ consecutive cycles (multi-cycle persistence)
 AND no critical
 THEN
 DECIDE = "improve" → task tag `improve` to owning team

ELSE IF warnings present but <3 cycles
 THEN
 DECIDE = "noise" (watch list) → log + schedule next iteration

ELSE (all metrics noise)
 DECIDE = "noise" (healthy) → log + schedule next iteration
```

## Threshold defaults

| Severity | Δ from baseline |
|---|---|
| noise | < ±15% |
| warning | ±15% to ±30% |
| critical | > ±30% |

PRD `monitoring-spec` block can override per-metric.

## Fail-safe critical override

Skip 7-day trend confirmation jika:
- > 50% drop on any metric
- Infrastructure outage signal (errors > 100/sec sustained)
- User-reported P0 (support escalation linked)

These bypass loop and trigger immediate `re-discovery-trigger` + alert oncall.

## Cadences

| Cadence | Default scope | Trend window |
|---|---|---|
| daily quick-check | error rate spike only | 1d vs prior 1d |
| weekly health | per feature | 7d vs prior 7d |
| monthly composite | cross-feature | 28d vs prior 28d |
| quarterly review | strategic re-score | 90d vs same Q last year |

## Task tag conventions (audit trail)

Every loop run logs a `aoc-tasks` entry with:
- `monitoring` (always)
- `feature:{slug}`
- `outcome:noise` | `outcome:improve` | `outcome:re-discovery` | `outcome:kill`
- `severity:max=critical|warning|none`

PM agent can query: `check_tasks --tag re-discovery --status open` → see the queue from PA.

## Anti-pattern

- ❌ Override 7-day rule without fail-safe condition — false positive will exhaust PM
- ❌ Same metric flagged critical 3+ cycles tanpa kill candidate consideration
- ❌ `outcome:re-discovery` tanpa hypotheses bundled di evidence package
- ❌ Skip task log — breaks audit trail; future PA can't reconstruct decision history
