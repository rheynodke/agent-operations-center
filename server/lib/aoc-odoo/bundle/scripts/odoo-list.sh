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
# PWD wins over OPENCLAW_WORKSPACE: a leaked OPENCLAW_WORKSPACE from a parent
# shell pointing at a different agent's workspace would otherwise silently
# overwrite this agent's AOC_AGENT_ID/AOC_TOKEN with another agent's identity.
if [ -f "$PWD/.aoc_agent_env" ]; then
  source "$PWD/.aoc_agent_env" 2>/dev/null || true
elif [ -n "${OPENCLAW_WORKSPACE:-}" ] && [ -f "${OPENCLAW_WORKSPACE}/.aoc_agent_env" ]; then
  source "${OPENCLAW_WORKSPACE}/.aoc_agent_env" 2>/dev/null || true
fi

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

# Retry on transient AOC server instability (gateway-ws reconnect storms,
# pm2 restart windows, partial DB/cache state). Three attempts total with
# exponential backoff. On every attempt we re-source the agent env in case
# the AOC server regenerated `.aoc_agent_env` mid-flight (a fresh per-agent
# JWT can replace a stale dashboard token leaked from `.aoc_env`).
fetch_with_retry() {
  local attempt=0 max=3 delay=0 resp http_code
  while [ "$attempt" -lt "$max" ]; do
    if [ "$delay" -gt 0 ]; then sleep "$delay"; fi
    # Re-source env on retries so we always pick up the latest token.
    if [ "$attempt" -gt 0 ]; then
      [ -f "${HOME}/.openclaw/.aoc_env" ] && . "${HOME}/.openclaw/.aoc_env" 2>/dev/null || true
      if [ -f "$PWD/.aoc_agent_env" ]; then
        . "$PWD/.aoc_agent_env" 2>/dev/null || true
      elif [ -n "${OPENCLAW_WORKSPACE:-}" ] && [ -f "${OPENCLAW_WORKSPACE}/.aoc_agent_env" ]; then
        . "${OPENCLAW_WORKSPACE}/.aoc_agent_env" 2>/dev/null || true
      fi
      TOKEN="${AOC_TOKEN:-$TOKEN}"
    fi
    # -w '\n%{http_code}' splits body and status; -s silent, -m timeout.
    resp=$(curl -s -m 10 -w '\n%{http_code}' \
      -H "Authorization: Bearer ${TOKEN}" "$ENDPOINT" 2>/dev/null || printf '\n000')
    http_code="${resp##*$'\n'}"
    body="${resp%$'\n'*}"
    case "$http_code" in
      200|201)
        # Refuse responses that are not parseable JSON or lack `connections`.
        if echo "$body" | jq -e '.connections' >/dev/null 2>&1; then
          printf '%s' "$body"; return 0
        fi
        echo "[odoo-list.sh] attempt $((attempt+1))/$max: 200 but malformed body" >&2
        ;;
      401|403)
        echo "[odoo-list.sh] auth failed (HTTP $http_code) — token rejected. Not retrying." >&2
        return 78
        ;;
      000)
        echo "[odoo-list.sh] attempt $((attempt+1))/$max: network/connection failure" >&2
        ;;
      *)
        echo "[odoo-list.sh] attempt $((attempt+1))/$max: HTTP $http_code" >&2
        ;;
    esac
    attempt=$((attempt + 1))
    # Backoff: 0s, 1s, 3s (cumulative ≤4s before final failure).
    delay=$([ "$attempt" -eq 1 ] && echo 1 || echo 3)
  done
  echo "[odoo-list.sh] failed to reach $ENDPOINT after $max attempts" >&2
  return 69
}

RESP=$(fetch_with_retry)
RC=$?
if [ "$RC" -ne 0 ]; then exit "$RC"; fi
if [ -z "$RESP" ]; then
  echo "[odoo-list.sh] empty response body" >&2
  exit 69
fi

# /api/agent/connections returns { connections: [{name, type, ...}] } where
# odoocli entries carry hint/odoocli fields. Project to a stable shape.
ODOO=$(echo "$RESP" | jq '[.connections[]? | select(.type == "odoocli") | {name, type, hint, description, odooUrl, odooDb, odooUsername}]')
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
