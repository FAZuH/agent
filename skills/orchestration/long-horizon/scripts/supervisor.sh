#!/bin/bash
# supervisor.sh — keep resume-safe workers running through network blips.
# Template from a battle-tested overnight run (2026-09-05/06). Copy, edit
# CONFIG, launch detached. Workers must be resume-safe (progress files) and
# write *_EXHAUSTED.txt / *_FOUND.txt sentinels.
set -u

# ── CONFIG ────────────────────────────────────────────────────────────────
WORKDIR=/path/to/workspace
LOG="$WORKDIR/supervisor.log"
HEALTH_TARGET=10.0.0.1        # ping target for the health gate
CYCLE=300                     # seconds between passes
# one line per worker: NAME|PGREP_MATCH|CMD|EXHAUSTED_SENTINEL
WORKERS=(
  "jobA|job_a.py|python3 $WORKDIR/job_a.py|$WORKDIR/JOBA_EXHAUSTED.txt"
  "jobB|job_b.py|python3 $WORKDIR/job_b.py|$WORKDIR/JOBB_EXHAUSTED.txt"
)
# ──────────────────────────────────────────────────────────────────────────

log() { echo "[$(date '+%H:%M:%S')] $*" >> "$LOG"; }

while true; do
  # health gate: 2-of-3 pings before touching anything
  ok=0
  for _ in 1 2 3; do
    ping -c 1 -W 2 "$HEALTH_TARGET" >/dev/null 2>&1 && ok=$((ok+1))
  done

  if [ "$ok" -ge 2 ]; then
    for w in "${WORKERS[@]}"; do
      IFS='|' read -r name match cmd sentinel <<< "$w"
      [ -f "$sentinel" ] && continue            # exhausted: stop restarting
      pgrep -f "$match" >/dev/null && continue  # already running
      log "network ok; restarting $name"
      setsid nohup bash -c "$cmd" >> "$WORKDIR/${name}_run.log" 2>&1 < /dev/null &
      log "spawned $name pid=$!"                # PID per spawn: double-spawns decidable
      disown
    done

    # hit: stop everything, exit (the watcher notifies separately)
    for f in "$WORKDIR"/*FOUND*.txt; do
      [ -e "$f" ] || continue
      log "*** FOUND: $f — stopping supervisor ***"
      for w in "${WORKERS[@]}"; do
        IFS='|' read -r name match cmd sentinel <<< "$w"
        pgrep -f "$match" | xargs -r kill      # explicit PIDs, never pkill -f
      done
      exit 0
    done

    # all tracks done?
    all_done=1
    for w in "${WORKERS[@]}"; do
      IFS='|' read -r name match cmd sentinel <<< "$w"
      [ -f "$sentinel" ] || all_done=0
    done
    [ "$all_done" -eq 1 ] && { log "all workers exhausted — supervisor exiting"; exit 0; }
  else
    log "network degraded (ok=$ok/3) — not starting workers"
  fi
  sleep "$CYCLE"
done
