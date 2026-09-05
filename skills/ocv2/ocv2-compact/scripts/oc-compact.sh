#!/usr/bin/env bash
# oc-compact.sh — compact an OpenCode v2 session and wait for the summary.
#
# Wraps POST /api/session/{id}/compact (v2.session.compact): triggers the
# compaction, then polls the created compaction message until it leaves
# "running". The summarization is a model call on the session's own model —
# typically 10-60 s. Only --summary writes a file; everything else goes to
# stderr so stdout stays clean. See SKILL.md for the API details.
#
# Exit codes: 0 completed · 1 timeout · 2 API error
set -euo pipefail

die() { printf 'oc-compact: %s\n' "$1" >&2; exit 2; }

usage() {
  cat <<'EOF'
Usage: oc-compact.sh SESSION_ID [--id MSG_ID] [--timeout SECS] [--summary FILE]

  SESSION_ID   session to compact (ses_…)
  --id MSG_ID  explicit id for the compaction message — an idempotency key,
               not a history boundary (ConflictError if that msg_ exists)
  --timeout    seconds to wait for completion (default 180; 0 = fire and
               return right after the POST)
  --summary    write the completed summary markdown to FILE

Exit codes: 0 completed · 1 timeout (still running) · 2 API error
EOF
  exit 2
}

[[ $# -ge 1 ]] || usage
case "$1" in -h|--help) usage ;; esac
SESSION="$1"; shift

MSG_ID="" TIMEOUT=180 SUMMARY_FILE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --id)      MSG_ID="${2:?--id needs a msg_ id}"; shift 2 ;;
    --timeout) TIMEOUT="${2:?--timeout needs seconds}"; shift 2 ;;
    --summary) SUMMARY_FILE="${2:?--summary needs a path}"; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done

command -v opencode2 >/dev/null || die "opencode2 not on PATH"
command -v jq >/dev/null || die "jq not on PATH"

# 1. Trigger. The body is required but every field is optional.
BODY='{}'
[[ -n "$MSG_ID" ]] && BODY=$(jq -nc --arg id "$MSG_ID" '{id: $id}')
RESP=$(opencode2 api post "/api/session/$SESSION/compact" --data "$BODY" 2>&1) \
  || die "compact POST failed: $RESP"
if jq -e '._tag' >/dev/null <<<"$RESP" 2>/dev/null; then
  die "compact rejected ($(jq -r '._tag' <<<"$RESP")): $(jq -r '.message // "?"' <<<"$RESP")"
fi
MSG=$(jq -r '.data.id // empty' <<<"$RESP")
[[ "$MSG" == msg_* ]] || die "unexpected response: $RESP"
printf 'compaction started: %s (session %s)\n' "$MSG" "$SESSION" >&2

get_msg() { opencode2 api get "/api/session/$SESSION/message/$MSG" 2>/dev/null; }

if [[ "$TIMEOUT" -eq 0 ]]; then
  printf 'queued (delivery steer) — not waiting. Poll: GET /api/session/%s/message/%s\n' \
    "$SESSION" "$MSG" >&2
  exit 0
fi

# 2. Poll. A steer into a running session stays status=null until that turn
# ends, then flips to running; both cases keep waiting here. A "Nothing to
# compact yet" failure means no new history since the last compaction — the
# session is already compact, so that counts as success.
deadline=$(( $(date +%s) + TIMEOUT ))
STATUS="null"
while :; do
  MSG_JSON=$(get_msg || true)
  STATUS=$(jq -r '.data.status // "null"' <<<"$MSG_JSON" 2>/dev/null || echo unknown)
  case "$STATUS" in
    completed) break ;;
    running|null|unknown) ;;
    failed)
      REASON=$(jq -r '.data.error | "\(.type): \(.message)"' <<<"$MSG_JSON" 2>/dev/null || echo 'unknown error')
      if [[ "$REASON" == *"Nothing to compact yet"* ]]; then
        printf 'nothing to compact — no new history since the last compaction\n' >&2
        exit 0
      fi
      die "compaction failed: $REASON" ;;
    *) die "compaction ended with status: $STATUS" ;;
  esac
  [[ $(date +%s) -ge $deadline ]] && {
    printf 'oc-compact: timeout after %ss — status: %s\n' "$TIMEOUT" "$STATUS" >&2
    exit 1
  }
  sleep 5
done

# 3. Report.
MSG_JSON=$(get_msg)
printf 'compaction completed: summary %s chars, recent tail %s chars\n' \
  "$(jq -r '.data.summary | length' <<<"$MSG_JSON")" \
  "$(jq -r '.data.recent | length' <<<"$MSG_JSON")" >&2
if [[ -n "$SUMMARY_FILE" ]]; then
  jq -r '.data.summary' <<<"$MSG_JSON" > "$SUMMARY_FILE"
  printf 'summary written: %s\n' "$SUMMARY_FILE" >&2
fi
