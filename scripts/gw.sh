#!/usr/bin/env bash
# =============================================================================
# gw.sh — OpenClaw Gateway Manager (direct host inspection, no server needed)
#
# Reads gateway state from SQLite DB + OS process table directly.
# Works even when AOC server is down.
#
# Usage:
#   ./scripts/gw.sh                                  # list all gateway statuses
#   ./scripts/gw.sh list                             # same
#   ./scripts/gw.sh status  [userId]                 # detailed status for one user
#   ./scripts/gw.sh watch   [--interval N] [--running] [--no-clear]
#                                                    # live top-like view with RSS/CPU/uptime
#   ./scripts/gw.sh start   <target> [--delay <s>]   # start gateway(s)
#   ./scripts/gw.sh stop    <target> [--delay <s>]   # stop gateway(s)
#   ./scripts/gw.sh restart <target> [--delay <s>]   # restart (atomic via AOC API)
#   ./scripts/gw.sh sweep   [--kill]                 # audit zombies + duplicate
#                                                    # listeners; --kill to clean up
#   ./scripts/gw.sh logs    <userId>                 # tail gateway log
#   ./scripts/gw.sh orphans                          # find orphan gateway processes
#
# <target> can be:
#   all                  — every user (admin uid=1 included)
#   running              — users currently running (DB state=running)
#   stopped              — users stopped or never started
#   stale                — DB says running but PID is dead (cleanup candidates)
#   <uid>                — single numeric id, e.g. 5
#   <username>           — by username, e.g. odooplm
#   <uid>,<uid>,…        — comma-list, e.g. 3,5,8 (mix ids & usernames OK)
#
# For "all"/multi-target, --delay defaults to 8s between spawns to avoid
# overwhelming AOC's HTTP spawn timeline (one spawn takes ~30-90s with
# plugins). Override with --delay <n> or --delay=<n>.
# =============================================================================
set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Auto-load .env
ENV_FILE="$ROOT_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  # Direct source — process substitution `source <(grep ...)` is unreliable on
  # macOS bash 3.2 (drops vars on script-level use), use straight sourcing.
  # The .env file is plain KEY=VALUE so it's safe to source as bash.
  set -o allexport
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +o allexport
fi

DB_PATH="${AOC_DB_PATH:-$ROOT_DIR/data/aoc.db}"
OPENCLAW_BASE="${OPENCLAW_HOME:-$HOME/.openclaw}"
OPENCLAW_BIN="${OPENCLAW_BIN:-$(command -v openclaw 2>/dev/null || echo /opt/homebrew/bin/openclaw)}"
PORT_RANGE_START=19000
PORT_RANGE_END=19999
ADMIN_GW_PORT="${GATEWAY_PORT:-18789}"
ADMIN_LAUNCHD_LABEL="${OPENCLAW_LAUNCHD_LABEL:-ai.openclaw.gateway}"
ADMIN_RESTART_TIMEOUT_SECS=60

# AOC dashboard server (drives the gateway orchestrator). When AOC is alive,
# gw.sh defers user-gateway lifecycle (start/stop/restart) to it via API
# instead of writing SQLite out-of-band — sql.js holds state in memory, so
# direct DB writes are invisible until next AOC restart and trigger
# onChildExit respawn races that spawn duplicate gateways.
AOC_HOST="${AOC_HOST:-http://localhost:18800}"
aoc_alive() {
  curl -sf -m 2 -o /dev/null "$AOC_HOST/api/health" 2>/dev/null \
    || curl -sf -m 2 -o /dev/null "$AOC_HOST/" 2>/dev/null
}
aoc_ops() {
  # POST /api/ops/gateway/<uid>/<action>.
  # Prints body (or "HTTP <code>: <body>" on error) and returns non-zero on non-2xx
  # — avoids `curl -f` swallowing the response body on HTTP errors.
  #
  # Timeout note: AOC's gateway spawn (with 10 plugins) takes 60-90s, governed
  # by AOC_GATEWAY_READY_TIMEOUT_MS (default 90000ms). Use 120s here as
  # ceiling so curl doesn't give up before AOC finishes — that triggers
  # "curl error: 000" with the spawn still completing server-side, which
  # creates phantom failures in `restart all` output.
  local uid="$1" action="$2"
  [[ -n "${DASHBOARD_TOKEN:-}" ]] || { echo "DASHBOARD_TOKEN not set in .env" >&2; return 78; }
  local body http_code
  body=$(curl -s -m 120 -o /dev/stdout -w '\n%{http_code}' -X POST \
    -H "Authorization: Bearer $DASHBOARD_TOKEN" \
    "$AOC_HOST/api/ops/gateway/$uid/$action") || {
    echo "curl error: $body"
    return 1
  }
  http_code="${body##*$'\n'}"
  body="${body%$'\n'*}"
  if [[ "$http_code" =~ ^2 ]]; then
    printf '%s' "$body"
    return 0
  fi
  printf 'HTTP %s: %s' "$http_code" "${body:-<empty body>}"
  return 1
}

# ── Colors ────────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  R=$'\033[0m'; B=$'\033[1m'; D=$'\033[2m'
  GRN=$'\033[32m'; RED=$'\033[31m'; YEL=$'\033[33m'; CYN=$'\033[36m'; MAG=$'\033[35m'
else
  R=''; B=''; D=''; GRN=''; RED=''; YEL=''; CYN=''; MAG=''
fi

# ── Helpers ───────────────────────────────────────────────────────────────────
die()  { echo -e "${RED}✗ $*${R}" >&2; exit 1; }
info() { echo -e "${CYN}ℹ $*${R}"; }
ok()   { echo -e "${GRN}✓ $*${R}"; }
warn() { echo -e "${YEL}⚠ $*${R}"; }

require_cmd() { command -v "$1" &>/dev/null || die "'$1' required but not found"; }
require_cmd sqlite3

[[ -f "$DB_PATH" ]] || die "Database not found at $DB_PATH"

# SQLite helper — tab-separated output, no headers
sql() { sqlite3 -separator '	' "$DB_PATH" "$1" 2>/dev/null; }

# Check if a PID is alive
pid_alive() { kill -0 "$1" 2>/dev/null; }

# Check if a TCP port is listening
port_open() {
  local port="$1"
  (echo >/dev/tcp/127.0.0.1/"$port") 2>/dev/null
}

# Get user's OPENCLAW_HOME directory
user_home() {
  local uid="$1"
  if [[ "$uid" -eq 1 ]]; then
    echo "$OPENCLAW_BASE"
  else
    echo "$OPENCLAW_BASE/users/$uid/.openclaw"
  fi
}

