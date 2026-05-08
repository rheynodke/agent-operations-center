#!/usr/bin/env bash
# odoo-whoami.sh — resolve current Odoo user for an assigned connection.
#
# Usage: odoo-whoami.sh <connection-name> [--refresh]
#
# Output: JSON object on stdout with uid, login, name, partner_id,
# employee_id, employee_name, tz, company_id, cached, cached_at.
# Caches result in $TMPDIR for 1 hour. Use --refresh to bypass cache.
# On error: prints JSON {"error": "...", ...} to stderr, non-zero exit.

set -euo pipefail

CONN="${1:-}"
shift || true
REFRESH=0
for arg in "$@"; do
  case "$arg" in
    --refresh) REFRESH=1 ;;
  esac
done

if [ -z "$CONN" ]; then
  echo '{"error":"USAGE","message":"Usage: odoo-whoami.sh <connection-name> [--refresh]"}' >&2
  exit 64
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Cache key: first 12 chars of sha256(connection-name).
if command -v shasum >/dev/null 2>&1; then
  CACHE_KEY=$(printf '%s' "$CONN" | shasum -a 256 | cut -c1-12)
else
  CACHE_KEY=$(printf '%s' "$CONN" | sha256sum | cut -c1-12)
fi
CACHE_FILE="${TMPDIR:-/tmp}/.aoc-odoo-whoami-${CACHE_KEY}.json"
TTL=3600

# Cache hit?
if [ "$REFRESH" -eq 0 ] && [ -f "$CACHE_FILE" ]; then
  if [ "$(uname)" = "Darwin" ]; then
    MTIME=$(stat -f %m "$CACHE_FILE")
  else
    MTIME=$(stat -c %Y "$CACHE_FILE")
  fi
  AGE=$(( $(date +%s) - MTIME ))
  if [ "$AGE" -lt "$TTL" ]; then
    jq '.cached = true' "$CACHE_FILE"
    exit 0
  fi
fi

# 1. Resolve odooUsername from odoo-list.sh
LIST=$("$SCRIPT_DIR/odoo-list.sh" 2>/dev/null || echo "[]")
ENTRY=$(echo "$LIST" | jq --arg n "$CONN" 'map(select(.name == $n)) | .[0] // null')
if [ "$ENTRY" = "null" ]; then
  jq -n --arg conn "$CONN" '{error:"CONNECTION_NOT_FOUND", connection:$conn, message:"Connection not in odoo-list output. Assign an odoocli connection in AOC dashboard."}' >&2
  exit 1
fi

USERNAME=$(echo "$ENTRY" | jq -r '.odooUsername // ""')
if [ -z "$USERNAME" ]; then
  jq -n --arg conn "$CONN" '{error:"MISSING_USERNAME", connection:$conn, message:"odooUsername empty in connection metadata. Fix the connection in AOC dashboard."}' >&2
  exit 1
fi

# Escape single quotes for safe interpolation into the Odoo domain literal
# (Python literal_eval consumes \' as a single-quote inside a single-quoted string).
ESCAPED_USERNAME=${USERNAME//\'/\\\'}

# 2. Resolve uid via res.users (login = USERNAME, exact match)
USERS=$("$SCRIPT_DIR/odoo.sh" "$CONN" record search res.users \
  --domain "[('login','=','$ESCAPED_USERNAME')]" \
  --fields id,name,login,partner_id,tz,company_id --limit 1 2>/dev/null || echo "[]")

# Fallback: case-insensitive
if [ "$(echo "$USERS" | jq 'if type=="array" then length else 0 end')" = "0" ]; then
  USERS=$("$SCRIPT_DIR/odoo.sh" "$CONN" record search res.users \
    --domain "[('login','=ilike','$ESCAPED_USERNAME')]" \
    --fields id,name,login,partner_id,tz,company_id --limit 1 2>/dev/null || echo "[]")
fi

if [ "$(echo "$USERS" | jq 'if type=="array" then length else 0 end')" = "0" ]; then
  jq -n --arg conn "$CONN" --arg login "$USERNAME" '{error:"USER_NOT_FOUND", connection:$conn, tried_login:$login, message:"odooUsername does not match any res.users.login. Check connection metadata in AOC dashboard."}' >&2
  exit 1
fi

UID_VAL=$(echo "$USERS" | jq -r '.[0].id')
NAME_VAL=$(echo "$USERS" | jq -r '.[0].name')
LOGIN_VAL=$(echo "$USERS" | jq -r '.[0].login')
TZ_VAL=$(echo "$USERS" | jq -r '.[0].tz // ""')
PARTNER_ID=$(echo "$USERS" | jq '.[0].partner_id | if type=="array" then .[0] else . end // null')
COMPANY_ID=$(echo "$USERS" | jq '.[0].company_id | if type=="array" then .[0] else . end // null')

# 3. Optional: hr.employee lookup (graceful if module not installed)
EMP_ID="null"
EMP_NAME="null"
EMP=$("$SCRIPT_DIR/odoo.sh" "$CONN" record search hr.employee \
  --domain "[('user_id','=',$UID_VAL)]" \
  --fields id,name --limit 1 2>/dev/null || echo "[]")
if [ "$(echo "$EMP" | jq 'if type=="array" then length else 0 end' 2>/dev/null || echo 0)" != "0" ]; then
  EMP_ID=$(echo "$EMP" | jq '.[0].id')
  EMP_NAME=$(echo "$EMP" | jq -c '.[0].name')
fi

# 4. Build result JSON
NOW=$(date -u +%FT%TZ)
RESULT=$(jq -n \
  --arg conn "$CONN" \
  --argjson uid "$UID_VAL" \
  --arg login "$LOGIN_VAL" \
  --arg name "$NAME_VAL" \
  --argjson partner_id "$PARTNER_ID" \
  --argjson employee_id "$EMP_ID" \
  --argjson employee_name "$EMP_NAME" \
  --arg tz "$TZ_VAL" \
  --argjson company_id "$COMPANY_ID" \
  --arg cached_at "$NOW" \
  '{
    connection: $conn,
    uid: $uid,
    login: $login,
    name: $name,
    partner_id: $partner_id,
    employee_id: $employee_id,
    employee_name: $employee_name,
    tz: $tz,
    company_id: $company_id,
    cached: false,
    cached_at: $cached_at
  }')

# 5. Write cache (mode 0600), echo result
umask 077
echo "$RESULT" > "$CACHE_FILE"
echo "$RESULT"
