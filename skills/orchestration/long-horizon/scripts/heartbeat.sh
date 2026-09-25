#!/bin/bash
# heartbeat.sh — external watchdog that wakes an idle orchestrator session.
# Template from a battle-tested overnight run (2026-09-05/06). Copy, edit
# CONFIG, launch detached. See long-horizon SKILL.md for the procedure.
#
# Wakes the orchestrator via POST /api/session/<id>/prompt (steer delivery =
# queued until idle) on: sentinel file events, child outcome transitions,
# child stalls, rig-unit death, and a keep-alive timer (burst-suppressed).
#
# State:  $STATE (markers, children.txt, last_wake)
# Stop:   touch $STATE/STOP        (script exits; rm to resume)
# Test:   heartbeat.sh --test      (sends one wake and exits)
set -u

# ── CONFIG ────────────────────────────────────────────────────────────────
STATE=/tmp/opencode/heartbeat              # marker dir (created if missing)
WORKDIR=/path/to/workspace                 # where *FOUND*/*EXHAUSTED* sentinels appear
ME=ses_XXXXXXXX                            # orchestrator session to wake
WORK_NAME="the <project> run"              # appears in wake prompts
CHECKPOINT="$WORKDIR/checkpoint.md"        # what every wake tells the session to read
RULES="no config changes without user approval; on any *FOUND* hit verify with ONE test, notify the user, change nothing; "
UNITS=()                                   # systemd user units to watch, e.g. (bgrun-my-supervisor.service)
KEEPALIVE_EVERY=1800                       # idle seconds before a keep-alive wake
STALL_AFTER=2700                           # child silence seconds before a stall wake
POLL=45                                    # loop interval seconds
LOG="$STATE/heartbeat.log"
# ──────────────────────────────────────────────────────────────────────────

mkdir -p "$STATE"
CHILDREN_FILE="$STATE/children.txt"
[ -f "$CHILDREN_FILE" ] || : > "$CHILDREN_FILE"

log() { echo "[$(date '+%m-%d %H:%M:%S')] $*" >> "$LOG"; }

wake() { # wake "<reasons>" -> 0 on success
  local text body
  text="HEARTBEAT wake — $1 — You are the orchestrator for $WORK_NAME. Read $CHECKPOINT and the session-record ledger first. Standing rules: $RULES Act on the wake reason, update the session record with what you did, then end your turn — the heartbeat will wake you again. If nothing is actionable, do a light status pass (children, workers, units) and end your turn."
  body=$(jq -nc --arg t "$text" '{text: $t}')
  if opencode2 api post "/api/session/$ME/prompt" --data "$body" >/dev/null 2>&1; then
    date +%s > "$STATE/last_wake"
    log "WOKE: $1"
    return 0
  fi
  log "wake FAILED (api): $1"
  return 1
}

if [ "${1:-}" = "--test" ]; then
  wake "PIPELINE TEST (ignore — mechanism validation)"
  exit $?
fi

reasons=()
pend_markers=()
pend() { reasons+=("$1"); pend_markers+=("$2"); }

while true; do
  [ -f "$STATE/STOP" ] && { log "STOP present — exiting"; exit 0; }
  now=$(date +%s)
  reasons=()
  pend_markers=()

  # 1) sentinel file events
  for f in "$WORKDIR"/*FOUND*.txt "$WORKDIR"/*EXHAUSTED.txt; do
    [ -e "$f" ] || continue
    b=$(basename "$f")
    [ -f "$STATE/$b" ] || pend "FILE EVENT: $b appeared" "$STATE/$b"
  done

  # 2) children: outcome transitions + stalls
  while read -r s; do
    [ -n "$s" ] || continue
    out=$(opencode2 api get "/api/session/$s" 2>/dev/null | jq -r '.data.outcome // "busy"' 2>/dev/null)
    if [ "$out" = "succeeded" ] || [ "$out" = "failed" ]; then
      [ -f "$STATE/$s.done" ] || pend "child $s finished (outcome=$out) — read its report, integrate into the session record, re-dispatch if failed (then rm $STATE/$s.done)" "$STATE/$s.done"
    else
      # busy: stall detection via newest message timestamp
      last=$(opencode2 api get "/api/session/$s/message" 2>/dev/null | jq '[.data[]?.time.created] | max // 0' 2>/dev/null)
      case "${last:-0}" in
        ''|0) : ;;  # api hiccup this pass — skip, never false-alarm on it
        *)
          prev=$(cat "$STATE/$s.lastmsg" 2>/dev/null || echo 0)
          if [ "$last" -gt "$prev" ] 2>/dev/null; then
            echo "$last" > "$STATE/$s.lastmsg"
            rm -f "$STATE/$s.stalled"
          else
            idle=$(( now - last / 1000 ))
            sm="$STATE/$s.stalled"
            if [ "$idle" -ge "$STALL_AFTER" ]; then
              mt=$(stat -c %Y "$sm" 2>/dev/null || echo 0)
              # alert once per stall episode; re-notify hourly while stalled
              if [ ! -f "$sm" ] || [ $(( now - mt )) -ge 3600 ]; then
                pend "child $s idle ${idle}s — verify liveness before any interrupt; long builds are normal" "$sm"
              fi
            fi
          fi ;;
      esac
    fi
  done < "$CHILDREN_FILE"

  # 3) rig units alive
  for u in "${UNITS[@]}"; do
    if ! systemctl --user is-active --quiet "$u" 2>/dev/null; then
      [ -f "$STATE/unit-$u" ] || pend "RIG: $u is not active — investigate and restart" "$STATE/unit-$u"
    else
      rm -f "$STATE/unit-$u"
    fi
  done

  # 4) keep-alive — burst-suppressed: skip while a previous wake is still
  #    pending in the inbox (queued wakes arrive as one burst on resume).
  #    Fails open: an inbox API hiccup reads as 0 pending and lets the
  #    keep-alive through; event-driven wakes above are never throttled.
  me_out=$(opencode2 api get "/api/session/$ME" 2>/dev/null | jq -r '.data.outcome // "busy"' 2>/dev/null)
  lw=$(cat "$STATE/last_wake" 2>/dev/null || echo 0)
  if [ "$me_out" != "busy" ] && [ $(( now - lw )) -ge $KEEPALIVE_EVERY ]; then
    pending=$(opencode2 api get "/api/session/$ME/inbox" 2>/dev/null | jq '[.data[]?] | length' 2>/dev/null)
    if [ "${pending:-0}" -eq 0 ] 2>/dev/null; then
      reasons+=("keep-alive (no wake in $(( now - lw ))s, parent idle) — light status pass: children, workers, units")
    else
      log "keep-alive suppressed ($pending wake(s) still pending)"
    fi
  fi

  # fire
  if [ ${#reasons[@]} -gt 0 ]; then
    if wake "${reasons[*]}"; then
      for m in "${pend_markers[@]}"; do touch "$m"; done
    fi
    # on failure: markers untouched -> retried next pass
  fi

  sleep "$POLL"
done
