#!/bin/bash
# found_watcher.sh — Discord-ping the moment a *FOUND* sentinel appears.
# Reads the webhook URL at runtime from a secrets file; never prints it.
# One notification per file; retries failed sends next cycle.
set -u

# ── CONFIG ────────────────────────────────────────────────────────────────
WORKDIR=/path/to/workspace
KEYFILE="$HOME/.secrets/webhook-discord-notify.key"  # line 1 = webhook URL, line 2 = user id
LOG="$WORKDIR/watcher.log"
CYCLE=20
# ──────────────────────────────────────────────────────────────────────────

notified=""
log() { echo "[$(date '+%F %T')] $*" >> "$LOG"; }
log "watcher started (pid $$)"

while true; do
  for f in "$WORKDIR"/*FOUND*.txt; do
    [ -e "$f" ] || continue
    b=$(basename "$f")
    case " $notified " in *" $b "*) continue ;; esac
    body=$(head -c 800 "$f")
    url=$(sed -n 1p "$KEYFILE")
    uid=$(sed -n 2p "$KEYFILE")
    payload=$(jq -nc --arg t "HIT: $b" \
      --arg d "Verify with ONE test, then wait for user approval — change nothing.

Contents:
$body" \
      --arg c "🚨 $b
<@$uid>" \
      '{content: $c, embeds: [{title: $t, description: ($d[0:1500]), color: 3066099}]}')
    if curl -sf -o /dev/null --max-time 10 -H 'Content-Type: application/json' -d "$payload" "$url"; then
      log "NOTIFIED $b"
    else
      log "ERR notify failed for $b — retrying next cycle"
      continue
    fi
    notified="$notified $b"
  done
  sleep "$CYCLE"
done
