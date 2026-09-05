#!/usr/bin/env bash
# oc-plugins.sh — list OpenCode v2 plugin load status.
# Wraps GET /api/plugin (service mode only — plain `opencode2 serve` lists
# nothing). Exit 1 when any plugin failed, so callers can gate on it.
set -euo pipefail

die() { printf 'oc-plugins: %s\n' "$1" >&2; exit 2; }

usage() {
  cat <<'EOF'
Usage: oc-plugins.sh [--failed-only]

  --failed-only  show only failed plugins, with the head of each error

Table columns: status, id (or source package/path), source type.
Exit codes: 0 all active (or nothing listed) · 1 a plugin failed ·
            2 usage or API error
EOF
  exit 2
}

FAILED_ONLY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage ;;
    --failed-only) FAILED_ONLY=1; shift ;;
    *) die "unknown argument: $1" ;;
  esac
done

command -v opencode2 >/dev/null || die "opencode2 not on PATH"
command -v jq >/dev/null || die "jq not on PATH"

RESP=$(opencode2 api get /api/plugin 2>/dev/null) || die "plugin GET failed"
N=$(jq '(.data // []) | length' <<<"$RESP" 2>/dev/null || echo 0)
if [[ "$N" -eq 0 ]]; then
  printf 'no plugins listed — plain serve populates nothing; only the background service (--service) does\n' >&2
  exit 0
fi

if [[ "$FAILED_ONLY" -eq 1 ]]; then
  jq -r '.data[] | select(.state.status == "failed")
    | "\(.id // .source.package // .source.target // .source.path // "?")\(if .state.ref then " [" + .state.ref + "]" else "" end)\n  \(((.state.error // .error // "no error text") | tostring | gsub("\n"; " "))[0:300])"' \
    <<<"$RESP"
else
  jq -r '.data[] | "\(.state.status)\t\(.id // .source.package // .source.target // .source.path // "?")\t(\(.source.type))"' \
    <<<"$RESP"
fi

FAILED=$(jq '[.data[] | select(.state.status == "failed")] | length' <<<"$RESP")
[[ "$FAILED" -eq 0 ]] && exit 0
printf '%s plugin(s) failed\n' "$FAILED" >&2
exit 1
