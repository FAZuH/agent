#!/usr/bin/env bash
# oc-msgs.sh — list an OpenCode v2 session's messages as a compact table, or
# dump one message as JSON. Newest first. See SKILL.md for the API details.
set -euo pipefail

die() { printf 'oc-msgs: %s\n' "$1" >&2; exit 2; }

usage() {
  cat <<'EOF'
Usage: oc-msgs.sh SESSION [--last N] [--full MSG_ID]

  SESSION    session to read (ses_…)
  --last N   show the N newest messages (default 15)
  --full ID  dump one message as pretty JSON instead of the table

Table columns: id, type, status, first ~90 chars of text/summary.
Exit codes: 0 ok · 2 usage or API error
EOF
  exit 2
}

[[ $# -ge 1 ]] || usage
case "$1" in -h|--help) usage ;; esac
SESSION="$1"; shift

LAST=15; FULL=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --last) LAST="${2:?--last needs a number}"; shift 2 ;;
    --full) FULL="${2:?--full needs a msg_ id}"; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done

command -v opencode2 >/dev/null || die "opencode2 not on PATH"
command -v jq >/dev/null || die "jq not on PATH"

if [[ -n "$FULL" ]]; then
  opencode2 api get "/api/session/$SESSION/message/$FULL" 2>/dev/null \
    | jq '.data' || die "message GET failed: $FULL"
  exit 0
fi

# tempfile: piped `opencode2 api` output truncates at 256 KiB, which cuts any
# real session history — redirect to a file, then read it.
LIST=$(mktemp) || die "mktemp failed"
trap 'rm -f "$LIST"' EXIT
opencode2 api get "/api/session/$SESSION/message" >"$LIST" 2>/dev/null \
  || die "message GET failed"
jq -r --argjson n "$LAST" '
  (.data | if type == "array" then . else (.[] | select(type == "array")) end)
  | sort_by(.time.created // 0) | reverse | .[:$n]
  | .[] | "\(.id)\t\(.type)\t\(.status // "-")\t\(((([.content[]? | select(.type == "text") | .text] | join(" ") | select(. != "")) // (.text // .summary // "" | tostring) | gsub("\n"; " "))[0:90]))"
' "$LIST"
