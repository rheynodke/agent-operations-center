#!/usr/bin/env bash
# =============================================================================
# gw.sh — OpenClaw Gateway Manager (direct host inspection, no server needed)
#
# Reads gateway state from SQLite DB + OS process table directly.
# Works even when AOC server is down.
#
# Usage:
#   ./scripts/gw.sh                          # list all gateway statuses
#   ./scripts/gw.sh list                     # same
#   ./scripts/gw.sh status  [userId]         # detailed status for one user
#   ./scripts/gw.sh start   <userId|all>     # start gateway
#   ./scripts/gw.sh stop    <userId|all>     # stop gateway (SIGTERM → SIGKILL)
#   ./scripts/gw.sh restart <userId|all>     # stop + start
#   ./scripts/gw.sh logs    <userId>         # tail gateway log
#   ./scripts/gw.sh orphans                  # find orphan gateway processes
# =============================================================================
set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Auto-load .env
ENV_FILE="$ROOT_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  set -o allexport
  # shellcheck disable=SC1090
  source <(grep -E '^[A-Z_][A-Z_0-9]*=.+' "$ENV_FILE" | grep -v '^#')
  set +o allexport
fi

DB_PATH="${AOC_DB_PATH:-$ROOT_DIR/data/aoc.db}"
OPENCLAW_BASE="${OPENCLAW_HOME:-$HOME/.openclaw}"
OPENCLAW_BIN="${OPENCLAW_BIN:-/opt/homebrew/bin/openclaw}"
PORT_RANGE_START=19000
PORT_RANGE_END=19999
ADMIN_GW_PORT="${GATEWAY_PORT:-18789}"

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

  # Show untracked gateway processes
  local untracked=0
  while IFS=$'\t' read -r pid port; do
    [[ -z "$pid" ]] && continue
    local db_match
    db_match=$(sql "SELECT id FROM users WHERE gateway_pid = $pid LIMIT 1;")
    [[ -n "$db_match" ]] && continue
    [[ "$port" == "$ADMIN_GW_PORT" ]] && continue
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

# ── Stop ──────────────────────────────────────────────────────────────────────
do_stop() {
  local uid="$1"
  [[ "$uid" -eq 1 ]] && { warn "uid=1 (admin) uses external gateway — stop it via systemctl/launchctl instead"; return; }

  local row
  row=$(sql "SELECT username, gateway_pid FROM users WHERE id = $uid;")
  [[ -z "$row" ]] && { warn "User $uid not found"; return; }

  IFS=$'\t' read -r username db_pid <<< "$row"
  echo -n "  [uid=$uid] $username: stopping … "

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
  [[ "$uid" -eq 1 ]] && { warn "uid=1 (admin) uses external gateway — start it via systemctl/launchctl instead"; return; }

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
resolve_uids() {
  local target="$1"
  if [[ "$target" == "all" ]]; then
    sql "SELECT id FROM users ORDER BY id;"
  elif [[ "$target" =~ ^[0-9]+$ ]]; then
    echo "$target"
  else
    local uid
    uid=$(sql "SELECT id FROM users WHERE username = '$target' LIMIT 1;")
    [[ -z "$uid" ]] && die "User '$target' not found"
    echo "$uid"
  fi
}

# ── Commands ──────────────────────────────────────────────────────────────────
cmd_stop() {
  local target="${1:-}"
  [[ -z "$target" ]] && die "Usage: gw.sh stop <userId|username|all>"
  info "Stopping gateway(s) for target='$target'"
  while IFS= read -r uid; do
    [[ -n "$uid" ]] && do_stop "$uid"
  done < <(resolve_uids "$target")
  ok "Done"
}

cmd_start() {
  local target="${1:-}"
  [[ -z "$target" ]] && die "Usage: gw.sh start <userId|username|all>"
  info "Starting gateway(s) for target='$target'"
  while IFS= read -r uid; do
    [[ -n "$uid" ]] && do_start "$uid"
  done < <(resolve_uids "$target")
  ok "Done"
}

cmd_restart() {
  local target="${1:-}"
  [[ -z "$target" ]] && die "Usage: gw.sh restart <userId|username|all>"
  info "Restarting gateway(s) for target='$target'"
  while IFS= read -r uid; do
    if [[ -n "$uid" ]]; then
      do_stop "$uid"
      do_start "$uid"
    fi
  done < <(resolve_uids "$target")
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
  echo -e "  ${CYN}gw.sh restart <uid|user|all>${R}   Restart gateway"
  echo -e "  ${CYN}gw.sh logs    <uid>${R}            Tail gateway log"
  echo -e "  ${CYN}gw.sh orphans${R}                  Find untracked gateway processes"
  echo
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
  local cmd="${1:-list}"
  case "$cmd" in
    -h|--help|help) usage; exit 0 ;;
    list|"")        cmd_list ;;
    status)         cmd_status "${2:-}" ;;
    start)          cmd_start  "${2:-}" ;;
    stop)           cmd_stop   "${2:-}" ;;
    restart)        cmd_restart "${2:-}" ;;
    logs)           cmd_logs   "${2:-}" ;;
    orphans)        cmd_orphans ;;
    *)              warn "Unknown command: $cmd"; usage; exit 1 ;;
  esac
}

main "$@"
