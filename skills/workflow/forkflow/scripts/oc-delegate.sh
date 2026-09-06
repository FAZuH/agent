#!/usr/bin/env bash
# oc-delegate.sh — one-shot warm delegation: fork → switch agent → prompt → wait.
# Implements the @forkflow handoff in a single call. Reuses the ocv2-sessions
# scripts (resolved in both the repo layout and the flattened deploy layout).
# Only the child's reply text goes to stdout; everything else goes to stderr.
# Message-list GETs go through a tempfile: piped `opencode2 api` output cuts
# off at 256 KiB, which truncates any real session history.
set -euo pipefail

die() { printf 'oc-delegate: %s\n' "$1" >&2; exit 2; }

usage() {
  cat <<'EOF'
Usage: oc-delegate.sh SOURCE --agent NAME (--through MSG | --before MSG)
                     (--prompt TEXT | --prompt-file FILE)
                     [--model PROVIDER/ID[:VARIANT]] [--timeout SECS]

  SOURCE              parent session (ses_…)
  --agent NAME        subagent for the child (required)
  --through/--before MSG  explicit fork boundary (required, never a bare fork)
  --prompt/--prompt-file  first prompt for the child (required)
  --model M           optional model switch, PROVIDER/ID[:VARIANT]
  --timeout SECS      wait budget in seconds (default 600)

Fork → switch agent → first prompt, in that order; then wait and print the
child's reply. Exit 0 only when the child turn succeeds.
Exit codes: 0 succeeded · 1 child failed · 3 wait budget expired, child
still running (re-arm: oc-wait.sh CHILD) · 2 usage or API error
EOF
  exit 2
}

[[ $# -ge 1 ]] || usage
case "$1" in -h|--help) usage ;; esac
SOURCE="$1"; shift

AGENT=""; BOUNDARY=""; BOUNDARY_MSG=""; PTEXT=""; PFILE=""; MODEL=""; TIMEOUT=600
while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent) AGENT="${2:?--agent needs a name}"; shift 2 ;;
    --through) BOUNDARY=through; BOUNDARY_MSG="${2:?--through needs a msg_ id}"; shift 2 ;;
    --before) BOUNDARY=before; BOUNDARY_MSG="${2:?--before needs a msg_ id}"; shift 2 ;;
    --prompt) PTEXT="$2"; shift 2 ;;
    --prompt-file) PFILE="${2:?--prompt-file needs a path}"; shift 2 ;;
    --model) MODEL="${2:?--model needs PROVIDER/ID[:VARIANT]}"; shift 2 ;;
    --timeout) TIMEOUT="${2:?--timeout needs seconds}"; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done
[[ -n "$AGENT" ]] || die "--agent is required"
[[ -n "$BOUNDARY" ]] || die "an explicit boundary is required (--through or --before MSG)"
[[ -n "$PTEXT$PFILE" ]] || die "a first prompt is required (--prompt or --prompt-file)"

command -v opencode2 >/dev/null || die "opencode2 not on PATH"
command -v jq >/dev/null || die "jq not on PATH"

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SESS=""
for cand in "$HERE/../../../ocv2/ocv2-sessions/scripts" "$HERE/../../ocv2-sessions/scripts"; do
  if [[ -x "$cand/oc-fork.sh" ]]; then SESS="$cand"; break; fi
done
[[ -n "$SESS" ]] || die "ocv2-sessions scripts not found — sync the ocv2-sessions skill first"

CHILD=$("$SESS/oc-fork.sh" "$SOURCE" "--$BOUNDARY" "$BOUNDARY_MSG") || exit 2
printf 'child: %s\n' "$CHILD" >&2

if [[ -n "$MODEL" ]]; then
  "$SESS/oc-set.sh" "$CHILD" --agent "$AGENT" --model "$MODEL" >&2 || exit 2
else
  "$SESS/oc-set.sh" "$CHILD" --agent "$AGENT" >&2 || exit 2
fi

if [[ -n "$PFILE" ]]; then
  "$SESS/oc-prompt.sh" "$CHILD" --file "$PFILE" >&2 || exit 2
else
  "$SESS/oc-prompt.sh" "$CHILD" "$PTEXT" >&2 || exit 2
fi

set +e
"$SESS/oc-wait.sh" "$CHILD" --timeout "$TIMEOUT" >&2
RC=$?
set -e
if [[ $RC -eq 3 ]]; then
  printf 'oc-delegate: timed out — child %s still running; re-arm with: oc-wait.sh %s\n' \
    "$CHILD" "$CHILD" >&2
  exit 3
elif [[ $RC -ne 0 ]]; then
  exit 1
fi

MSG_TMP=$(mktemp) || die "mktemp failed"
trap 'rm -f "$MSG_TMP"' EXIT
opencode2 api get "/api/session/$CHILD/message" >"$MSG_TMP" 2>/dev/null || true
LAST=$(jq -c '((.data | if type == "array" then . else (.[] | select(type == "array")) end)
  | map(select(.type == "assistant")) | sort_by(.time.created // 0) | last) // empty' \
  "$MSG_TMP" 2>/dev/null || true)
RID=$(jq -r '.id // empty' <<<"$LAST" 2>/dev/null || true)
RTEXT=$(jq -r '((([.content[]? | select(.type == "text") | .text] | join(" ") | select(. != "")) // (.text // "")) | tostring)' <<<"$LAST" 2>/dev/null || true)
if [[ -z "$RID" ]]; then
  die "turn succeeded but no assistant reply found (inspect: oc-msgs.sh $CHILD)"
fi
printf 'reply: %s\n' "$RID" >&2
if [[ -n "$RTEXT" ]]; then
  printf '%s\n' "$RTEXT"
else
  printf '(no extractable text — dump with: oc-msgs.sh %s --full %s)\n' "$CHILD" "$RID" >&2
fi
