#!/bin/bash
# API Contract — scaffold OpenAPI 3.1 YAML (REST) or Odoo XML-RPC spec.
#
# Usage:
#   ./contract.sh --feature "<slug>" --style openapi|odoo-rpc [--output PATH]

set -euo pipefail

FEATURE=""
STYLE=""
OUTPUT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --feature) FEATURE="$2"; shift 2;;
    --style)   STYLE="$2"; shift 2;;
    --output)  OUTPUT="$2"; shift 2;;
    -h|--help) grep '^#' "$0" | sed 's/^# \?//'; exit 0;;
    *) echo "Unknown arg: $1"; exit 1;;
  esac
done

[ -z "$FEATURE" ] && { echo "ERROR: --feature required"; exit 1; }
[ -z "$STYLE" ] && { echo "ERROR: --style required (openapi|odoo-rpc)"; exit 1; }

DATE=$(date +%Y-%m-%d)

if [ "$STYLE" = "openapi" ]; then
  [ -z "$OUTPUT" ] && OUTPUT="outputs/${DATE}-api-contract-${FEATURE}.yaml"
  mkdir -p "$(dirname "$OUTPUT")"

  cat > "$OUTPUT" <<EOF
openapi: 3.1.0
info:
  title: ${FEATURE} API
  version: 1.0.0
  description: |
    _[fill: 1-2 sentence purpose]_

servers:
  - url: https://api.example.com
    description: Production
  - url: https://staging-api.example.com
    description: Staging

tags:
  - name: ${FEATURE}
    description: _[fill]_

security:
  - bearerAuth: []

paths:
  /v1/${FEATURE}:
    get:
      operationId: list${FEATURE^}
      summary: _[fill]_
      tags: [${FEATURE}]
      parameters:
        - name: limit
          in: query
          schema: { type: integer, default: 20, maximum: 100 }
        - name: cursor
          in: query
          schema: { type: string }
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                required: [items]
                properties:
                  items:
                    type: array
                    items: { \$ref: '#/components/schemas/${FEATURE^}' }
                  next_cursor: { type: string, nullable: true }
        '403':
          \$ref: '#/components/responses/Forbidden'

    post:
      operationId: create${FEATURE^}
      summary: _[fill]_
      tags: [${FEATURE}]
      parameters:
        - name: Idempotency-Key
          in: header
          required: false
          schema: { type: string, format: uuid }
          description: Recommended for retry-safe creation
      requestBody:
        required: true
        content:
          application/json:
            schema: { \$ref: '#/components/schemas/Create${FEATURE^}Request' }
      responses:
        '201':
          description: Created
          content:
            application/json:
              schema: { \$ref: '#/components/schemas/${FEATURE^}' }
        '400':
          \$ref: '#/components/responses/Validation'
        '403':
          \$ref: '#/components/responses/Forbidden'
        '409':
          \$ref: '#/components/responses/Conflict'

components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT

  schemas:
    Error:
      type: object
      required: [code, message]
      properties:
        code:
          type: string
          description: Machine-readable error code (SCREAMING_SNAKE_CASE)
          example: VALIDATION_FAILED
        message:
          type: string
          description: Human-readable, may be shown to user
        details:
          type: array
          items:
            type: object
            properties:
              field: { type: string }
              issue: { type: string }
        request_id:
          type: string

    Create${FEATURE^}Request:
      type: object
      required: [_[fill]_]
      properties:
        _[field_name]_:
          type: _[string|integer|number|boolean]_
          example: _[example value]_

    ${FEATURE^}:
      allOf:
        - \$ref: '#/components/schemas/Create${FEATURE^}Request'
        - type: object
          required: [id, created_at]
          properties:
            id: { type: integer, example: 42 }
            created_at: { type: string, format: date-time }

  responses:
    Validation:
      description: Validation error
      content:
        application/json:
          schema: { \$ref: '#/components/schemas/Error' }
          example:
            code: VALIDATION_FAILED
            message: _[example validation message]_
            details:
              - field: _[field]_
                issue: must be _[constraint]_
    Forbidden:
      description: Forbidden
      content:
        application/json:
          schema: { \$ref: '#/components/schemas/Error' }
          example:
            code: FORBIDDEN
            message: Insufficient permissions
    Conflict:
      description: Idempotency conflict (duplicate request)
      content:
        application/json:
          schema: { \$ref: '#/components/schemas/Error' }

