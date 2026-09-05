#!/usr/bin/env bash
# oc-prompt.sh — send a prompt to an OpenCode v2 session.
# Wraps POST /api/session/{id}/prompt. Prints the user message id to stdout
# (safe for $(...)); delivery goes to stderr. See SKILL.md for details.
set -euo pipefail

die() { printf 'oc-prompt: %s\n' "$1" >&2; exit 2; }

usage() {
  cat <<'EOF'
Usage: oc-prompt.sh SESSION TEXT | --file FILE

  SESSION   target session (ses_…)
  TEXT      prompt text (positional), or --file FILE for multiline /
            quoting-sensitive text

Prints the created user message id to stdout.
Exit codes: 0 sent · 2 usage or API error
EOF
  exit 2
}

[[ $# -ge 1 ]] || usage
case "$1" in -h|--help) usage ;; esac
SESSION="$1"; shift

TEXT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --file) TEXT=$(cat "${2:?--file needs a path}"); shift 2 ;;
    -h|--help) usage ;;
    --*) die "unknown argument: $1" ;;
    *) TEXT="$1"; shift ;;
  esac
done
[[ -n "$TEXT" ]] || die "no prompt text — pass TEXT or --file FILE"

command -v opencode2 >/dev/null || die "opencode2 not on PATH"
command -v jq >/dev/null || die "jq not on PATH"

BODY=$(jq -nc --arg t "$TEXT" '{text:$t}')
RESP=$(opencode2 api post "/api/session/$SESSION/prompt" --data "$BODY" 2>&1) \
  || die "prompt POST failed: $RESP"
if jq -e '._tag' >/dev/null 2>&1 <<<"$RESP"; then
  die "prompt rejected ($(jq -r '._tag' <<<"$RESP")): $(jq -r '.message // "?"' <<<"$RESP")"
fi
MID=$(jq -r '.data.id // empty' <<<"$RESP")
[[ "$MID" == msg_* ]] || die "unexpected response: $RESP"
printf 'prompted %s (delivery %s)\n' "$MID" "$(jq -r '.data.delivery // "?"' <<<"$RESP")" >&2
printf '%s\n' "$MID"
