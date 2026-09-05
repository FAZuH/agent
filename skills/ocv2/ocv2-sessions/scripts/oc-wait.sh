#!/usr/bin/env bash
# oc-wait.sh — wait for an OpenCode v2 session's turn to finish.
# Polls GET /api/session/{id} .data.outcome (the /wait endpoint is
# unavailable on the deployed server). Prints the final outcome.
set -euo pipefail

die() { printf 'oc-wait: %s\n' "$1" >&2; exit 2; }

usage() {
  cat <<'EOF'
Usage: oc-wait.sh SESSION [--timeout SECS]

  SESSION   session to watch (ses_…)
  --timeout seconds to wait (default 600)

Prints "outcome: <succeeded|failed> (<elapsed>s)".
Exit codes: 0 turn succeeded · 1 turn failed or timeout · 2 usage/API error
EOF
  exit 2
}

[[ $# -ge 1 ]] || usage
case "$1" in -h|--help) usage ;; esac
SESSION="$1"; shift

TIMEOUT=600
while [[ $# -gt 0 ]]; do
  case "$1" in
    --timeout) TIMEOUT="${2:?--timeout needs seconds}"; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done

command -v opencode2 >/dev/null || die "opencode2 not on PATH"
command -v jq >/dev/null || die "jq not on PATH"

get_outcome() {
  local cur
  cur=$(opencode2 api get "/api/session/$SESSION" 2>/dev/null || true)
  if jq -e '._tag' >/dev/null 2>&1 <<<"$cur"; then
    die "session GET rejected ($(jq -r '._tag' <<<"$cur")): $(jq -r '.message // "?"' <<<"$cur")"
  fi
  jq -r '.data.outcome // empty' <<<"$cur" 2>/dev/null || true
}

START=$(date +%s)
DEADLINE=$((START + TIMEOUT))

# A prompt steered into an idle session can take a few seconds to start; a
# terminal outcome on the very first poll may belong to the previous turn.
FIRST_OUTCOME=$(get_outcome)
if [[ "$FIRST_OUTCOME" == succeeded || "$FIRST_OUTCOME" == failed ]]; then
  sleep 8
  LATER=$(get_outcome)
  [[ -n "$LATER" && "$LATER" != "$FIRST_OUTCOME" ]] && FIRST_OUTCOME="$LATER"
  case "$FIRST_OUTCOME" in
    succeeded) printf 'outcome: succeeded (%ss)\n' "$(( $(date +%s) - START ))"; exit 0 ;;
    failed)    printf 'outcome: failed (%ss)\n' "$(( $(date +%s) - START ))"; exit 1 ;;
  esac
fi

while :; do
  OUTCOME=$(get_outcome)
  case "$OUTCOME" in
    succeeded) printf 'outcome: succeeded (%ss)\n' "$(( $(date +%s) - START ))"; exit 0 ;;
    failed)    printf 'outcome: failed (%ss)\n' "$(( $(date +%s) - START ))"; exit 1 ;;
  esac
  if [[ $(date +%s) -ge $DEADLINE ]]; then
    printf 'oc-wait: timeout after %ss — last outcome: %s\n' \
      "$TIMEOUT" "${OUTCOME:-none}" >&2
    exit 1
  fi
  sleep 5
done