# ── Process discovery ─────────────────────────────────────────────────────────

# Find all openclaw-gateway PIDs and their listening ports
discover_gateways() {
  # Returns: pid<tab>port (one per line). Port may be "-" if no LISTEN found.
  local pids
  pids=$(pgrep -f 'openclaw-gateway' 2>/dev/null || true)
  [[ -z "$pids" ]] && return

  while IFS= read -r pid; do
    local port="-"
    # Find the lowest managed-range port this PID listens on
    local lsof_out
    lsof_out=$(lsof -p "$pid" -i tcp -P -n -a -sTCP:LISTEN 2>/dev/null || true)
    if [[ -n "$lsof_out" ]]; then
      # Parse all listening ports, pick the lowest one in the managed range
      local found_port
      found_port=$(echo "$lsof_out" \
        | grep -oE '127\.0\.0\.1:[0-9]+' \
        | sed 's/127.0.0.1://' \
        | sort -n \
        | head -1)
      [[ -n "$found_port" ]] && port="$found_port"
    fi
    echo -e "${pid}\t${port}"
  done <<< "$pids"
}

# ── List ──────────────────────────────────────────────────────────────────────
cmd_list() {
  info "Gateway status — DB: ${DB_PATH}"
  info "OpenClaw home:  ${OPENCLAW_BASE}"
  echo

  # Collect live process info into a temp file (bash 3.x compat — no assoc arrays)
  local gw_tmp
  gw_tmp=$(mktemp /tmp/gw_live.XXXXXX)
  trap "rm -f '$gw_tmp'" EXIT
  discover_gateways > "$gw_tmp"

  # Lookup helpers against the temp file
  _live_port_for_pid() { awk -F'\t' -v p="$1" '$1==p{print $2; exit}' "$gw_tmp"; }
  _live_pid_for_port() { awk -F'\t' -v p="$1" '$2==p{print $1; exit}' "$gw_tmp"; }

  # Header
  printf "${B}%-4s  %-16s  %-6s  %-12s  %-6s  %-7s  %-7s  %-14s  %s${R}\n" \
    "UID" "USERNAME" "ROLE" "STATE" "PORT" "PID" "ALIVE?" "PORT LISTEN?" "MASTER"
  printf '%0.s─' {1..100}; echo

  # Read all users
  local rows
  rows=$(sql "SELECT id, username, role, gateway_port, gateway_pid, gateway_state, master_agent_id FROM users ORDER BY id;")

  local total=0 running=0 stopped=0 stale=0

  while IFS=$'\t' read -r uid username role db_port db_pid db_state master_id; do
    [[ -z "$uid" ]] && continue
    total=$((total + 1))

    # Normalize nulls
    [[ "$db_port"  == "" ]] && db_port="-"
    [[ "$db_pid"   == "" ]] && db_pid="-"
    [[ "$db_state" == "" ]] && db_state="-"
    [[ "$master_id" == "" ]] && master_id="-"

    local alive="no" port_ok="no" actual_state

    # Admin (uid=1) uses external gateway
    if [[ "$uid" -eq 1 ]]; then
      db_state="external"
      db_port="$ADMIN_GW_PORT"
      if port_open "$ADMIN_GW_PORT"; then
        port_ok="yes"; alive="yes"
        local admin_pid
        admin_pid=$(_live_pid_for_port "$ADMIN_GW_PORT")
        [[ -n "$admin_pid" ]] && db_pid="$admin_pid"
      fi
    else
      if [[ "$db_pid" != "-" ]] && pid_alive "$db_pid"; then alive="yes"; fi
      if [[ "$db_port" != "-" ]] && port_open "$db_port"; then port_ok="yes"; fi
    fi

    # Determine effective state
    if [[ "$uid" -eq 1 ]]; then
      if [[ "$port_ok" == "yes" ]]; then
        actual_state="${GRN}● external${R}"; running=$((running + 1))
      else
        actual_state="${RED}✗ down${R}"; stopped=$((stopped + 1))
      fi
    elif [[ "$alive" == "yes" && "$port_ok" == "yes" ]]; then
      actual_state="${GRN}● running${R}"; running=$((running + 1))
    elif [[ "$alive" == "yes" && "$port_ok" == "no" ]]; then
      actual_state="${YEL}▲ starting${R}"; stale=$((stale + 1))
    elif [[ "$db_state" == "running" && "$alive" == "no" ]]; then
      actual_state="${RED}✗ stale${R}"; stale=$((stale + 1))
    else
      actual_state="${D}○ stopped${R}"; stopped=$((stopped + 1))
    fi

    local alive_str port_str
    [[ "$alive"   == "yes" ]] && alive_str="${GRN}yes${R}" || alive_str="${D}no${R}"
    [[ "$port_ok" == "yes" ]] && port_str="${GRN}yes${R}"  || port_str="${D}no${R}"

    local role_str="$role"
    [[ "$role" == "admin" ]] && role_str="${MAG}admin${R}"

    printf "%-4s  %-16s  %-17s  " "$uid" "$username" "$role_str"
    printf "%-23s  " "$actual_state"
    printf "%-6s  %-7s  " "$db_port" "$db_pid"
    printf "%-18s  %-18s  " "$alive_str" "$port_str"
    printf "%s\n" "$master_id"
  done <<< "$rows"

  printf '%0.s─' {1..100}; echo
  echo -e "${B}Total: $total${R}  ${GRN}running: $running${R}  ${D}stopped: $stopped${R}  ${YEL}stale: $stale${R}"

  # Show untracked gateway processes (skip legit child workers whose PPID is
  # a tracked launcher — openclaw-gateway forks an inner worker that holds
  # the listen socket).
  local untracked=0
  while IFS=$'\t' read -r pid port; do
    [[ -z "$pid" ]] && continue
    local db_match
    db_match=$(sql "SELECT id FROM users WHERE gateway_pid = $pid LIMIT 1;")
    [[ -n "$db_match" ]] && continue
    [[ "$port" == "$ADMIN_GW_PORT" ]] && continue
    local ppid
    ppid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
    local ppid_tracked
    ppid_tracked=$(sql "SELECT id FROM users WHERE gateway_pid = $ppid LIMIT 1;")
    [[ -n "$ppid_tracked" ]] && continue   # legit child worker
    if [[ "$untracked" -eq 0 ]]; then
      echo; warn "Untracked gateway processes (not in DB):"
    fi
    echo -e "  PID ${B}$pid${R} listening on port $port"
    untracked=$((untracked + 1))
  done < "$gw_tmp"
  echo
}

