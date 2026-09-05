#!/usr/bin/env bash
# oc-status.sh — one-line status of an OpenCode v2 session.
# GET /api/session/{id} → compact JSON: agent, model, outcome, tokens, cost.
set -euo pipefail

die() { printf 'oc-status: %s\n' "$1" >&2; exit 2; }

usage() {
  cat <<'EOF'
Usage: oc-status.sh SESSION

  SESSION   session to inspect (ses_…)

Prints one compact JSON object to stdout.
Exit codes: 0 ok · 2 usage or API error
EOF
  exit 2
}

[[ $# -ge 1 ]] || usage
case "$1" in -h|--help) usage ;; esac
SESSION="$1"; shift
[[ $# -eq 0 ]] || die "unknown argument: $1"

command -v opencode2 >/dev/null || die "opencode2 not on PATH"
command -v jq >/dev/null || die "jq not on PATH"

CUR=$(opencode2 api get "/api/session/$SESSION" 2>/dev/null) \
  || die "session GET failed"
if jq -e '._tag' >/dev/null 2>&1 <<<"$CUR"; then
  die "session GET rejected ($(jq -r '._tag' <<<"$CUR")): $(jq -r '.message // "?"' <<<"$CUR")"
fi
jq -c '{
  id: .data.id,
  agent: .data.agent,
  model: "\(.data.model.providerID)/\(.data.model.id)",
  variant: (.data.model.variant // null),
  outcome: (.data.outcome // null),
  idle: (.data.time.idle // null),
  tokens: {input: .data.tokens.input, output: .data.tokens.output},
  cost: .data.cost
}' <<<"$CUR"
