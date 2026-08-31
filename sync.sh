#!/usr/bin/env bash
# agent — sync. Copies repo items (skills, agents, plugins, commands) into
# OpenCode config dirs. Repo is the source of truth; targets hold copies.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GLOBAL_CFG="$HOME/.config/opencode"
MANIFEST="$REPO/.agent-sync.json"
VALUES_FILE="${AGENT_VALUES:-$REPO/.agent-values}"
TARGETS_CONF="$REPO/targets.conf"
AGENTS_SKILLS="$HOME/.agents/skills"
TOPS=(skills agents plugins commands)

DRY=0
FORCE=0
COMMAND=""
SUB_CMD=""
TARGET_NAME=""      # as given: "global", a targets.conf name, or a path
TARGET=""           # resolved config dir
TOPS_SEL=()

# ── output helpers (colors on TTY only, respect NO_COLOR) ────────────────────
if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  B=$'\e[1m' DIM=$'\e[2m' GRN=$'\e[32m' YLW=$'\e[33m' RED=$'\e[31m' R=$'\e[0m'
else
  B="" DIM="" GRN="" YLW="" RED="" R=""
fi
step()  { printf '\n%s==>%s %s\n' "$B" "$R" "$1"; }
ok()    { printf '  %s✔%s %s\n' "$GRN" "$R" "$1"; }
info()  { printf '  %s·%s %s\n' "$DIM" "$R" "$1"; }
warn()  { printf '  %s!%s %s\n' "$YLW" "$R" "$1"; }
would() { printf '  %s~%s %s\n' "$YLW" "$R" "$1"; }
die()   { printf '%s✗ error:%s %s\n' "$RED" "$R" "$1" >&2; exit 1; }