# ── Status (single user) ─────────────────────────────────────────────────────
cmd_status() {
  local uid="${1:-}"
  [[ -z "$uid" ]] && die "Usage: gw.sh status <userId>"

  local row
  row=$(sql "SELECT id, username, role, gateway_port, gateway_pid, gateway_state, master_agent_id FROM users WHERE id = $uid;")
  [[ -z "$row" ]] && die "User ID $uid not found"

  IFS=$'\t' read -r _uid username role db_port db_pid db_state master_id <<< "$row"

  local home
  home=$(user_home "$uid")
  local log_file="$home/logs/gateway.log"
  local config_file="$home/openclaw.json"

  echo -e "${B}Gateway status for user '$username' (uid=$uid)${R}"
  echo
  echo -e "  Role       : $role"
  echo -e "  Master     : ${master_id:-none}"
  echo -e "  Home       : $home"
  echo -e "  DB State   : ${db_state:-stopped}"
  echo -e "  DB Port    : ${db_port:--}"
  echo -e "  DB PID     : ${db_pid:--}"

  # Live checks
  if [[ -n "$db_pid" && "$db_pid" != "" ]]; then
    if pid_alive "$db_pid"; then
      echo -e "  PID Alive  : ${GRN}yes${R}"
    else
      echo -e "  PID Alive  : ${RED}no (stale DB entry)${R}"
    fi
  fi

  if [[ -n "$db_port" && "$db_port" != "" ]]; then
    if port_open "$db_port"; then
      echo -e "  Port Open  : ${GRN}yes${R} (127.0.0.1:$db_port)"
    else
      echo -e "  Port Open  : ${RED}no${R}"
    fi
  fi

  echo -e "  Config     : $([ -f "$config_file" ] && echo "${GRN}exists${R}" || echo "${RED}missing${R}")"
  echo -e "  Log File   : $([ -f "$log_file" ] && echo "${GRN}exists${R} ($(du -h "$log_file" | cut -f1))" || echo "${D}none${R}")"

  # Agent count
  if [[ -f "$config_file" ]]; then
    local agent_count
    agent_count=$(python3 -c "import json; d=json.load(open('$config_file')); print(len(d.get('agents',{}).get('list',[])))" 2>/dev/null || echo "?")
    echo -e "  Agents     : $agent_count"
  fi

  # Symlinks
  local skills_link="$home/skills"
  local scripts_link="$home/scripts"
  if [[ "$uid" -ne 1 ]]; then
    echo -e "  Skills  →  : $([ -L "$skills_link" ] && echo "${GRN}$(readlink "$skills_link")${R}" || echo "${YEL}not symlinked${R}")"
    echo -e "  Scripts →  : $([ -L "$scripts_link" ] && echo "${GRN}$(readlink "$scripts_link")${R}" || echo "${YEL}not symlinked${R}")"
  fi

  echo
}

# ── Admin gateway (uid=1) helpers ─────────────────────────────────────────────

admin_launchd_target() { echo "gui/$UID/$ADMIN_LAUNCHD_LABEL"; }

admin_launchd_loaded() {
  launchctl print "$(admin_launchd_target)" >/dev/null 2>&1
}

# Atomic restart via launchd: stop + start in one call. Waits for port to come back.
do_admin_restart() {
  echo -n "  [uid=1] admin (launchd: $ADMIN_LAUNCHD_LABEL): "
  if ! admin_launchd_loaded; then
    echo -e "${RED}launchd label not loaded for uid $UID${R}"
    echo -e "  ${D}Tip: launchctl bootstrap gui/$UID ~/Library/LaunchAgents/$ADMIN_LAUNCHD_LABEL.plist${R}"
    return 1
  fi
  echo -n "kickstart … "
  if ! launchctl kickstart -k "$(admin_launchd_target)" 2>/dev/null; then
    echo -e "${RED}FAILED${R}"
    return 1
  fi
  # Wait for the admin port to listen again (launchd may take a moment).
  local waited=0 max=$((ADMIN_RESTART_TIMEOUT_SECS * 10))
  # First wait briefly for port to drop, then for it to come back.
  while port_open "$ADMIN_GW_PORT" && [[ $waited -lt 30 ]]; do
    sleep 0.1; ((waited++))
  done
  waited=0
  while ! port_open "$ADMIN_GW_PORT" && [[ $waited -lt $max ]]; do
    sleep 0.1; ((waited++))
  done
  if port_open "$ADMIN_GW_PORT"; then
    echo -e "${GRN}OK${R} (port $ADMIN_GW_PORT listening)"
  else
    echo -e "${YEL}kickstart issued but port $ADMIN_GW_PORT not listening yet${R}"
    echo -e "  ${D}Check log: tail -30 $OPENCLAW_BASE/logs/gateway.log${R}"
    return 1
  fi
}

# Send TERM to admin gateway via launchctl. Note: launchd KeepAlive will respawn
# the process — useful as a "soft restart" but cannot truly hold the gateway
# down without `launchctl bootout`.
do_admin_stop() {
  echo -n "  [uid=1] admin (launchd: $ADMIN_LAUNCHD_LABEL): "
  if ! admin_launchd_loaded; then
    echo -e "${YEL}not loaded — nothing to stop${R}"
    return 0
  fi
  if launchctl kill TERM "$(admin_launchd_target)" 2>/dev/null; then
    echo -e "${GRN}sent SIGTERM${R} ${D}(launchd KeepAlive will respawn — use 'restart' for clean cycle)${R}"
  else
    echo -e "${RED}launchctl kill failed${R}"
    return 1
  fi
}

# Ensure admin gateway is running. If launchd label is loaded, KeepAlive should
# already do this; we just verify the port and kickstart if missing.
do_admin_start() {
  echo -n "  [uid=1] admin (launchd: $ADMIN_LAUNCHD_LABEL): "
  if port_open "$ADMIN_GW_PORT"; then
    echo -e "${GRN}already running${R} (port $ADMIN_GW_PORT)"
    return 0
  fi
  if ! admin_launchd_loaded; then
    echo -e "${RED}launchd label not loaded${R}"
    return 1
  fi
  if launchctl kickstart "$(admin_launchd_target)" 2>/dev/null; then
    local waited=0 max=$((ADMIN_RESTART_TIMEOUT_SECS * 10))
    while ! port_open "$ADMIN_GW_PORT" && [[ $waited -lt $max ]]; do
      sleep 0.1; ((waited++))
    done
    if port_open "$ADMIN_GW_PORT"; then
      echo -e "${GRN}OK${R} (port $ADMIN_GW_PORT listening)"
    else
      echo -e "${YEL}kickstart issued, port not yet listening${R}"
      return 1
    fi
  else
    echo -e "${RED}launchctl kickstart failed${R}"
    return 1
  fi
}

