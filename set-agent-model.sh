#!/usr/bin/env bash
# set-agent-model.sh — upsert model keys in .agent-values, then push.
# Model values live in the gitignored .agent-values file; the repo agent files
# carry {{KEY}} placeholders that sync.sh substitutes on push.
#
# Default scope: BUILD_MODEL + REVIEW_MODEL (the build/review subagent tier).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VALUES="$REPO/.agent-values"

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  B=$'\e[1m' DIM=$'\e[2m' GRN=$'\e[32m' YLW=$'\e[33m' RED=$'\e[31m' R=$'\e[0m'
else
  B="" DIM="" GRN="" YLW="" RED="" R=""
fi
die() { printf '%s✗ error:%s %s\n' "$RED" "$R" "$1" >&2; exit 1; }

usage() {
  cat <<EOF
${B}set-agent-model.sh${R} — set subagent model values, then push the agents top.

${B}Usage:${R}
  set-agent-model.sh <model-id>              # BUILD_MODEL + REVIEW_MODEL
  set-agent-model.sh --key <KEY> <model-id>  # any single key

  model-id    e.g. cline/z-ai/glm-5.3-flash
  KEY         e.g. SVG_MAKER_MODEL, AUTOCOMMIT_MODEL, MERMAID_MAKER_MODEL

Values are stored in .agent-values (gitignored); agent files in the repo carry
{{KEY}} placeholders and sync.sh substitutes them at push time. After the
upsert this runs \`sync.sh push -g agents\` to deploy.

${B}Examples:${R}
  ./set-agent-model.sh cline/z-ai/glm-5.3-flash
  ./set-agent-model.sh --key SVG_MAKER_MODEL commandcode/Qwen/Qwen3.7-Flash
EOF
}

MODE="tier"
if [[ "${1:-}" == "--key" ]]; then
  MODE="single"; shift
  [[ $# -ge 2 ]] || { usage; echo; die "--key needs a KEY and a model id"; }
  KEY="$1"; MODEL="$2"; shift 2
else
  [[ $# -ge 1 ]] || { usage; echo; die "a model id is required"; }
  MODEL="$1"; shift
fi
[[ "$MODEL" =~ [[:space:]] ]] && die "model id must not contain spaces: $MODEL"
[[ "$MODEL" == *"="* ]] && die "model id must not contain '=': $MODEL"
[[ $# -eq 0 ]] || die "unexpected extra argument: $1"

upsert() { # <key> <value>
  local key="$1" value="$2"
  [[ -f "$VALUES" ]] || {
    printf '# .agent-values — machine-local values for {{KEY}} placeholders (gitignored)\n' > "$VALUES"
  }
  if grep -q "^${key}=" "$VALUES"; then
    local tmp
    tmp="$(mktemp)"
    sed "s|^${key}=.*|${key}=${value}|" "$VALUES" > "$tmp"
    mv "$tmp" "$VALUES"
  else
    printf '%s=%s\n' "$key" "$value" >> "$VALUES"
  fi
}

if [[ "$MODE" == "single" ]]; then
  [[ "$KEY" =~ ^[A-Z][A-Z0-9_]*$ ]] || die "invalid key: $KEY (expected UPPER_SNAKE)"
  printf '%s%s%s = %s%s%s -> %s\n' "$B" "$KEY" "$R" "$DIM" \
    "$(grep -m1 "^${KEY}=" "$VALUES" 2>/dev/null | cut -d= -f2- || true)" "$R" "$MODEL"
  upsert "$KEY" "$MODEL"
  exec "$REPO/sync.sh" push -g agents
fi

printf '%sBUILD_MODEL, REVIEW_MODEL%s -> %s\n' "$B" "$R" "$MODEL"
upsert BUILD_MODEL "$MODEL"
upsert REVIEW_MODEL "$MODEL"
exec "$REPO/sync.sh" push -g agents
