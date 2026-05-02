# Output Format — Parsed FSD JSON

## Output file

`outputs/parsed/{fsd-basename}.json`

## Schema

```json
{
  "meta": {
    "feature": "discount-line",
    "date": "2026-04-25",
    "status": "approved",
    "mode": "odoo",
    "target-version": "odoo-17",
    "ship-as": "module",
    "prdLink": "outputs/...md",
    "feasibilityLink": "outputs/...md"
  },
  "sections": {
    "1_architecture_overview": { "title": "...", "lineStart": 22, "lineEnd": 48 },
    "2_data_model": { ... },
    "3_api_contracts": { ... },
    "4_views": { ... },
    "5_security": { ... },
    "6_error_handling": { ... },
    "7_observability": { ... },
    "8_rollout": { ... },
    "9_story_mapping": { ... }
  },
  "stories": [
    {
      "id": "S1",
      "text": "As a sales rep, can apply discount fixed/percent",
      "fsdSections": ["§2", "§4", "§5"],
      "notes": ""
    }
  ],
  "validation": {
    "passed": true,
    "errors": [],
    "warnings": [
      { "code": "NO_FEASIBILITY_LINK", "message": "FSD missing Feasibility Brief link" }
    ]
  }
}
```

## Validation codes

### Hard errors (exit 2)

- `MISSING_HEADER` — no YAML block
- `MISSING_MODE` / `INVALID_MODE` — mode field
- `MISSING_TARGET_VERSION`
- `MISSING_SHIP_AS`
- `MISSING_STATUS` / `INVALID_STATUS`
- `MISSING_SECTION` — any of §1-§9 absent
- `MISSING_STORY_MAPPING` — §9 absent
- `ORPHAN_STORY` — story without FSD section citation
- `API_FREEFORM` — §3 has prose only, no OpenAPI/api-contract reference

### Warnings (exit 0)

- `NO_PRD_LINK`
- `NO_FEASIBILITY_LINK`
- `VAGUE_ACCEPTANCE` — measurable claim missing threshold
- `NO_ARCH_DIAGRAM` — no dot/graphviz diagram
- `THIN_ROLLOUT` — fewer than 3 rollout phases
- `NO_TEST_PLAN` — no QA bridge section

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Validation passed (may have warnings) |
| 1 | Script error (missing args, file not found) |
| 2 | Validation failed (hard errors present) |

## Anti-pattern

- ❌ Skip validation, dispatch downstream regardless
- ❌ Treat warnings as blocking errors (over-strict)
- ❌ Treat hard errors as warnings (under-strict)
- ❌ Cache parsed JSON without invalidation on FSD update
- ❌ Parse free-form prose with regex tricks — return `API_FREEFORM` instead