# ── Stop ──────────────────────────────────────────────────────────────────────
do_stop() {
  local uid="$1"
  [[ "$uid" -eq 1 ]] && { do_admin_stop; return; }

  local row
  row=$(sql "SELECT username, gateway_pid FROM users WHERE id = $uid;")
  [[ -z "$row" ]] && { warn "User $uid not found"; return; }

  IFS=$'\t' read -r username db_pid <<< "$row"
  echo -n "  [uid=$uid] $username: stopping … "

  # Prefer AOC API: orchestrator updates its in-memory children Map +
  # in-memory DB atomically, so onChildExit won't race-respawn the gateway.
  if aoc_alive; then
    if aoc_ops "$uid" "stop" >/dev/null; then
      echo -e "${GRN}OK${R} ${D}(via AOC API)${R}"
      return
    fi
    warn "AOC API stop failed, falling back to direct kill"
  fi

  if [[ -z "$db_pid" || "$db_pid" == "" ]]; then
    echo -e "${D}already stopped${R}"
    return
  fi

  if pid_alive "$db_pid"; then
    kill -TERM "$db_pid" 2>/dev/null || true
    # Wait up to 5s
    local waited=0
    while pid_alive "$db_pid" && [[ $waited -lt 50 ]]; do
      sleep 0.1; ((waited++))
    done
    if pid_alive "$db_pid"; then
      kill -KILL "$db_pid" 2>/dev/null || true
      echo -ne "${YEL}force killed${R} "
    fi
  fi

  # Clear DB state
  sql "UPDATE users SET gateway_port = NULL, gateway_pid = NULL, gateway_state = 'stopped', gateway_token = NULL WHERE id = $uid;"
  echo -e "${GRN}OK${R}"
}

# ── Start ─────────────────────────────────────────────────────────────────────
do_start() {
  local uid="$1"
  [[ "$uid" -eq 1 ]] && { do_admin_start; return; }

  local row
  row=$(sql "SELECT username, gateway_pid, gateway_port FROM users WHERE id = $uid;")
  [[ -z "$row" ]] && { warn "User $uid not found"; return; }

  IFS=$'\t' read -r username db_pid db_port <<< "$row"

  # Check if already running
  if [[ -n "$db_pid" ]] && pid_alive "$db_pid"; then
    echo -e "  [uid=$uid] $username: ${GRN}already running${R} (pid=$db_pid port=$db_port)"
    return
  fi

  echo -n "  [uid=$uid] $username: starting … "

  # Prefer AOC API: orchestrator handles spawn idempotently and ensures the
  # in-memory children Map is populated, so subsequent onChildExit calls
  # respect user intent and the lifecycle stays consistent.
  if aoc_alive; then
    local resp
    if resp=$(aoc_ops "$uid" "start" 2>&1); then
      echo -e "${GRN}OK${R} ${D}(via AOC API: $resp)${R}"
      return
    fi
    # AOC API failed but AOC is alive — DO NOT fall back to direct spawn.
    # The API call may have actually started the gateway and is just slow to
    # respond; falling back would create a duplicate gateway. Surface the
    # error and let the operator decide.
    echo -e "${RED}FAILED${R} (AOC API error: $resp)"
    echo -e "  ${D}AOC is reachable but rejected the start request. Possible causes:${R}"
    echo -e "  ${D}- AOC_DISABLE_AUTO_SPAWN=1 set without explicit:true in caller${R}"
    echo -e "  ${D}- spawn is in flight (API timed out before response) — re-check with: gw.sh list${R}"
    echo -e "  ${D}- existing gateway already running (check pid alive)${R}"
    return 1
  fi

  # AOC dashboard is DOWN — only here do we fall back to direct spawn.
  warn "AOC dashboard unreachable; falling back to direct spawn (no orchestrator tracking)"

  [[ -x "$OPENCLAW_BIN" ]] || die "OPENCLAW_BIN not executable: '$OPENCLAW_BIN' (set OPENCLAW_BIN env or install openclaw on PATH)"

  local home
  home=$(user_home "$uid")
  [[ -d "$home" ]] || die "User home not found: $home"

  # Allocate port (find first free 3-port stride in managed range)
  local used_ports
  used_ports=$(sql "SELECT gateway_port FROM users WHERE gateway_port IS NOT NULL;" | tr '\n' ' ')
  local port=""
  for (( p=PORT_RANGE_START; p<=PORT_RANGE_END-2; p+=3 )); do
    local conflict=false
    for used in $used_ports; do
      if [[ "$used" -eq "$p" || "$used" -eq $((p+1)) || "$used" -eq $((p+2)) ]]; then
        conflict=true; break
      fi
    done
    if [[ "$conflict" == "false" ]]; then
      # Also check OS-level
      if ! port_open "$p" && ! port_open $((p+1)) && ! port_open $((p+2)); then
        port=$p; break
      fi
    fi
  done
  [[ -z "$port" ]] && { echo -e "${RED}FAILED — no free port${R}"; return; }

  # Generate token
  local token
  token=$(openssl rand -hex 32)

  # Set up environment
  local log_file="$home/logs/gateway.log"
  mkdir -p "$(dirname "$log_file")"

  # Spawn gateway (detached)
  OPENCLAW_HOME="$(dirname "$home")" \
  OPENCLAW_STATE_DIR="$home" \
  OPENCLAW_GATEWAY_TOKEN="$token" \
  OPENCLAW_GATEWAY_PORT="$port" \
    nohup "$OPENCLAW_BIN" gateway >> "$log_file" 2>&1 &
  local child_pid=$!
  disown "$child_pid" 2>/dev/null || true

  # Wait for readiness (up to 15s)
  local waited=0
  while ! port_open "$port" && [[ $waited -lt 150 ]]; do
    # Check if process died early
    if ! pid_alive "$child_pid"; then
      echo -e "${RED}FAILED — process exited early${R}"
      echo -e "  ${D}Check log: tail -30 $log_file${R}"
      return
    fi
    sleep 0.1; ((waited++))
  done

  if port_open "$port"; then
    # Persist to DB
    sql "UPDATE users SET gateway_port = $port, gateway_pid = $child_pid, gateway_state = 'running', gateway_token = '$token' WHERE id = $uid;"
    echo -e "${GRN}OK${R} (pid=$child_pid port=$port)"
  else
    echo -e "${RED}FAILED — timeout waiting for port $port${R}"
    echo -e "  ${D}Check log: tail -30 $log_file${R}"
    kill -TERM "$child_pid" 2>/dev/null || true
  fi
}

