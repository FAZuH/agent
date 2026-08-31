#!/usr/bin/env bash
# set-agent-model.sh — set the `model:` field of subagent .md files, then push.
# Default scope: agents/build and agents/review (the cheap build/review tier).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  B=$'\e[1m' DIM=$'\e[2m' GRN=$'\e[32m' YLW=$'\e[33m' RED=$'\e[31m' R=$'\e[0m'
else
  B="" DIM="" GRN="" YLW="" RED="" R=""
fi
die() { printf '%s✗ error:%s %s\n' "$RED" "$R" "$1" >&2; exit 1; }

usage() {
  cat <<EOF
${B}set-agent-model.sh${R} — set the \`model:\` field of subagent .md files, then push.

${B}Usage:${R}
  set-agent-model.sh <model-id> [agent-dir ...]

  model-id    e.g. cline/z-ai/glm-5.3-flash
  agent-dir   dirs of agent .md files to edit
              (default: agents/build agents/review)

After editing, runs \`sync.sh push -g agents\` to deploy to the global config.

${B}Examples:${R}
  ./set-agent-model.sh cline/z-ai/glm-5.3-flash
  ./set-agent-model.sh opencode/muse-spark-1.2-contributor-free agents/vision
EOF
}

[[ $# -ge 1 ]] || { usage; echo; die "a model id is required"; }
case "$1" in -h|--help) usage; exit 0 ;; esac
MODEL="$1"
[[ -n "$MODEL" ]] || die "model id must not be empty"
[[ "$MODEL" =~ [[:space:]] ]] && die "model id must not contain spaces: $MODEL"
shift

DIRS=()
if [[ $# -gt 0 ]]; then DIRS=("$@"); else DIRS=(agents/build agents/review); fi

FILES=()
for d in "${DIRS[@]}"; do
  [[ "$d" == "$REPO" || "$d" == "$REPO"/* ]] || d="$REPO/$d"
  [[ -d "$d" ]] || die "not a directory: $d"
  for f in "$d"/*.md; do
    [[ -f "$f" ]] && FILES+=("$f")
  done
done
[[ ${#FILES[@]} -gt 0 ]] || die "no .md agent files under: ${DIRS[*]}"

printf '%sSetting model:%s %s\n' "$B" "$R" "$MODEL"
for f in "${FILES[@]}"; do
  rel="${f#"$REPO"/}"
  old="$(grep -m1 '^model:' "$f" 2>/dev/null || true)"
  if [[ "$old" == "model: $MODEL" ]]; then
    printf '  %s·%s %s already %s\n' "$DIM" "$R" "$rel" "$MODEL"
    continue
  fi
  tmp="$(mktemp)"
  # Frontmatter-only surgery: replace an existing `model:` line, or insert one
  # after `mode: subagent` (fallback: just before the closing `---`).
  if ! awk -v m="model: $MODEL" '
      NR == 1 && /^---[ \t]*$/ { infm = 1; print; next }
      infm && /^---[ \t]*$/ {
        infm = 0
        if (!done) { print m; done = 1 }
        print; next
      }
      infm && /^model:/ {
        if (!done) { print m; done = 1 }   # replace first, drop any further
        next
      }
      infm && /^mode:[ \t]*subagent/ && !done { print; print m; done = 1; next }
      { print }
      END { exit done ? 0 : 3 }
    ' "$f" > "$tmp"; then
    rm -f "$tmp"
    die "$rel: no 'model:' or 'mode: subagent' anchor in frontmatter — edit it by hand"
  fi
  mv "$tmp" "$f"
  oldv="${old#model: }"
  [[ -n "$oldv" ]] || oldv="(none)"
  printf '  %s✔%s %s: %s%s%s -> %s\n' "$GRN" "$R" "$rel" "$DIM" "$oldv" "$R" "$MODEL"
done

printf '\n%sPushing agents -> global%s\n' "$B" "$R"
exec "$REPO/sync.sh" push -g agents
