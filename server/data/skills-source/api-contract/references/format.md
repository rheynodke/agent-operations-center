# Output Format — API Contract

## Two style outputs

### REST (OpenAPI 3.1)

Filename: `outputs/YYYY-MM-DD-api-contract-{feature}.yaml`

Required top-level:
- `openapi: 3.1.0`
- `info` block (title, version, description)
- `servers` array
- `tags` array
- `security` (default scheme)
- `paths` (all endpoints)
- `components.securitySchemes`
- `components.schemas` (request, response, Error)
- `components.responses` (reusable error responses)
- `x-rate-limit` (custom extension, per public endpoints)

### Odoo XML-RPC

Filename: `outputs/YYYY-MM-DD-api-contract-{feature}-odoo-rpc.md`

Required sections:
1. **H1** — `# Odoo XML-RPC Contract: {Feature}`
2. **Header** — Date, Version, Status
3. **Authentication** — session_authenticate signature
4. **Error Envelope** — UserError convention with prefix code
5. **Methods** — each with: signature, docstring (args/returns/raises), example call
6. **Idempotency** — table per method
7. **Access Rights** — link to `ir.model.access.csv`
8. **Sign-off**

## Required per-endpoint fields (REST)

- `operationId` — camelCase, unique
- `summary` — 1-line
- `tags` — at least 1
- `security` — declare even if inherits default
- `requestBody.content.application/json.schema` — for non-GET
- `responses` — minimum: success + 1 error variant
- `examples` — minimum 1 success + 2 error per endpoint

## Required per-method fields (Odoo)

- Method signature (Python decorator + args + return type)
- Docstring with: Args, Returns, Raises
- Example call (from external client perspective)

## Status lifecycle

- `draft` — placeholders unfilled
- `validated` — schema passes validator (swagger-cli for REST)
- `approved` — EM + senior backend SWE sign-off

## Anti-pattern

- ❌ Field tanpa example
- ❌ Endpoint tanpa error responses
- ❌ Inline schema diulang di multiple endpoints — use `$ref`
- ❌ Breaking change tanpa version bump (v1 → v2 path atau header)
- ❌ POST/PATCH/DELETE tanpa idempotency declaration
- ❌ Auth scheme assumed — explicit di security section
- ❌ Status `validated` belum dijalankan validator
