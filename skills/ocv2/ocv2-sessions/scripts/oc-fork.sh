#!/usr/bin/env bash
# oc-fork.sh — fork an OpenCode v2 session (copy projected history at a boundary).
# Wraps POST /api/session/{id}/fork (v2.session.fork). Prints the child id to
# stdout (safe for $(...)); progress goes to stderr. See SKILL.md for details.
set -euo pipefail

die() { printf 'oc-fork: %s\n' "$1" >&2; exit 2; }

usage() {
  cat <<'EOF'
Usage: oc-fork.sh SESSION [--through MSG] [--before MSG]

  SESSION       source session (ses_…)
  --through MSG copy history through MSG, inclusive (default: latest message)
  --before MSG  copy history before MSG (excludes it)

Prints the child session id to stdout.
Exit codes: 0 forked · 2 usage or API error
EOF
  exit 2
}

[[ $# -ge 1 ]] || usage
case "$1" in -h|--help) usage ;; esac
SESSION="$1"; shift

BODY='{"boundary":{"type":"through"}}'
while [[ $# -gt 0 ]]; do
  case "$1" in
    --through) BODY=$(jq -nc --arg m "${2:?--through needs a msg_ id}" '{boundary:{type:"through",messageID:$m}}'); shift 2 ;;
    --before)  BODY=$(jq -nc --arg m "${2:?--before needs a msg_ id}" '{boundary:{type:"before",messageID:$m}}'); shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done

command -v opencode2 >/dev/null || die "opencode2 not on PATH"
command -v jq >/dev/null || die "jq not on PATH"

RESP=$(opencode2 api post "/api/session/$SESSION/fork" --data "$BODY" 2>&1) \
  || die "fork POST failed: $RESP"
if jq -e '._tag' >/dev/null 2>&1 <<<"$RESP"; then
  die "fork rejected ($(jq -r '._tag' <<<"$RESP")): $(jq -r '.message // "?"' <<<"$RESP")"
fi
CHILD=$(jq -r '.data.id // empty' <<<"$RESP")
[[ "$CHILD" == ses_* ]] || die "unexpected response: $RESP"
printf 'forked %s from %s\n' "$CHILD" "$SESSION" >&2
printf '%s\n' "$CHILD"