# ── Resolve targets ───────────────────────────────────────────────────────────
# Accepts:
#   all                    — every user (including admin uid=1)
#   running                — users whose gateway_state='running' in DB
#   stopped                — users whose gateway_state='stopped' (or NULL) in DB
#   stale                  — DB state='running' but PID not alive (= cleanup candidates)
#   <uid>                  — single numeric id
#   <username>             — single username (resolved via DB)
#   <uid|user>,<uid|user>… — comma-list (mix of ids and usernames OK)
resolve_uids() {
  local target="$1"
  case "$target" in
    all)
      sql "SELECT id FROM users ORDER BY id;" ;;
    running)
      sql "SELECT id FROM users WHERE gateway_state='running' ORDER BY id;" ;;
    stopped)
      sql "SELECT id FROM users WHERE gateway_state IS NULL OR gateway_state='stopped' OR gateway_state='' ORDER BY id;" ;;
    stale)
      # Stale = DB says running but the recorded pid is dead. We check liveness
      # in shell since SQLite can't kill -0.
      while IFS=$'\t' read -r uid pid; do
        [[ -z "$uid" ]] && continue
        if [[ -z "$pid" ]] || ! pid_alive "$pid"; then echo "$uid"; fi
      done < <(sql "SELECT id, gateway_pid FROM users WHERE gateway_state='running' ORDER BY id;")
      ;;
    *)
      # Comma-list (or single). Resolve each part as uid → username → master_agent_id.
      # Warnings go to STDERR so cmd_start/stop/restart's `while read` over
      # this function's stdout doesn't capture the warning text as a "uid".
      local IFS=','
      for part in $target; do
        part=$(echo "$part" | tr -d ' ')
        [[ -z "$part" ]] && continue
        if [[ "$part" =~ ^[0-9]+$ ]]; then
          echo "$part"
        else
          local uid
          uid=$(sql "SELECT id FROM users WHERE username = '$part' LIMIT 1;")
          if [[ -z "$uid" ]]; then
            # Fallback: try master_agent_id (agent name like "migi", "tecno").
            # Operators often remember agent names over usernames.
            uid=$(sql "SELECT id FROM users WHERE master_agent_id = '$part' LIMIT 1;")
          fi
          if [[ -z "$uid" ]]; then
            echo -e "${YEL}⚠ '$part' not found (not a uid, username, or agent name), skipping${R}" >&2
            continue
          fi
          echo "$uid"
        fi
      done
      ;;
  esac
}

# ── Commands ──────────────────────────────────────────────────────────────────
# Parse "--delay <seconds>" from args. Returns delay value (default 0 for
# single uid, 8 for "all"/multi-resolution targets) and strips it from
# remaining args via the global PARSED_TARGET variable.
parse_delay_opt() {
  PARSED_DELAY=""
  PARSED_TARGET=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --delay)
        [[ $# -lt 2 ]] && die "--delay requires a value (seconds)"
        PARSED_DELAY="$2"
        shift 2
        ;;
      --delay=*)
        PARSED_DELAY="${1#--delay=}"
        shift
        ;;
      *)
        PARSED_TARGET="$1"
        shift
        ;;
    esac
  done
}

