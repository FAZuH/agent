#!/usr/bin/env bash
# oc-set.sh — switch agent and/or model on an OpenCode v2 session.
# Wraps POST /api/session/{id}/agent and POST .../model (both 204, empty
# body), then verifies via GET. See SKILL.md for the API details.
set -euo pipefail

die() { printf 'oc-set: %s\n' "$1" >&2; exit 2; }

usage() {
  cat <<'EOF'
Usage: oc-set.sh SESSION [--agent NAME] [--model PROVIDER/ID[:VARIANT]]

  SESSION   session to switch (ses_…)
  --agent   agent name, e.g. chat, build, orchestrator
  --model   model as PROVIDER/ID with optional :VARIANT
            e.g. opencode/ling-3.0-flash-fin-free, litellm/free-pro-vision

At least one of --agent / --model is required. Prints the verified
agent/model afterwards.
Exit codes: 0 switched · 2 usage or API error
EOF
  exit 2
}

[[ $# -ge 1 ]] || usage
case "$1" in -h|--help) usage ;; esac
SESSION="$1"; shift

AGENT=""; MODEL=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent) AGENT="${2:?--agent needs a name}"; shift 2 ;;
    --model) MODEL="${2:?--model needs PROVIDER/ID[:VARIANT]}"; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done
[[ -n "$AGENT$MODEL" ]] || die "nothing to switch — pass --agent and/or --model"

command -v opencode2 >/dev/null || die "opencode2 not on PATH"
command -v jq >/dev/null || die "jq not on PATH"

post() { # post <path> <json> — dies unless the call succeeds (204: empty body)
  local out
  out=$(opencode2 api post "$1" --data "$2" 2>&1) || die "POST $1 failed: $out"
  if jq -e '._tag' >/dev/null 2>&1 <<<"$out"; then
    die "POST $1 rejected ($(jq -r '._tag' <<<"$out")): $(jq -r '.message // "?"' <<<"$out")"
  fi
}

if [[ -n "$AGENT" ]]; then
  post "/api/session/$SESSION/agent" "$(jq -nc --arg a "$AGENT" '{agent:$a}')"
  printf 'agent → %s\n' "$AGENT" >&2
fi

if [[ -n "$MODEL" ]]; then
  [[ "$MODEL" == */* ]] || die "--model needs PROVIDER/ID[:VARIANT] (got: $MODEL)"
  PROVIDER="${MODEL%%/*}"; REST="${MODEL#*/}"
  MID="${REST%%:*}"
  if [[ "$REST" == *:* ]]; then
    MBODY=$(jq -nc --arg p "$PROVIDER" --arg m "$MID" --arg v "${REST#*:}" \
      '{model:{providerID:$p,id:$m,variant:$v}}')
  else
    MBODY=$(jq -nc --arg p "$PROVIDER" --arg m "$MID" \
      '{model:{providerID:$p,id:$m}}')
  fi
  post "/api/session/$SESSION/model" "$MBODY"
  printf 'model → %s\n' "$MODEL" >&2
fi

CUR=$(opencode2 api get "/api/session/$SESSION" 2>/dev/null) \
  || die "verify GET failed"
jq -r '"agent=\(.data.agent) model=\(.data.model.providerID)/\(.data.model.id)"' <<<"$CUR"
