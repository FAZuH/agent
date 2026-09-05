#!/usr/bin/env bash
# oc-move.sh — re-pin an OpenCode v2 session to another project directory.
# Wraps POST /api/session/{id}/move (204, empty body), then reports
# GET /api/project/current. Prints the new directory to stdout. See SKILL.md.
set -euo pipefail

die() { printf 'oc-move: %s\n' "$1" >&2; exit 2; }

usage() {
  cat <<'EOF'
Usage: oc-move.sh SESSION DIRECTORY

  SESSION    session to move (ses_…)
  DIRECTORY  target project directory (~ and relatives are resolved)

Prints the resolved directory to stdout.
Exit codes: 0 moved · 2 usage or API error
EOF
  exit 2
}

[[ $# -eq 2 ]] || usage
case "$1" in -h|--help) usage ;; esac
SESSION="$1"
DIR="${2/#\~/$HOME}"
DIR=$(realpath -m "$DIR")
[[ -d "$DIR" ]] || die "not a directory: $2"

command -v opencode2 >/dev/null || die "opencode2 not on PATH"
command -v jq >/dev/null || die "jq not on PATH"

OUT=$(opencode2 api post "/api/session/$SESSION/move" \
  --data "$(jq -nc --arg d "$DIR" '{directory:$d}')" 2>&1) \
  || die "move POST failed: $OUT"
if jq -e '._tag' >/dev/null 2>&1 <<<"$OUT"; then
  die "move rejected ($(jq -r '._tag' <<<"$OUT")): $(jq -r '.message // "?"' <<<"$OUT")"
fi
printf 'moved %s → %s\n' "$SESSION" "$DIR" >&2

CUR=$(opencode2 api get /api/project/current 2>/dev/null || true)
printf 'project/current: %s\n' "$(jq -r '.data.directory // .data // "?"' <<<"$CUR" 2>/dev/null)" >&2
printf 'a "/" result is normal from a detached shell — the session picks up the new directory next turn\n' >&2
printf '%s\n' "$DIR"