usage() {
  cat <<EOF
${B}agent — sync${R}
Copies this repo's items (skills, agents, plugins, commands) into OpenCode
config dirs. The repo is the source of truth; edits here apply where they are
pushed, so run \`sync.sh push\` after changing repo content.

${B}Usage:${R}
  sync.sh list                          show targets + what is installed
  sync.sh push   [target] [top...]      copy repo -> target  (default: global)
  sync.sh pull   [target] [top...]      copy owned+existing files back to repo
  sync.sh diff   [target] [top...]      show what push/pull would change
  sync.sh remove [target] [top...]      uninstall exactly what this repo pushed
  sync.sh all [push|pull|diff|remove]   run a command across every target

  target   "global" (default), a name from $TARGETS_CONF, or a project dir
           (installs into <dir>/.opencode). -g selects the global config.
           A top in the target slot (e.g. \`sync.sh push skills\`) also means
           global.
  top      one or more of: ${TOPS[*]} (default: all)

${B}Options:${R}
  -g                 global config (alias for ~/.config/opencode)
  -f, --force        allow plugins installed in two targets that load together
  -n, --dry-run      print what would change, change nothing
  -h, --help         show this help

${B}Notes:${R}
  - skills/ and agents/ live in category subdirs in the repo
    (skills/orchestration/..., agents/vision/...) but install FLAT into the
    target (\`skills/<name>\`, \`agents/<name>.md\`): skill and agent IDs are
    path-derived, and a flat target keeps them stable.
  - Pushed files are tracked in .agent-sync.json (gitignored) with content
    hashes. remove/pull only touch tracked items; files modified in the target
    are reported and kept.
  - Files may carry {{KEY}} placeholders (UPPER_SNAKE). push/diff substitute
    values from .agent-values (gitignored; see .agent-values.example); an
    undefined key fails the run, and pull skips templated files.
  - Config roots shadow ~/.agents/skills: same-named copies there drift and
    trip collision checks. push warns when it finds any.
  - Do NOT also npx-install fazuh/agent: config copies would shadow the
    ~/.agents/skills copies and be flagged as collisions.

${B}Examples:${R}
  sync.sh push -g                        # install globally
  sync.sh push agents                    # global, only the agents top
  sync.sh push ~/Projects/notes          # into ~/Projects/notes/.opencode
  sync.sh push -g skills plugins         # only skills + plugins
  sync.sh diff -g                        # drift preview
  sync.sh all push                       # every target
EOF
}

# ── arg parsing ──────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    -g) TARGET_NAME="global"; TARGET="${TARGET:-$GLOBAL_CFG}"; shift ;;
    -f|--force) FORCE=1; shift ;;
    -n|--dry-run) DRY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    --*) usage; echo; die "unknown option: $1" ;;
    *)
      if [[ -z "$COMMAND" ]]; then
        COMMAND="$1"
      elif [[ "$COMMAND" == "all" && -z "$SUB_CMD" ]]; then
        SUB_CMD="$1"
      elif [[ -z "$TARGET_NAME" ]]; then
        if [[ " ${TOPS[*]} " == *" $1 "* ]]; then
          TOPS_SEL+=("$1")     # top in the target slot — global is the default
        else
          TARGET_NAME="$1"
        fi
      else
        TOPS_SEL+=("$1")
      fi
      shift ;;
  esac
done

case "$COMMAND" in
  "") usage; echo; die "a command is required (list, push, pull, diff, remove, all)" ;;
  list|push|pull|diff|remove|all) ;;
  *) die "unknown command: $COMMAND" ;;
esac
if [[ "$COMMAND" == "all" ]]; then
  SUB_CMD="${SUB_CMD:-push}"
  case "$SUB_CMD" in push|pull|diff|remove) ;; *) die "unknown command for all: $SUB_CMD" ;; esac
fi
if [[ ${#TOPS_SEL[@]} -gt 0 ]]; then
  for t in "${TOPS_SEL[@]}"; do
    [[ " ${TOPS[*]} " == *" $t "* ]] || die "unknown top: $t (expected one of: ${TOPS[*]})"
  done
  TOP_LIST=("${TOPS_SEL[@]}")
else
  TOP_LIST=("${TOPS[@]}")
fi

# ── targets ──────────────────────────────────────────────────────────────────
declare -A TARGET_PATHS=()   # name -> abs path
if [[ -f "$TARGETS_CONF" ]]; then
  while IFS='=' read -r name path; do
    [[ -z "$name" || "$name" =~ ^[[:space:]]*# ]] && continue
    name="${name// /}"; path="${path// /}"
    path="${path/#\~/$HOME}"
    [[ -n "$name" && -n "$path" ]] && TARGET_PATHS["$name"]="$path"
  done < "$TARGETS_CONF"
fi

resolve_target() { # <arg: global|name|path|"">
  local arg="$1" base
  if [[ -z "$arg" || "$arg" == "global" ]]; then
    TARGET="$GLOBAL_CFG"; TARGET_NAME="global"
  elif [[ -n "${TARGET_PATHS[$arg]:-}" ]]; then
    TARGET="${TARGET_PATHS[$arg]}"
  elif [[ "$arg" == /* || "$arg" == ~* ]]; then
    # project path (dir need not exist — remove must clean deleted targets)
    base="${arg/#\~/$HOME}"
    base="$(realpath -m "$base")"
    TARGET="$base/.opencode"; TARGET_NAME="$arg"
  else
    die "not a target name: $arg (add it to $TARGETS_CONF or pass a directory path)"
  fi
  case "$TARGET" in
    "$REPO"|"$REPO"/*) die "target is inside the repo ($REPO) — pass a project dir or -g" ;;
  esac
}

# ── item enumeration (flatten categories for skills/agents) ─────────────────
# Prints "src|rel": src = repo-relative, rel = target-relative.
enumerate_items() {
  local cat child name
  for top in "${TOP_LIST[@]}"; do
    case "$top" in
      skills)
        for cat in "$REPO/skills"/*; do
          [[ -d "$cat" ]] || continue
          for child in "$cat"/*; do
            [[ -d "$child" ]] || continue
            printf 'skills/%s/%s|skills/%s\n' "$(basename "$cat")" "$(basename "$child")" "$(basename "$child")"
          done
        done ;;
      agents)
        for cat in "$REPO/agents"/*; do
          [[ -d "$cat" ]] || continue
          for child in "$cat"/*.md; do
            [[ -f "$child" ]] || continue
            printf 'agents/%s/%s|agents/%s\n' "$(basename "$cat")" "$(basename "$child")" "$(basename "$child")"
          done
        done ;;
      plugins)
        for child in "$REPO/plugins"/*; do
          name="$(basename "$child")"
          [[ "$name" == "node_modules" || "$name" == "package.json" || "$name" == "bun.lock" ]] && continue
          [[ -e "$child" ]] || continue
          printf 'plugins/%s|plugins/%s\n' "$name" "$name"
        done ;;
      commands)
        for child in "$REPO/commands"/*.md; do
          [[ -f "$child" ]] || continue
          printf 'commands/%s|commands/%s\n' "$(basename "$child")" "$(basename "$child")"
        done ;;
    esac
  done
}

# ── content hash: file, or dir as tree of (relpath+sha) pairs ───────────────
tree_sha() { # <path>
  python3 - "$1" <<'EOF'
import hashlib, os, sys
p = sys.argv[1]
h = hashlib.sha256()
if os.path.isfile(p):
    h.update(b"f")
    h.update(open(p, "rb").read())
else:
    h.update(b"d")
    rows = []
    for root, dirs, files in os.walk(p):
        dirs.sort(); files.sort()
        for f in files:
            fp = os.path.join(root, f)
            rows.append((os.path.relpath(fp, p), hashlib.sha256(open(fp, "rb").read()).hexdigest()))
    for rel, dh in sorted(rows):
        h.update(rel.encode()); h.update(dh.encode())
print(h.hexdigest())
EOF
}

# ── template substitution ({{KEY}} from gitignored .agent-values) ────────────
STAGE=""   # lazily created staging dir for substituted copies

stage_init() {
  [[ -n "$STAGE" ]] && return 0
  STAGE="$(mktemp -d)"
  trap 'rm -rf "$STAGE"' EXIT
}

# Substitute {{UPPER_SNAKE}} placeholders in one file, in place. Unknown
# UPPER_SNAKE keys fail (a literal placeholder must never reach a target);
# lowercase {{...}} is left alone; binary files are skipped.
substitute_file() { # <path> <rel-label>
  python3 - "$1" "$2" "$VALUES_FILE" <<'PYEOF'
import os, re, sys
path, rel, values_path = sys.argv[1:4]
pat = re.compile(r"\{\{([A-Z][A-Z0-9_]*)\}\}")
values = {}
if os.path.exists(values_path):
    vp = re.compile(r"^([A-Z][A-Z0-9_]*)=(.*)$")
    for line in open(values_path, encoding="utf-8", errors="replace"):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = vp.match(line)
        if m:
            v = m.group(2).strip()
            if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
                v = v[1:-1]
            values[m.group(1)] = v
data = open(path, "rb").read()
if b"\x00" in data:
    raise SystemExit(0)          # binary — never touched
text = data.decode("utf-8", errors="surrogateescape")
used = set(pat.findall(text))
missing = sorted(used - set(values))
if missing:
    for key in missing:
        sys.stderr.write(f"  ! {rel}: {{{{{key}}}}} is not defined in .agent-values\n")
    sys.stderr.write("✗ error: unresolved placeholders — add the keys to .agent-values (see .agent-values.example) or reword the content\n")
    raise SystemExit(1)
new = pat.sub(lambda m: values[m.group(1)], text)
if new != text:
    open(path, "w", encoding="utf-8", errors="surrogateescape", newline="").write(new)
PYEOF
}

# Copy a repo item (file or dir) into the stage, substituting every text file.
# Sets STAGED_PATH (no command substitution — the EXIT trap must live in the
# main shell, and a subshell's trap would delete the stage too early). The
# stage key is the full src — basenames collide across tops (skill `finish`
# vs agent `finish.md`).
stage_item() { # <src>
  stage_init
  local src="$1" f
  STAGED_PATH="$STAGE/$(printf '%s' "$src" | tr '/' '_')"
  rm -rf "$STAGED_PATH"
  if [[ -d "$REPO/$src" ]]; then
    cp -a "$REPO/$src" "$STAGED_PATH"
    while IFS= read -r -d '' f; do
      substitute_file "$f" "$src/${f#"$STAGED_PATH"/}"
    done < <(find "$STAGED_PATH" -type f -print0 | sort -z)
  else
    cp -p "$REPO/$src" "$STAGED_PATH"
    substitute_file "$STAGED_PATH" "$src"
  fi
}

# Fail before anything is written if any selected item references an
# undefined {{KEY}}.
preflight_placeholders() {
  local srcs=() src rel
  while IFS='|' read -r src rel; do
    [[ -n "$src" ]] && srcs+=("$REPO/$src")
  done < <(enumerate_items)
  [[ ${#srcs[@]} -gt 0 ]] || return 0
  python3 - "$VALUES_FILE" "$REPO" "${srcs[@]}" <<'PYEOF'
import os, re, sys
values_path, repo, roots = sys.argv[1], sys.argv[2], sys.argv[3:]
pat = re.compile(r"\{\{([A-Z][A-Z0-9_]*)\}\}")
values = set()
if os.path.exists(values_path):
    vp = re.compile(r"^([A-Z][A-Z0-9_]*)=")
    for line in open(values_path, encoding="utf-8", errors="replace"):
        line = line.strip()
        if line and not line.startswith("#"):
            m = vp.match(line)
            if m:
                values.add(m.group(1))
bad = []
for root in roots:
    if os.path.isfile(root):
        walk = [root]
    else:
        walk = []
        for r, dirs, files in os.walk(root):
            dirs.sort()
            for f in sorted(files):
                walk.append(os.path.join(r, f))
    for fp in walk:
        try:
            data = open(fp, "rb").read()
        except OSError:
            continue
        if b"\x00" in data:
            continue
        for key in pat.findall(data.decode("utf-8", errors="replace")):
            if key not in values:
                bad.append((fp[len(repo) + 1:] if fp.startswith(repo + os.sep) else fp, key))
if bad:
    for fp, key in sorted(set(bad)):
        sys.stderr.write(f"  ! {fp}: {{{{{key}}}}} not defined in .agent-values\n")
    sys.stderr.write("✗ error: unresolved placeholders — nothing was pushed\n")
    raise SystemExit(1)
PYEOF
}

# True when a repo item carries any {{UPPER_SNAKE}} placeholder.
item_templated() { # <src>
  local p="$REPO/$1"
  if [[ -d "$p" ]]; then
    grep -rqE '\{\{[A-Z][A-Z0-9_]*\}\}' "$p" 2>/dev/null
  else
    grep -qE '\{\{[A-Z][A-Z0-9_]*\}\}' "$p" 2>/dev/null
  fi
}

# ── manifest helpers ─────────────────────────────────────────────────────────
manifest_set_item() { # <target> <rel> <src> <sha>
  local target="$1" rel="$2" src="$3" sha="$4"
  [[ $DRY -eq 1 ]] && return 0
  python3 - "$MANIFEST" "$target" "$rel" "$src" "$sha" <<'EOF'
import json, sys
path, target, rel, src, sha = sys.argv[1:6]
try:
    m = json.load(open(path))
except (FileNotFoundError, json.JSONDecodeError):
    m = {}
e = m.setdefault(target, {"items": {}})
e["items"][rel] = {"src": src, "sha": sha}
with open(path, "w") as f:
    json.dump(m, f, indent=2)
EOF
}

manifest_del_item() { # <target> <rel>
  local target="$1" rel="$2"
  [[ $DRY -eq 1 ]] && return 0
  python3 - "$MANIFEST" "$target" "$rel" <<'EOF'
import json, sys
path, target, rel = sys.argv[1:4]
try:
    m = json.load(open(path))
except (FileNotFoundError, json.JSONDecodeError):
    raise SystemExit
e = m.get(target)
if e and rel in e.get("items", {}):
    del e["items"][rel]
    if not e["items"]:
        m.pop(target, None)
    with open(path, "w") as f:
        json.dump(m, f, indent=2)
EOF
}

manifest_drop_target() { # <target>
  [[ $DRY -eq 1 ]] && return 0
  python3 - "$MANIFEST" "$1" <<'EOF'
import json, sys
try:
    m = json.load(open(sys.argv[1]))
except Exception:
    raise SystemExit
m.pop(sys.argv[2], None)
with open(sys.argv[1], "w") as f:
    json.dump(m, f, indent=2)
EOF
}

manifest_read_items() { # <target> — prints "rel|src|sha"
  python3 - "$MANIFEST" "$1" <<'EOF'
import json, sys
try:
    m = json.load(open(sys.argv[1]))
except Exception:
    raise SystemExit
for rel, it in (m.get(sys.argv[2]) or {}).get("items", {}).items():
    print(f"{rel}|{it.get('src','')}|{it.get('sha','')}")
EOF
}

target_has_plugins() { # <target> — true if the manifest records plugin items
  [[ -f "$MANIFEST" ]] || return 1
  python3 - "$MANIFEST" "$1" <<'EOF' | grep -q .
import json, sys
try: m = json.load(open(sys.argv[1]))
except Exception: raise SystemExit
for rel in (m.get(sys.argv[2]) or {}).get("items", {}):
    if rel.startswith("plugins/"):
        print(rel)
EOF
}

# ── actions ──────────────────────────────────────────────────────────────────
action_push() {
  local target="$1" src rel item tgt current
  step "Push → $target"
  preflight_placeholders
  while IFS='|' read -r src rel; do
    [[ -n "$src" ]] || continue
    tgt="$target/$rel"
    if [[ -L "$tgt" ]]; then
      warn "$rel skipped — target path is a symlink (remove it first: rm $tgt)"
      continue
    fi
    if [[ $DRY -eq 1 ]]; then
      would "push $rel"
      continue
    fi
    stage_item "$src"
    item="$STAGED_PATH"
    mkdir -p "$(dirname "$tgt")"
    if [[ -d "$item" ]]; then
      rsync -a --delete "$item/" "$tgt/"
    else
      cp -p "$item" "$tgt"
    fi
    manifest_set_item "$target" "$rel" "$src" "$(tree_sha "$tgt")"
    ok "pushed $rel"
  done < <(enumerate_items)

  # stale prune: tracked items no longer shipped by the repo — remove only if
  # the target copy is still exactly what we pushed; authored drift is kept.
  if [[ -f "$MANIFEST" ]]; then
    while IFS='|' read -r rel src sha; do
      [[ -n "$rel" ]] || continue
      [[ -e "$REPO/$src" ]] && continue
      tgt="$target/$rel"
      if [[ ! -e "$tgt" && ! -L "$tgt" ]]; then
        info "stale $rel already gone"
        manifest_del_item "$target" "$rel"
        continue
      fi
      if [[ "$(tree_sha "$tgt" 2>/dev/null || true)" == "$sha" ]]; then
        if [[ $DRY -eq 1 ]]; then
          would "remove stale $rel"
        else
          rm -rf "$tgt"; ok "removed stale $rel"
          manifest_del_item "$target" "$rel"
        fi
      else
        warn "$rel kept — no longer in repo and modified in target"
      fi
    done < <(manifest_read_items "$target")
  fi
}

action_pull() {
  local target="$1" src rel tgt
  step "Pull ← $target"
  [[ -f "$MANIFEST" ]] || { info "no manifest — nothing tracked to pull"; return; }
  while IFS='|' read -r rel src sha; do
    [[ -n "$rel" && -n "$src" ]] || continue
    [[ " ${TOP_LIST[*]} " == *" ${rel%%/*} "* ]] || continue   # top filter
    [[ -e "$REPO/$src" ]] || continue          # only items the repo still ships
    if item_templated "$src"; then
      info "pull skipped $rel — templated (repo-owned: edit .agent-values, then push)"
      continue
    fi
    tgt="$target/$rel"
    [[ -e "$tgt" ]] || continue                # existing files only
    if [[ $DRY -eq 1 ]]; then
      would "pull $rel"
    else
      if [[ -d "$REPO/$src" ]]; then
        rsync -a --existing "$tgt/" "$REPO/$src/"
      else
        cp -p "$tgt" "$REPO/$src"
      fi
      manifest_set_item "$target" "$rel" "$src" "$(tree_sha "$tgt")"
      ok "pulled $rel"
    fi
  done < <(manifest_read_items "$target")
}

action_diff() {
  local target="$1" src rel item tgt
  step "Diff $target"
  preflight_placeholders
  while IFS='|' read -r src rel; do
    [[ -n "$src" ]] || continue
    stage_item "$src"
    item="$STAGED_PATH"; tgt="$target/$rel"
    if [[ ! -e "$tgt" ]]; then
      would "push $rel (not installed)"
    elif [[ "$(tree_sha "$tgt")" == "$(tree_sha "$item")" ]]; then
      info "$rel in sync"
    else
      warn "$rel differs:"
      echo "    push (repo → target):"
      rsync -ani "$item/" "$tgt/" 2>/dev/null \
        | grep -vE 'sending incremental|^$|^\.$' | sed 's/^/      /' || true
      echo "    pull (target → repo):"
      rsync -ani --existing "$tgt/" "$item/" 2>/dev/null \
        | grep -vE 'sending incremental|^$|^\.$' | sed 's/^/      /' || true
    fi
  done < <(enumerate_items)
}

action_remove() {
  local target="$1" src rel sha tgt current
  step "Remove ← $target"
  [[ -f "$MANIFEST" ]] || { info "no manifest — nothing tracked to remove"; return; }
  while IFS='|' read -r rel src sha; do
    [[ -n "$rel" ]] || continue
    tgt="$target/$rel"
    if [[ ! -e "$tgt" && ! -L "$tgt" ]]; then
      info "already gone: $rel"
      manifest_del_item "$target" "$rel"
      continue
    fi
    current="$(tree_sha "$tgt" 2>/dev/null || true)"
    if [[ -n "$sha" && "$current" == "$sha" ]]; then
      if [[ $DRY -eq 1 ]]; then
        would "remove $rel"
      else
        rm -rf "$tgt"; ok "removed $rel"
        manifest_del_item "$target" "$rel"
      fi
    else
      warn "$rel kept — modified in target (content differs from what we pushed); remove manually if unwanted"
    fi
  done < <(manifest_read_items "$target")
  if [[ $DRY -eq 0 ]]; then
    for top in "${TOPS[@]}"; do rmdir "$target/$top" 2>/dev/null || true; done
    rmdir "$target" 2>/dev/null || true
    manifest_drop_target "$target"
  fi
}

action_list() {
  echo "${B}Targets${R}"
  [[ -d "$GLOBAL_CFG" ]] && echo "  global -> $GLOBAL_CFG"
  for name in "${!TARGET_PATHS[@]}"; do echo "  $name -> ${TARGET_PATHS[$name]}"; done
  echo
  if [[ -f "$MANIFEST" ]]; then
    echo "${B}Installed (manifest)${R}"
    python3 - "$MANIFEST" <<'EOF'
import json, sys
try: m = json.load(open(sys.argv[1]))
except Exception: raise SystemExit
for tgt, e in m.items():
    print(f"  {tgt}: {len(e.get('items') or {})} item(s)")
EOF
  else
    echo "Nothing installed yet — run: ./sync.sh push -g"
  fi
}

# ── cross-target plugin guard ────────────────────────────────────────────────
plugin_guard() { # <target>
  [[ $FORCE -eq 0 ]] || return 0
  local tgt="$1" other dangerous=0
  if [[ "$tgt" == "$GLOBAL_CFG" ]]; then
    # pushing global: any other target with plugins would double-load
    while IFS= read -r other; do
      [[ "$other" == "$tgt" ]] && continue
      if target_has_plugins "$other"; then dangerous=1; break; fi
    done < <(python3 - "$MANIFEST" <<'EOF'
import json, sys
try: m = json.load(open(sys.argv[1]))
except Exception: raise SystemExit
print("\n".join(m.keys()))
EOF
)
  else
    # pushing a project: collides with global plugins
    target_has_plugins "$GLOBAL_CFG" && dangerous=1
  fi
  [[ $dangerous -eq 0 ]] && return 0
  die "plugins from this repo are already installed somewhere that loads
alongside this target — remove the other install first (sync.sh remove …)
or pass --force."
}

# ── advisory: shadowed copies in ~/.agents/skills ────────────────────────────
shadow_advisory() {
  local name shadowed=()
  while IFS='|' read -r src rel; do
    [[ "$rel" == skills/* ]] || continue
    name="${rel#skills/}"
    [[ -e "$AGENTS_SKILLS/$name" ]] && shadowed+=("$name")
  done < <(enumerate_items)
  [[ ${#shadowed[@]} -gt 0 ]] || return 0
  step "Shadow conflicts"
  warn "${#shadowed[@]} skill(s) also exist as copies in $AGENTS_SKILLS:"
  printf '  %s\n' "${shadowed[@]}"
  warn "the pushed config copy wins; delete the npx copies or skill-doctor will
        keep flagging collisions/drift:"
  printf '  rm -r %s/{%s}\n' "$AGENTS_SKILLS" "$(IFS=,; echo "${shadowed[*]}")"
}

# ── dispatch ─────────────────────────────────────────────────────────────────
if [[ "$COMMAND" == "list" ]]; then action_list; exit 0; fi

if [[ "$COMMAND" == "all" ]]; then
  [[ $DRY -eq 1 ]] && info "dry run — nothing will be changed"
  run_target() {
    resolve_target "$1"
    echo "=========================================="
    echo "  $SUB_CMD: $1 -> $TARGET"
    echo "=========================================="
    case "$SUB_CMD" in
      push)   plugin_guard "$TARGET"; action_push "$TARGET" ;;
      pull)   action_pull "$TARGET" ;;
      diff)   action_diff "$TARGET" ;;
      remove) action_remove "$TARGET" ;;
    esac
  }
  run_target global
  for name in "${!TARGET_PATHS[@]}"; do run_target "$name"; done
  echo "Done."
  exit 0
fi

resolve_target "$TARGET_NAME"
[[ $DRY -eq 1 ]] && info "dry run — nothing will be changed"

case "$COMMAND" in
  push)   plugin_guard "$TARGET"; action_push "$TARGET"; shadow_advisory ;;
  pull)   action_pull "$TARGET" ;;
  diff)   action_diff "$TARGET" ;;
  remove) action_remove "$TARGET" ;;
esac

step "Next steps"
if [[ "$COMMAND" == "push" && $DRY -eq 0 ]]; then
  cat <<EOF
  1. Restart OpenCode (or just the background service) to pick up new copies.
  2. After editing repo content later: ./sync.sh push ${TARGET_NAME:-global}
  ${DIM}Remove: ./sync.sh remove ${TARGET_NAME:-global}${R}
EOF
fi
exit 0