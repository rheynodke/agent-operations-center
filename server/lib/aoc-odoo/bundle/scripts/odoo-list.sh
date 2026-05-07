#!/usr/bin/env bash
# odoo-list.sh — list odoocli connections ASSIGNED to this agent.
#
# Output: JSON array on stdout. When the agent has no odoocli connection
# assigned, prints `[]` and emits a clear "no odoocli connection assigned"
# message to stderr with exit code 0 — so you can `if [ "$(odoo-list.sh)"
# = "[]" ]; then ...` cleanly.
#
# DO NOT keep retrying odoo.sh when this returns []. Stop and ask the user
# to assign an odoocli-typed connection via the agent's Connections tab.

set -euo pipefail

[ -f "${HOME}/.openclaw/.aoc_env" ] && source "${HOME}/.openclaw/.aoc_env" 2>/dev/null || true
[ -f "$PWD/.aoc_agent_env" ] && source "$PWD/.aoc_agent_env" 2>/dev/null || true
[ -f "${OPENCLAW_WORKSPACE:-.}/.aoc_agent_env" ] && source "${OPENCLAW_WORKSPACE:-.}/.aoc_agent_env" 2>/dev/null || true

AOC_URL_VAL="${AOC_URL:-http://localhost:18800}"
TOKEN="${AOC_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  echo "[odoo-list.sh] AOC_TOKEN not set. Source .aoc_agent_env first." >&2
  exit 78
fi
if [ -z "${AOC_AGENT_ID:-}" ]; then
  echo "[odoo-list.sh] AOC_AGENT_ID not set. Cannot resolve which agent's connections to list." >&2
  exit 78
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "[odoo-list.sh] jq is required (brew install jq / apt-get install jq)." >&2
  exit 72
fi

# url_encode: keep agentId safe for query string (slugs may contain non-alnum).
url_encode() {
  local s="$1" out="" c
  local i
  for ((i=0; i<${#s}; i++)); do
    c="${s:i:1}"
    case "$c" in
      [a-zA-Z0-9._~-]) out+="$c" ;;
      *) out+=$(printf '%%%02X' "'$c") ;;
    esac
  done
  printf '%s' "$out"
}

ENDPOINT="${AOC_URL_VAL%/}/api/agent/connections?agentId=$(url_encode "$AOC_AGENT_ID")"

RESP=$(curl -sf --max-time 10 -H "Authorization: Bearer ${TOKEN}" "$ENDPOINT" || true)
if [ -z "$RESP" ]; then
  echo "[odoo-list.sh] failed to reach $ENDPOINT" >&2
  exit 69
fi

# /api/agent/connections returns { connections: [{name, type, ...}] } where
# odoocli entries carry hint/odoocli fields. Project to a stable shape.
ODOO=$(echo "$RESP" | jq '[.connections[]? | select(.type == "odoocli") | {name, type, hint}]')
COUNT=$(echo "$ODOO" | jq 'length')

if [ "$COUNT" = "0" ]; then
  cat >&2 <<'EOF'
[odoo-list.sh] no odoocli connection is assigned to this agent.
              STOP. Do not keep trying odoo.sh — it will keep failing.
              Ask the user to assign an odoocli-typed connection via:
                AOC dashboard → Agents → <this agent> → Connections tab.
EOF
fi

echo "$ODOO"
