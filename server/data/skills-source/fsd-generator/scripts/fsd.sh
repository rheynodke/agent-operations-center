#!/bin/bash
# FSD Generator — scaffold a Functional Spec Document.
#
# Usage:
#   ./fsd.sh --feature "<slug>" --mode odoo|frontend [--output PATH]
#            [--prd-link PATH] [--feasibility-link PATH]

set -euo pipefail

FEATURE=""
MODE=""
PRD_LINK=""
FEAS_LINK=""
OUTPUT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --feature)           FEATURE="$2"; shift 2;;
    --mode)              MODE="$2"; shift 2;;
    --prd-link)          PRD_LINK="$2"; shift 2;;
    --feasibility-link)  FEAS_LINK="$2"; shift 2;;
    --output)            OUTPUT="$2"; shift 2;;
    -h|--help)           grep '^#' "$0" | sed 's/^# \?//'; exit 0;;
    *) echo "Unknown arg: $1"; exit 1;;
  esac
done

[ -z "$FEATURE" ] && { echo "ERROR: --feature required"; exit 1; }
[ -z "$MODE" ] && { echo "ERROR: --mode required (odoo|frontend)"; exit 1; }
[ "$MODE" != "odoo" ] && [ "$MODE" != "frontend" ] && { echo "ERROR: --mode must be 'odoo' or 'frontend'"; exit 1; }

DATE=$(date +%Y-%m-%d)
[ -z "$OUTPUT" ] && OUTPUT="outputs/${DATE}-fsd-${FEATURE}.md"
mkdir -p "$(dirname "$OUTPUT")"

cat > "$OUTPUT" <<EOF
# FSD: ${FEATURE}

\`\`\`yaml
mode: ${MODE}
target-version: _[fill: e.g. odoo-17, react-18]_
ship-as: _[fill: module | feature | page]_
\`\`\`

**Date:** ${DATE}
**Status:** draft — pending peer review
**PRD:** ${PRD_LINK:-_[fill: link]_}
**Feasibility Brief:** ${FEAS_LINK:-_[fill: link]_}

## §1 Architecture Overview

> _[1-paragraph narrative: data flow, sync vs async, key transforms]_

\`\`\`dot
digraph arch {
  rankdir=LR
  user [label="User"]
  fe   [label="_[fill]_"]
  api  [label="_[fill]_"]
  db   [label="_[fill]_"]
  user -> fe -> api -> db
}
\`\`\`

## §2 Data Model

EOF

if [ "$MODE" = "odoo" ]; then
cat >> "$OUTPUT" <<'EOF'
> Odoo models. Per model: fields, relations, computed, constraints.

```yaml
model: _[fill: model.name]_
fields:
  - name: _[]_
    type: _[char | text | float | many2one | one2many | selection]_
    required: _[true|false]_
constraints:
  - type: _[SQL | Python]_
    rule: _[]_
    message: _[]_
computed:
  - name: _[]_
    depends: [_[]_]
    method: _[]_
```

## §3 API Contracts

> Use `api-contract` skill. Embed output here OR link to its document.

`outputs/YYYY-MM-DD-api-contract-_[feature]_.md`

## §4 View XML

```xml
<record id="_[fill]_" model="ir.ui.view">
  <field name="name">_[fill]_</field>
  <field name="model">_[fill]_</field>
  <field name="inherit_id" ref="_[fill]_"/>
  <field name="arch" type="xml">
    <xpath expr="_[fill]_" position="_[after|before|inside|replace]_">
      <!-- changes -->
    </xpath>
  </field>
</record>
```

## §5 Security & Permissions

```csv
id,name,model_id:id,group_id:id,perm_read,perm_write,perm_create,perm_unlink
_[fill]_,_[fill]_,_[fill]_,_[fill]_,1,1,1,0
```

EOF
else
cat >> "$OUTPUT" <<'EOF'
> Frontend state shape + DB tables (if applicable).

### State shape

```typescript
interface _[FeatureName]_Store {
  // ...
}
```

### DB tables

```sql
CREATE TABLE _[fill]_ (
  id BIGSERIAL PRIMARY KEY,
  -- ...
);
```

## §3 API Contracts

> Use `api-contract` skill. Embed output here OR link to its document.

`outputs/YYYY-MM-DD-api-contract-_[feature]_.md`

## §4 Component Tree

```
<_[PageName]_>
  ├── <_[ComponentA]_ />
  ├── <_[ComponentB]_>
  │     └── <_[Sub]_ />
  └── <_[ComponentC]_ />
```

Per new component, document props/state.

## §5 Security & Permissions

- Auth requirement: _[signed-in | role-X]_
- API endpoint protection: _[JWT scopes]_
- Sensitive data masking: _[PII fields]_

EOF
fi

cat >> "$OUTPUT" <<'EOF'

## §6 Error Handling Matrix

| Source | Error type | User-facing message | Recovery |
|---|---|---|---|
| _[]_ | _[]_ | _[]_ | _[]_ |

## §7 Observability Hooks

| Event | When | Logged where | Use case |
|---|---|---|---|
| `_[event_name]_` | _[trigger]_ | _[Mixpanel/Datadog]_ | _[adoption/error tracking]_ |

## §8 Rollout Plan

| Phase | When | What | Rollback if |
|---|---|---|---|
| Internal | Week 1 | Flag = team only | Any error 24h |
| Beta | Week 2 | Flag = 10% | error rate >1% |
| GA | Week 3-4 | Flag = 100% | conversion -5% |
| Cleanup | Week 6 | Remove flag | — |

## §9 Story → Implementation Mapping

> WAJIB exhaustive — setiap user story dari PRD harus muncul di sini.

| User Story (from PRD) | FSD Section(s) | Notes |
|---|---|---|
| _[story 1]_ | _[§1, §3, §4]_ | _[]_ |
| _[story 2]_ | _[]_ | _[]_ |

## Sign-off

- [ ] Peer review (EM/Senior SWE) — _Name, Date, comments_
- [ ] PRD owner approval — _Name, Date_

## Next Step

- [ ] Hand off to SWE with task tag `ready-to-build`
- [ ] Notify QA to start test plan in parallel
- [ ] Notify Doc Writer for early user-guide drafting

EOF

echo "Wrote: $OUTPUT"
echo "Mode: $MODE"
echo "Status: draft — agent must fill placeholders + obtain peer review."
