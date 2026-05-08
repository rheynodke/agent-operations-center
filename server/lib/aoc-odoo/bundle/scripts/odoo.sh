#!/usr/bin/env bash
# odoo.sh — AOC wrapper around odoocli.
# Fetches the connection's credentials from AOC, materializes a temporary
# .odoocli.toml, runs odoocli with --config pointing at it, and removes the
# temp file on exit. The connection's display name becomes the profile name.
#
# Usage:
#   odoo.sh <connection-name-or-id> <odoocli-subcommand> [args...]
#
# Examples:
#   odoo.sh dke-prod auth test
#   odoo.sh dke-prod record search sale.order --domain "[('state','=','draft')]"

set -euo pipefail

# Source AOC env (AOC_TOKEN, AOC_URL, AOC_AGENT_ID) in canonical order.
[ -f "${HOME}/.openclaw/.aoc_env" ] && source "${HOME}/.openclaw/.aoc_env" 2>/dev/null || true
[ -f "${OPENCLAW_HOME:-$HOME/.openclaw}/.aoc_env" ] && source "${OPENCLAW_HOME:-$HOME/.openclaw}/.aoc_env" 2>/dev/null || true
# PWD wins: a leaked OPENCLAW_WORKSPACE/OPENCLAW_STATE_DIR pointing at another
# agent's workspace would otherwise overwrite this agent's identity.
if [ -f "$PWD/.aoc_agent_env" ]; then
  source "$PWD/.aoc_agent_env" 2>/dev/null || true
elif [ -n "${OPENCLAW_WORKSPACE:-}" ] && [ -f "${OPENCLAW_WORKSPACE}/.aoc_agent_env" ]; then
  source "${OPENCLAW_WORKSPACE}/.aoc_agent_env" 2>/dev/null || true
elif [ -n "${OPENCLAW_STATE_DIR:-}" ] && [ -f "${OPENCLAW_STATE_DIR}/workspace/.aoc_agent_env" ]; then
  source "${OPENCLAW_STATE_DIR}/workspace/.aoc_agent_env" 2>/dev/null || true
fi

if [ $# -lt 1 ]; then
  echo "[odoo.sh] usage: odoo.sh <connection-name-or-id> <odoocli-subcommand> [args...]" >&2
  echo "         e.g.   odoo.sh dke-prod record search sale.order --limit 5" >&2
  exit 64
fi

CONN="$1"; shift

AOC_URL_VAL="${AOC_URL:-http://localhost:18800}"
TOKEN="${AOC_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  echo "[odoo.sh] AOC_TOKEN not set. Source ~/.openclaw/.aoc_env or your workspace .aoc_agent_env first." >&2
  exit 78
fi

# URL-encode (shell-only, no python dependency).
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

ENC_CONN=$(url_encode "$CONN")
ENDPOINT="${AOC_URL_VAL%/}/api/connections/${ENC_CONN}/odoo-profile"
# Agent-scope the request when AOC_AGENT_ID is known so the backend
# enforces "assigned to this agent" rather than merely "accessible to user".
if [ -n "${AOC_AGENT_ID:-}" ]; then
  ENDPOINT="${ENDPOINT}?agentId=$(url_encode "$AOC_AGENT_ID")"
fi

# Fetch the profile. Capture body + status separately.
HTTP_TMP=$(mktemp -t aoc-odoo-resp.XXXXXX)
HTTP_CODE=$(curl -sS --max-time 10 \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Accept: application/json" \
  -o "$HTTP_TMP" \
  -w '%{http_code}' \
  "$ENDPOINT" || echo "000")

case "$HTTP_CODE" in
  200) : ;;
  401|403)
    # Distinguish "not assigned" (recoverable: ask user to assign) from
    # generic auth failure (wrong token / not allowed).
    CODE=""
    if command -v jq >/dev/null 2>&1; then
      CODE=$(jq -r '.code // empty' < "$HTTP_TMP" 2>/dev/null || echo "")
    fi
    if [ "$CODE" = "CONNECTION_NOT_ASSIGNED" ]; then
      echo "[odoo.sh] connection '$CONN' is NOT assigned to this agent. Run odoo-list.sh to see what IS assigned, or ask the user to assign it via the Connections tab." >&2
    else
      echo "[odoo.sh] $HTTP_CODE — connection '$CONN' is not accessible to this agent." >&2
      cat "$HTTP_TMP" >&2; echo >&2
    fi
    rm -f "$HTTP_TMP"
    exit 77
    ;;
  404)
    echo "[odoo.sh] connection '$CONN' not found or not accessible. Run odoo-list.sh to see what's available." >&2
    rm -f "$HTTP_TMP"
    exit 78
    ;;
  400)
    echo "[odoo.sh] connection '$CONN' is not an odoocli-typed connection." >&2
    cat "$HTTP_TMP" >&2; echo >&2
    rm -f "$HTTP_TMP"
    exit 65
    ;;
  000)
    echo "[odoo.sh] cannot reach AOC at $AOC_URL_VAL — check AOC_URL and that the dashboard is running." >&2
    rm -f "$HTTP_TMP"
    exit 69
    ;;
  *)
    echo "[odoo.sh] unexpected HTTP $HTTP_CODE from $ENDPOINT" >&2
    cat "$HTTP_TMP" >&2; echo >&2
    rm -f "$HTTP_TMP"
    exit 70
    ;;
esac

# Response shape: {"profileName": "<name>", "toml": "<rendered config body>"}
if ! command -v jq >/dev/null 2>&1; then
  echo "[odoo.sh] jq is required but not installed (brew install jq / apt-get install jq)." >&2
  rm -f "$HTTP_TMP"
  exit 72
fi

PROFILE_NAME=$(jq -r '.profileName // empty' < "$HTTP_TMP")
TOML_BODY=$(jq -r '.toml // empty' < "$HTTP_TMP")
rm -f "$HTTP_TMP"

if [ -z "$PROFILE_NAME" ] || [ -z "$TOML_BODY" ]; then
  echo "[odoo.sh] backend returned an empty profile body — check AOC server logs." >&2
  exit 70
fi

# Materialize ephemeral config; cleanup on any exit path.
TMP_CFG=$(mktemp -t aoc-odoocli.XXXXXX)
chmod 600 "$TMP_CFG"
trap 'rm -f "$TMP_CFG"' EXIT INT TERM HUP
printf '%s' "$TOML_BODY" > "$TMP_CFG"

# Locate odoocli. Honor AOC_ODOOCLI_BIN override (useful for venv paths).
ODOOCLI_BIN="${AOC_ODOOCLI_BIN:-$(command -v odoocli 2>/dev/null || true)}"
if [ -z "$ODOOCLI_BIN" ] || [ ! -x "$ODOOCLI_BIN" ]; then
  echo "[odoo.sh] odoocli binary not found. Install with 'pip install odoocli', or set AOC_ODOOCLI_BIN=/path/to/odoocli." >&2
  exit 127
fi

exec "$ODOOCLI_BIN" --config "$TMP_CFG" --profile "$PROFILE_NAME" "$@"