cmd_stop() {
  parse_delay_opt "$@"
  local target="$PARSED_TARGET"
  local delay="${PARSED_DELAY:-0}"
  [[ -z "$target" ]] && die "Usage: gw.sh stop <userId|username|all> [--delay <seconds>]"
  info "Stopping gateway(s) for target='$target'${PARSED_DELAY:+ (delay=${delay}s)}"
  local uids=()
  while IFS= read -r uid; do
    [[ -n "$uid" ]] && uids+=("$uid")
  done < <(resolve_uids "$target")
  local i=0 total=${#uids[@]}
  for uid in "${uids[@]}"; do
    do_stop "$uid"
    i=$((i+1))
    [[ $i -lt $total && "$delay" -gt 0 ]] && sleep "$delay"
  done
  ok "Done"
}

cmd_start() {
  parse_delay_opt "$@"
  local target="$PARSED_TARGET"
  local delay="${PARSED_DELAY:-}"
  [[ -z "$target" ]] && die "Usage: gw.sh start <userId|username|all> [--delay <seconds>]"
  info "Starting gateway(s) for target='$target'${delay:+ (delay=${delay}s)}"
  local uids=()
  while IFS= read -r uid; do
    [[ -n "$uid" ]] && uids+=("$uid")
  done < <(resolve_uids "$target")
  # Default delay: 8s when expanding multiple uids, 0 when single.
  if [[ -z "$delay" ]]; then
    delay=$([[ ${#uids[@]} -gt 1 ]] && echo 8 || echo 0)
  fi
  local i=0
  for uid in "${uids[@]}"; do
    do_start "$uid"
    i=$((i+1))
    if [[ $i -lt ${#uids[@]} && "$delay" -gt 0 ]]; then
      sleep "$delay"
    fi
  done
  ok "Done"
}

cmd_restart() {
  parse_delay_opt "$@"
  local target="$PARSED_TARGET"
  local delay="${PARSED_DELAY:-}"
  [[ -z "$target" ]] && die "Usage: gw.sh restart <userId|username|all> [--delay <seconds>]"
  info "Restarting gateway(s) for target='$target'${delay:+ (delay=${delay}s)}"
  local uids=()
  while IFS= read -r uid; do
    [[ -n "$uid" ]] && uids+=("$uid")
  done < <(resolve_uids "$target")
  # Default delay: 8s for multi-uid (so AOC can finish one spawn before the
  # next; without delay, AOC serializes per-user but parallel uid spawns
  # can starve each other for CPU during plugin init). 0 for single uid.
  if [[ -z "$delay" ]]; then
    delay=$([[ ${#uids[@]} -gt 1 ]] && echo 8 || echo 0)
  fi
  local i=0
  local total=${#uids[@]}
  for uid in "${uids[@]}"; do
    if [[ "$uid" -eq 1 ]]; then
      # Admin gateway: atomic kickstart -k via launchd (single-call restart).
      do_admin_restart || true
    elif aoc_alive; then
      # Atomic restart via AOC API — orchestrator's restartGateway holds the
      # per-user lock across stop+spawn, so no other caller can interleave.
      local row resp
      row=$(sql "SELECT username FROM users WHERE id = $uid;")
      local username="${row:-uid=$uid}"
      echo -n "  [uid=$uid] $username: restarting … "
      if resp=$(aoc_ops "$uid" "restart" 2>&1); then
        echo -e "${GRN}OK${R} ${D}(via AOC API: $resp)${R}"
      else
        # AOC alive but API rejected. Do NOT fall back to stop+start — the
        # API call may be in-flight and a fallback would race with it,
        # producing duplicate gateways. Surface and stop.
        echo -e "${RED}FAILED${R} (AOC API error: $resp)"
        echo -e "  ${D}Re-check with: gw.sh list${R}"
      fi
    else
      do_stop "$uid"
      do_start "$uid"
    fi
    i=$((i+1))
    if [[ $i -lt $total && "$delay" -gt 0 ]]; then
      sleep "$delay"
    fi
  done
  ok "Done"
}

cmd_logs() {
  local uid="${1:-}"
  [[ -z "$uid" ]] && die "Usage: gw.sh logs <userId>"
  local home
  home=$(user_home "$uid")
  local log_file="$home/logs/gateway.log"
  [[ -f "$log_file" ]] || die "No log file at $log_file"
  info "Tailing $log_file (Ctrl+C to stop)"
  tail -f "$log_file"
}

# ── Sweep — audit + kill zombies and duplicates ───────────────────────────────
# Designed to be safe to run on a cron (every 5 min). Detects:
#   - openclaw-gateway daemons with PPID=1 and NO listening port (true zombies)
#   - multiple processes listening on the same managed port (duplicate spawn)
#   - launchers whose daemon child has already died (half-dead trees)
# By default reports without killing. Use --kill to SIGTERM detected zombies.
cmd_sweep() {
  local do_kill=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --kill)  do_kill=1; shift ;;
      --dry-run) do_kill=0; shift ;;
      -h|--help)
        echo "Usage: gw.sh sweep [--kill]"; return 0 ;;
      *) warn "Unknown flag: $1"; shift ;;
    esac
  done

  # CRITICAL: lsof lives in /usr/sbin on macOS but cron's default PATH is
  # /usr/bin:/bin. Without an absolute path, lsof not found → port_count=0
  # for EVERY process → all daemons misidentified as zombies → mass kill.
  # Find a real lsof or refuse to run.
  local LSOF
  LSOF=$(command -v lsof || true)
  [[ -z "$LSOF" ]] && [[ -x /usr/sbin/lsof ]] && LSOF=/usr/sbin/lsof
  [[ -z "$LSOF" ]] && [[ -x /usr/bin/lsof ]] && LSOF=/usr/bin/lsof
  if [[ -z "$LSOF" ]]; then
    die "lsof not found in PATH ($PATH) — sweep cannot verify which processes are listening. Refusing to run."
  fi

  info "Sweeping for zombie + duplicate gateway processes…"
  echo

  # ── Zombies: PPID=1 daemons not listening on any port ──────────────────────
  local zombie_count=0 zombie_pids=()
  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    # Count listening sockets. lsof exits non-zero when nothing matches; with
    # `set -o pipefail` that aborts the script. Wrap with `|| true` to absorb.
    # awk always emits a number (n+0), so even on empty input we get "0".
    local port_count
    port_count=$( { "$LSOF" -aPnp "$pid" -iTCP -sTCP:LISTEN 2>/dev/null || true; } | awk '/LISTEN/{n++} END{print n+0}')
    if [[ "$port_count" -eq 0 ]]; then
      local rss etime
      rss=$(ps -p "$pid" -o rss= 2>/dev/null | tr -d ' ')
      etime=$(ps -p "$pid" -o etime= 2>/dev/null | tr -d ' ')
      [[ -z "$rss" ]] && continue
      echo -e "  ${YEL}⚠ zombie${R} pid=$pid  rss=$(awk -v r=$rss 'BEGIN{printf "%dMB", r/1024}')  etime=$etime"
      zombie_pids+=("$pid")
      zombie_count=$((zombie_count + 1))
    fi
  done < <(ps -axo pid,ppid,comm | awk '$2==1 && $3=="openclaw-gateway"{print $1}')
  [[ $zombie_count -eq 0 ]] && echo -e "  ${GRN}✓ no zombies${R}"

  # ── Duplicates: more than one process LISTEN on the same managed port ──────
  echo
  local dup_count=0
  while IFS= read -r line; do
    local count="${line%% *}"
    local port="${line##* }"
    if [[ "$count" -gt 1 ]]; then
      echo -e "  ${RED}✗ duplicate${R} port=$port held by ${count} processes"
      "$LSOF" -iTCP:"$port" -sTCP:LISTEN -P 2>/dev/null | awk 'NR>1{print "      pid="$2}'
      dup_count=$((dup_count + 1))
    fi
  done < <("$LSOF" -iTCP -sTCP:LISTEN -P 2>/dev/null | awk '/openclaw-gateway/ {match($9, /:19[0-9][0-9][0-9]$/); if (RSTART > 0) print substr($9, RSTART+1)}' | sort | uniq -c | awk '{print $1" "$2}')
  [[ $dup_count -eq 0 ]] && echo -e "  ${GRN}✓ no duplicate listeners${R}"

  # ── Kill phase ─────────────────────────────────────────────────────────────
  if [[ $do_kill -eq 1 && $zombie_count -gt 0 ]]; then
    echo
    info "Killing ${zombie_count} zombie(s)…"
    for pid in "${zombie_pids[@]}"; do
      kill -TERM "$pid" 2>/dev/null || true
    done
    sleep 1
    for pid in "${zombie_pids[@]}"; do
      kill -KILL "$pid" 2>/dev/null || true
    done
    sleep 1
    local still=0
    for pid in "${zombie_pids[@]}"; do
      kill -0 "$pid" 2>/dev/null && still=$((still+1))
    done
    if [[ $still -eq 0 ]]; then ok "all zombies killed"; else warn "$still still alive after SIGKILL"; fi
  elif [[ $zombie_count -gt 0 ]]; then
    echo
    echo -e "  ${D}(dry run — add ${B}--kill${R}${D} to clean up zombies)${R}"
  fi

  # Summary line for cron parsing
  echo
  echo "summary: zombies=$zombie_count duplicates=$dup_count"
}

cmd_orphans() {
  info "Scanning for orphan gateway processes …"
  echo

  local tracked_pids
  tracked_pids=$(sql "SELECT gateway_pid FROM users WHERE gateway_pid IS NOT NULL;" | tr '\n' ' ')

  local found=0
  while IFS=$'\t' read -r pid port; do
    local is_tracked=false
    for tp in $tracked_pids; do
      [[ "$tp" == "$pid" ]] && is_tracked=true
    done
    # Also skip if it's on the admin port
    [[ "$port" == "$ADMIN_GW_PORT" ]] && is_tracked=true

    # Skip if PPID is a tracked launcher — openclaw-gateway forks an inner
    # worker that owns the listen socket; the launcher is in DB, the worker
    # is its child. Without this the worker shows up as a false orphan.
    if [[ "$is_tracked" == "false" ]]; then
      local ppid
      ppid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
      for tp in $tracked_pids; do
        [[ "$tp" == "$ppid" ]] && is_tracked=true && break
      done
    fi

    if [[ "$is_tracked" == "false" ]]; then
      echo -e "  ${YEL}Orphan:${R} PID=${B}$pid${R}  port=$port"
      ((found++))
    fi
  done < <(discover_gateways)

  if [[ "$found" -eq 0 ]]; then
    ok "No orphan gateway processes found"
  else
    echo
    warn "Found $found orphan(s). Kill with: kill -TERM <PID>"
  fi
}

# ── Usage ─────────────────────────────────────────────────────────────────────
usage() {
  echo -e "${B}gw.sh${R} — OpenClaw Gateway Manager (host-level, no server needed)"
  echo
  echo -e "  ${CYN}gw.sh${R}                          List all gateway statuses"
  echo -e "  ${CYN}gw.sh list${R}                     Same"
  echo -e "  ${CYN}gw.sh status  <uid>${R}            Detailed status for one user"
  echo -e "  ${CYN}gw.sh start   <uid|user|all>${R}   Start gateway"
  echo -e "  ${CYN}gw.sh stop    <uid|user|all>${R}   Stop gateway"
  echo -e "  ${CYN}gw.sh restart <uid|user|all>${R}   Restart gateway (admin uid=1 via launchctl kickstart -k)"
  echo -e "  ${CYN}gw.sh logs    <uid>${R}            Tail gateway log"
  echo -e "  ${CYN}gw.sh orphans${R}                  Find untracked gateway processes"
  echo
  echo -e "  ${D}Admin (uid=1) is managed by launchd label '$ADMIN_LAUNCHD_LABEL'.${R}"
  echo -e "  ${D}Override with OPENCLAW_LAUNCHD_LABEL or OPENCLAW_BIN env vars.${R}"
  echo -e "  ${D}Resolved openclaw bin: ${OPENCLAW_BIN:-<not found>}${R}"
  echo
}

# ── Watch (live refresh) ──────────────────────────────────────────────────────
# Renders a top-like live view of gateway state with per-process RSS, CPU, etime.
# Refreshes every N seconds (default 3). Ctrl+C to exit.
#
# Usage:
#   gw.sh watch                          # default 3s, all users
#   gw.sh watch --interval 5             # custom refresh
#   gw.sh watch --running                # only show running
#   gw.sh watch --no-clear               # append instead of clearing (good for tee/log)
cmd_watch() {
  local interval=3
  local filter="all"
  local clear_screen=1
  local once=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --interval|-n) interval="$2"; shift 2 ;;
      --interval=*)  interval="${1#--interval=}"; shift ;;
      --running)     filter="running"; shift ;;
      --no-clear)    clear_screen=0; shift ;;
      --once)        once=1; clear_screen=0; shift ;;
      -h|--help)
        echo "Usage: gw.sh watch [--interval N] [--running] [--no-clear] [--once]"; return 0 ;;
      *)
        warn "Unknown watch flag: $1"; shift ;;
    esac
  done
  [[ "$interval" =~ ^[0-9]+$ ]] || die "--interval must be a positive integer"

  trap 'echo; ok "watch stopped"; exit 0' INT TERM

  while true; do
    [[ $clear_screen -eq 1 ]] && tput clear

    # Header — system + memory breakdown
    local total_gb used_gb free_gb wired_gb active_gb inactive_gb pct_used
    read -r total_gb used_gb free_gb wired_gb active_gb inactive_gb pct_used < <(
      vm_stat | awk '
        /page size/{ps=$8}
        /free/{f=$3}
        /active/{a=$3}
        /inactive/{i=$3}
        /wired/{w=$4}
        END {
          total=(f+a+i+w)*ps/1024/1024/1024
          free=f*ps/1024/1024/1024
          used=total-free
          wired=w*ps/1024/1024/1024
          active=a*ps/1024/1024/1024
          inactive=i*ps/1024/1024/1024
          pct=used/total*100
          printf "%.1f %.1f %.1f %.1f %.1f %.1f %.0f\n", total, used, free, wired, active, inactive, pct
        }'
    )
    local load_avg now
    load_avg=$(uptime | sed -E 's/.*load averages?: //; s/[, ]+/ /g' | awk '{print $1" "$2" "$3}')
    now=$(date +"%H:%M:%S")

    # Color-code free RAM for at-a-glance health check
    local free_color="$GRN"
    awk -v f="$free_gb" 'BEGIN{exit (f<3)?0:1}' && free_color="$RED"
    awk -v f="$free_gb" 'BEGIN{exit (f>=3 && f<6)?0:1}' && free_color="$YEL"

    printf "${B}OpenClaw Gateway Watch${R}  ${D}%s  refresh=%ss  filter=%s${R}\n" "$now" "$interval" "$filter"
    printf "  Memory: ${free_color}%.1f GB free${R}${D}  ·${R}  %.1f / %.1f GB used (%s%%)  ${D}wired %.1f · active %.1f · inactive %.1f${R}\n" \
      "$free_gb" "$used_gb" "$total_gb" "$pct_used" "$wired_gb" "$active_gb" "$inactive_gb"
    printf "  Load:   %s ${D}(1m 5m 15m)${R}\n" "$load_avg"
    echo

    # Build live process map: pid → "rss(MB) cpu% etime args-fragment"
    # ps fields: pid ppid rss(kb) %cpu etime command
    local proc_tmp
    proc_tmp=$(mktemp /tmp/gw_watch.XXXXXX)
    ps -axo pid,ppid,rss,%cpu,etime,comm | awk '$6=="openclaw"||$6=="openclaw-gateway"{print $1"\t"$2"\t"$3"\t"$4"\t"$5"\t"$6}' > "$proc_tmp"

    # Helpers
    _proc_field() { awk -F'\t' -v p="$1" -v c="$2" '$1==p{print $c; exit}' "$proc_tmp"; }
    _daemon_pid_for_launcher() {
      # daemon = openclaw-gateway whose ppid matches the launcher pid
      awk -F'\t' -v p="$1" '$2==p && $6=="openclaw-gateway"{print $1; exit}' "$proc_tmp"
    }

    # Header row
    printf "${B}%-4s  %-22s  %-9s  %-7s  %-8s  %-5s  %-7s  %-6s  %s${R}\n" \
      "UID" "USERNAME" "STATE" "PORT" "DAEMON" "RSS" "CPU%" "UPTIME" "MASTER"
    printf '%0.s─' {1..96}; echo

    # Iterate users. NOTE: use `|` separator (not tab) because bash treats tab
    # as IFS whitespace and collapses consecutive empty fields — that breaks
    # parsing of rows with NULL gateway_port + NULL gateway_pid (stopped users).
    local total_rss=0 total_cpu_x10=0 count=0
    local where=""
    [[ "$filter" == "running" ]] && where="WHERE gateway_state='running' OR id=1"
    local rows
    rows=$(sqlite3 -separator '|' "$DB_PATH" "SELECT id, username, gateway_port, gateway_pid, gateway_state, master_agent_id FROM users $where ORDER BY id;")

    while IFS='|' read -r uid username db_port db_pid db_state master_id; do
      [[ -z "$uid" ]] && continue
      [[ -z "$master_id" ]] && master_id="-"

      local state_str port_str daemon_str rss_str cpu_str etime_str
      local effective_pid="$db_pid"
      local rss_kb=0 cpu="0.0"

      if [[ "$uid" -eq 1 ]]; then
        # admin gateway — fixed port
        if port_open "$ADMIN_GW_PORT"; then
          state_str="${GRN}● admin${R}"
          # discover admin gateway pid (process listening on admin port)
          local admin_pid
          admin_pid=$(awk -F'\t' '$6=="openclaw-gateway"{print $1; exit}' "$proc_tmp")
          effective_pid="$admin_pid"
          port_str="$ADMIN_GW_PORT"
        else
          state_str="${RED}✗ down${R}"
          port_str="$ADMIN_GW_PORT"
          effective_pid="-"
        fi
      else
        if [[ -z "$db_pid" || "$db_pid" == "-" ]]; then
          state_str="${D}○ stopped${R}"
          effective_pid="-"
          port_str="-"
        elif pid_alive "$db_pid" && port_open "$db_port"; then
          state_str="${GRN}● running${R}"
          # Try to find daemon pid (child of launcher); fall back to launcher.
          local daemon
          daemon=$(_daemon_pid_for_launcher "$db_pid")
          [[ -n "$daemon" ]] && effective_pid="$daemon"
          port_str="$db_port"
        elif [[ "$db_state" == "starting" ]]; then
          state_str="${YEL}▲ start${R}"
          port_str="${db_port:--}"
        else
          state_str="${RED}✗ stale${R}"
          port_str="${db_port:--}"
          effective_pid="${db_pid:--}"
        fi
      fi

      # Per-process metrics (RSS in kB, CPU %)
      if [[ "$effective_pid" != "-" ]]; then
        rss_kb=$(_proc_field "$effective_pid" 3)
        cpu=$(_proc_field "$effective_pid" 4)
        etime_str=$(_proc_field "$effective_pid" 5)
        [[ -z "$rss_kb" ]] && rss_kb=0
        [[ -z "$cpu" ]] && cpu="0.0"
        [[ -z "$etime_str" ]] && etime_str="-"
      else
        etime_str="-"
      fi

      if [[ "$rss_kb" -gt 0 ]]; then
        rss_str=$(awk -v k="$rss_kb" 'BEGIN{printf "%dMB", k/1024}')
      else
        rss_str="-"
      fi
      cpu_str="${cpu}%"

      printf "%-4s  %-22s  %-19s  %-7s  %-8s  %-5s  %-7s  %-6s  %s\n" \
        "$uid" "${username:0:22}" "$state_str" "$port_str" "$effective_pid" \
        "$rss_str" "$cpu_str" "${etime_str:0:6}" "$master_id"

      if [[ "$rss_kb" -gt 0 ]]; then
        total_rss=$((total_rss + rss_kb))
        # bash can't do float; multiply cpu by 10 and sum
        local cpu_x10
        cpu_x10=$(awk -v c="$cpu" 'BEGIN{printf "%d", c*10}')
        total_cpu_x10=$((total_cpu_x10 + cpu_x10))
        count=$((count + 1))
      fi
    done <<< "$rows"

    printf '%0.s─' {1..96}; echo
    if [[ $count -gt 0 ]]; then
      local total_rss_mb=$((total_rss / 1024))
      local total_cpu
      total_cpu=$(awk -v t="$total_cpu_x10" 'BEGIN{printf "%.1f", t/10}')
      printf "${B}Total: %d alive gateway(s)  RSS=%dMB (%.1fGB)  CPU=%s%%${R}\n" \
        "$count" "$total_rss_mb" "$(awk -v m=$total_rss_mb 'BEGIN{printf "%.1f", m/1024}')" "$total_cpu"
    fi
    echo
    echo -e "${D}Ctrl+C to exit • refresh in ${interval}s${R}"

    rm -f "$proc_tmp"

    [[ $once -eq 1 ]] && break
    sleep "$interval"
  done
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
  local cmd="${1:-list}"
  case "$cmd" in
    -h|--help|help) usage; exit 0 ;;
    list|"")        cmd_list ;;
    status)         cmd_status "${2:-}" ;;
    start)          shift; cmd_start  "$@" ;;
    stop)           shift; cmd_stop   "$@" ;;
    restart)        shift; cmd_restart "$@" ;;
    watch|top)      shift; cmd_watch "$@" ;;
    sweep)          shift; cmd_sweep "$@" ;;
    logs)           cmd_logs   "${2:-}" ;;
    orphans)        cmd_orphans ;;
    *)              warn "Unknown command: $cmd"; usage; exit 1 ;;
  esac
}

main "$@"