x-rate-limit:
  per-user: 100/minute
  per-ip: 200/minute
  burst: 20
EOF

elif [ "$STYLE" = "odoo-rpc" ]; then
  [ -z "$OUTPUT" ] && OUTPUT="outputs/${DATE}-api-contract-${FEATURE}-odoo-rpc.md"
  mkdir -p "$(dirname "$OUTPUT")"

  cat > "$OUTPUT" <<EOF
# Odoo XML-RPC Contract: ${FEATURE}

**Date:** ${DATE}
**Version:** 1.0.0
**Status:** draft

## Authentication

\`\`\`python
session_authenticate(db, login, password) -> uid
\`\`\`

Subsequent calls:

\`\`\`python
execute_kw(db, uid, password, model, method, args, kwargs={})
\`\`\`

## Error Envelope (uniform)

\`\`\`python
# Custom UserError raised in Python:
raise UserError(_(
    "VALIDATION_FAILED: discount value must be positive"
))
# Frontend receives:
{
  "error": {
    "code": 200,
    "message": "VALIDATION_FAILED: discount value must be positive",
    "data": { "name": "odoo.exceptions.UserError", ... }
  }
}
\`\`\`

Convention: prefix message dengan ERROR_CODE in SCREAMING_SNAKE_CASE.

## Methods

### \`<model>.create\`

\`\`\`python
@api.model
def create(self, vals: dict) -> 'sale.order.discount.line':
    """Create a discount line.

    Args:
        vals: dict with keys:
            - order_id (int, required): target order
            - type (str, required): 'percent' | 'fixed'
            - value (float, required): positive

    Returns:
        Newly created record (browse).

    Raises:
        UserError: VALIDATION_FAILED if value <= 0 or type invalid
        AccessError: FORBIDDEN if user lacks discount.create permission
    """
\`\`\`

**Example call:**
\`\`\`python
discount_id = models.execute_kw(
    db, uid, password,
    'sale.order.discount.line', 'create',
    [{
        'order_id': 12345,
        'type': 'percent',
        'value': 15.0,
    }]
)
# Returns: 42 (new id)
\`\`\`

### \`<model>.write\`

_[same shape: signature, args, returns, raises, example]_

### \`<model>.unlink\`

_[same shape]_

### Custom action: \`apply_discount\`

\`\`\`python
def apply_discount(self, order_id: int) -> dict:
    """Apply this discount to the target order.

    Returns:
        {'success': bool, 'amount': float, 'order_total': float}

    Raises:
        UserError: ALREADY_APPLIED if order has active discount
    """
\`\`\`

## Idempotency

| Method | Idempotent? | Notes |
|---|---|---|
| \`create\` | NO | Caller must dedup, atau pakai unique constraint |
| \`write\` | YES | Replace semantic |
| \`unlink\` | YES | Deleting deleted = silent no-op |
| \`apply_discount\` | NO | Server checks ALREADY_APPLIED |

## Access Rights

Sesuai \`ir.model.access.csv\`:
- \`group_sale_salesman\`: read, write, create
- \`group_sale_manager\`: + unlink
- \`group_user\`: read only

## Sign-off

- [ ] EM Review — _Name, Date_
- [ ] Backend SWE Review — _Name, Date_
EOF

else
  echo "ERROR: --style must be 'openapi' or 'odoo-rpc'"
  exit 1
fi

echo "Wrote: $OUTPUT"
echo "Style: $STYLE"
echo ""
echo "Next: agent must fill placeholders. Validate via swagger-cli or online editor."
