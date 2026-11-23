#!/usr/bin/env bash
# agent — global symlink deploy. Repo items become symlinks into the XDG data
# clone; real files in the config dir stay machine-private.
set -euo pipefail
shopt -s extglob   # tags.conf patterns may use @(), !(), etc.

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GLOBAL_CFG="$HOME/.config/opencode"
XDG_DATA="$(realpath -m "${XDG_DATA_HOME:-$HOME/.local/share}/fazuh-agent")"
CLONE="$XDG_DATA/config"
CLONE_POINTER="$XDG_DATA/.clone-path"
DATA_BIN="$XDG_DATA/bin"
BACKUP_BASE="$XDG_DATA/backups"
TAGS_CONF="$REPO/tags.conf"
BIN_DIR="$(realpath -m "${AGENT_BIN_DIR:-$HOME/.local/bin}")"
REPO_POINTER=".agent-repo"
TOPS=(skills agents plugins commands instructions lib)

DRY=0
FORCE=0
COMMAND=""
REF_ARG=""
TAGS_SEL=()
TAG_NAME=()
TAG_PATS=()
TOP_LIST=("${TOPS[@]}")

PLAN_ACTION=()
PLAN_ITEM=()
PLAN_DETAIL=()
PLAN_KIND=()
PLAN_TGT=()
PLAN_SRC=()
COLLISIONS=()
BACKUP_DIR=""
PREVIEW_DIR=""

cleanup_preview() {
  [[ -n "$PREVIEW_DIR" && -d "$PREVIEW_DIR" ]] && rm -rf "$PREVIEW_DIR"
  return 0
}
trap cleanup_preview EXIT

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
plan_row() { printf '  %-10s %-36s %s\n' "$1" "$2" "$3"; }

usage() {
  cat <<EOF
${B}agent — sync${R}
Deploy repo items into the global OpenCode config as symlinks into a local
clone. Real files in the config dir stay machine-private.

${B}Usage:${R}
  sync.sh deploy [-n|--dry-run] [-f|--force] [-t TAGS] [ref]   (default ref: deploy)
  sync.sh list   [-t TAGS]
  sync.sh diff   [-t TAGS] [ref]
  sync.sh remove [-n|--dry-run] [-f|--force] [-t TAGS]
  sync.sh -h|--help

${B}Args:${R}
  ref    git ref in the working checkout to deploy (default: deploy)

${B}Options:${R}
  -n, --dry-run   print the planned table, write nothing
  -f, --force     replace differing real entries and private symlinks
  -t, --tags      select items tagged TAGS in $TAGS_CONF —
                  0 to N tags, comma-separated or repeated -t; no -t means all;
                  "all" is reserved and selects everything
  -h, --help      this help
EOF
}

# ── tags (tags.conf) ─────────────────────────────────────────────────────────
trim() { # <string> — strip leading/trailing whitespace
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "$s"
}

add_tags() { # <comma-list> — accumulate -t/--tags selections
  local IFS=',' t
  for t in $1; do
    t="$(trim "$t")"
    [[ -z "$t" ]] && continue
    TAGS_SEL+=("$t")
  done
}

# Format: one tag per line, tag=pattern,pattern,... Patterns match item paths
# (skills/<cat>/<name>, agents/<cat>/<name>.md, plugins/<name>,
# commands/<path>.md, lib/<name>, scripts/<name>) and may be shell globs.
load_tags_conf() {
  [[ -f "$TAGS_CONF" ]] || return 0
  local line name pats p cleaned
  declare -a parts=()
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%%#*}"
    line="$(trim "$line")"
    [[ -z "$line" ]] && continue
    [[ "$line" == *=* ]] || die "$TAGS_CONF: expected 'tag=pattern,pattern' — got: $line"
    name="$(trim "${line%%=*}")"
    [[ "$name" =~ ^[A-Za-z0-9_-]+$ ]] || die "$TAGS_CONF: bad tag name: '$name'"
    [[ "$name" != "all" ]] || die "$TAGS_CONF: tag 'all' is reserved"
    cleaned=""
    IFS=',' read -ra parts <<<"${line#*=}"
    for p in "${parts[@]}"; do
      p="$(trim "$p")"
      [[ -z "$p" ]] && continue
      cleaned="${cleaned:+$cleaned,}$p"
    done
    [[ -n "$cleaned" ]] || die "$TAGS_CONF: tag '$name' has no patterns"
    TAG_NAME+=("$name")
    TAG_PATS+=("$cleaned")
  done < "$TAGS_CONF"
}

known_tags() {
  local i out=""
  for i in "${!TAG_NAME[@]}"; do
    [[ ",$out," == *",${TAG_NAME[i]},"* ]] || out="${out:+$out, }${TAG_NAME[i]}"
  done
  printf '%s' "${out:+$out, }"
}

validate_tag_selection() {
  local t i found
  for t in "${TAGS_SEL[@]}"; do
    [[ "$t" == "all" ]] && continue
    if [[ ${#TAG_NAME[@]} -eq 0 ]]; then
      die "unknown tag: $t — no tags defined in $TAGS_CONF"
    fi
    found=0
    for i in "${!TAG_NAME[@]}"; do
      [[ "${TAG_NAME[i]}" == "$t" ]] && found=1
    done
    if [[ $found -eq 0 ]]; then
      die "unknown tag: $t (defined in $TAGS_CONF: $(known_tags)or 'all')"
    fi
  done
}

item_tags() { # <src> — prints comma-joined tags matching this item
  local i pats p t out=""
  for i in "${!TAG_NAME[@]}"; do
    IFS=',' read -ra pats <<<"${TAG_PATS[i]}"
    for p in "${pats[@]}"; do
      [[ "$1" == $p ]] || continue
      t="${TAG_NAME[i]}"
      [[ ",$out," == *",$t,"* ]] || out="${out:+$out,}$t"
    done
  done
  printf '%s' "$out"
}

item_selected() { # <src> — true when the item passes the tag filter
  local t it
  [[ ${#TAGS_SEL[@]} -eq 0 ]] && return 0
  for t in "${TAGS_SEL[@]}"; do [[ "$t" == "all" ]] && return 0; done
  it="$(item_tags "$1")"
  [[ -n "$it" ]] || return 1
  for t in "${TAGS_SEL[@]}"; do
    [[ ",$it," == *",$t,"* ]] && return 0
  done
  return 1
}

# Warn about tag patterns that match no repo item.
warn_unused_patterns() {
  local all_srcs=() src i pats p found
  while IFS='|' read -r src rel; do all_srcs+=("$src"); done < <(enumerate_items "$REPO")
  while IFS= read -r src; do all_srcs+=("$src"); done < <(enumerate_bin "$REPO")
  for i in "${!TAG_NAME[@]}"; do
    IFS=',' read -ra pats <<<"${TAG_PATS[i]}"
    for p in "${pats[@]}"; do
      found=0
      for src in "${all_srcs[@]}"; do
        [[ "$src" == $p ]] && { found=1; break; }
      done
      [[ $found -eq 1 ]] || warn "tag pattern matches nothing: ${TAG_NAME[i]}=$p"
    done
  done
}

# ── arg parsing ──────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    -f|--force) FORCE=1; shift ;;
    -n|--dry-run) DRY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    -t|--tags)
      [[ $# -ge 2 ]] || die "option $1 needs a value"
      add_tags "$2"; shift 2 ;;
    --tags=*) add_tags "${1#--tags=}"; shift ;;
    --*) usage; echo; die "unknown option: $1" ;;
    *)
      if [[ -z "$COMMAND" ]]; then
        COMMAND="$1"
      elif [[ -z "$REF_ARG" ]]; then
        REF_ARG="$1"
      else
        die "unexpected argument: $1"
      fi
      shift ;;
  esac
done

case "$COMMAND" in
  "") usage; echo; die "a command is required (deploy, list, diff, remove)" ;;
  deploy|list|diff|remove) ;;
  *) die "unknown command: $COMMAND (expected deploy, list, diff, remove)" ;;
esac
if [[ "$COMMAND" == "list" || "$COMMAND" == "remove" ]] && [[ -n "$REF_ARG" ]]; then
  die "$COMMAND takes no ref"
fi
REF="${REF_ARG:-deploy}"

case "$REPO" in
  "$CLONE"|"$CLONE"/*) die "refusing to run from inside the deploy clone ($CLONE) — run from the working checkout" ;;
esac

# ── item enumeration (flatten categories for skills/agents) ─────────────────
# Prints "src|rel" for every item; callers apply the tag filter.
enumerate_items() { # <base>
  local base="$1" top cat child name
  emit_item() { printf '%s|%s\n' "$1" "$2"; }
  for top in "${TOP_LIST[@]}"; do
    case "$top" in
      skills)
        for cat in "$base/skills"/*; do
          [[ -d "$cat" ]] || continue
          for child in "$cat"/*; do
            [[ -d "$child" ]] || continue
            emit_item "skills/$(basename "$cat")/$(basename "$child")" "skills/$(basename "$child")"
          done
        done ;;
      agents)
        for cat in "$base/agents"/*; do
          [[ -d "$cat" ]] || continue
          for child in "$cat"/*.md; do
            [[ -f "$child" ]] || continue
            emit_item "agents/$(basename "$cat")/$(basename "$child")" "agents/$(basename "$child")"
          done
        done ;;
      plugins)
        for child in "$base/plugins"/*; do
          name="$(basename "$child")"
          [[ "$name" == "node_modules" || "$name" == "package.json" || "$name" == "bun.lock" ]] && continue
          [[ -e "$child" ]] || continue
          emit_item "plugins/$name" "plugins/$name"
        done ;;
      lib)
        for child in "$base/lib"/*; do
          [[ -d "$child" ]] || continue
          name="$(basename "$child")"
          emit_item "lib/$name" "lib/$name"
        done ;;
      commands)
        [[ -d "$base/commands" ]] || continue
        while IFS= read -r -d '' child; do
          name="${child#"$base/commands/"}"
          emit_item "commands/$name" "commands/$name"
        done < <(find "$base/commands" -type f -name '*.md' -print0 | sort -z) ;;
      instructions)
        for child in "$base/instructions"/*.md; do
          [[ -f "$child" ]] || continue
          name="$(basename "$child")"
          emit_item "instructions/$name" "instructions/$name"
        done ;;
    esac
  done
}

enumerate_bin() { # <base> — prints checkout-relative executable script paths
  local base="$1" f
  [[ -d "$base/scripts" ]] || return 0
  for f in "$base/scripts"/*; do
    [[ -f "$f" && -x "$f" ]] || continue
    printf 'scripts/%s\n' "$(basename "$f")"
  done
  return 0
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

# ── symlink ownership ────────────────────────────────────────────────────────
link_abs() { # <link> — print canonical target path
  local raw d
  raw="$(readlink "$1")" || return 1
  if [[ "$raw" == /* ]]; then
    printf '%s\n' "$(realpath -m "$raw")"
  else
    d="$(cd "$(dirname "$1")" && pwd)"
    printf '%s\n' "$(realpath -m "$d/$raw")"
  fi
}

is_managed_link() { # <path> — symlink into the config clone
  local a
  [[ -L "$1" ]] || return 1
  a="$(link_abs "$1")" || return 1
  [[ "$a" == "$CLONE/"* ]]
}

is_managed_bin_link() { # <path> — symlink into the data bin
  local a
  [[ -L "$1" ]] || return 1
  a="$(link_abs "$1")" || return 1
  [[ "$a" == "$DATA_BIN/"* ]]
}

# ── plan/backup/refresh ─────────────────────────────────────────────────────
add_plan() { # <action> <item> <detail> <kind> <target> <source>
  PLAN_ACTION+=("$1"); PLAN_ITEM+=("$2"); PLAN_DETAIL+=("$3")
  PLAN_KIND+=("$4"); PLAN_TGT+=("$5"); PLAN_SRC+=("$6")
}

print_plan() {
  local i
  printf '  %-10s %-36s %s\n' ACTION ITEM DETAIL
  for i in "${!PLAN_ACTION[@]}"; do
    plan_row "${PLAN_ACTION[i]}" "${PLAN_ITEM[i]}" "${PLAN_DETAIL[i]}"
  done
}

backup_entry() { # <backup-rel> <path>
  local dest
  [[ -n "$BACKUP_DIR" ]] || BACKUP_DIR="$BACKUP_BASE/$(date '+%Y%m%d-%H%M%S-%N')"
  [[ -d "$BACKUP_DIR" ]] || mkdir -p "$BACKUP_DIR"
  dest="$BACKUP_DIR/$1"
  mkdir -p "$(dirname "$dest")"
  mv "$2" "$dest"
}

ensure_tar_backup() {
  local existing archive
  mkdir -p "$BACKUP_BASE"
  existing="$(find "$BACKUP_BASE" -maxdepth 1 -name 'opencode-*.tar.gz' -print -quit 2>/dev/null)"
  if [[ -n "$existing" ]]; then
    info "config backup already present: $existing"
    return 0
  fi
  if [[ ! -d "$HOME/.config/opencode" ]]; then
    warn "no config dir at $HOME/.config/opencode — skipping tar backup"
    return 0
  fi
  archive="$BACKUP_BASE/opencode-$(date '+%Y%m%d-%H%M%S-%N').tar.gz"
  tar -C "$HOME/.config" -czf "$archive" opencode || die "cannot create config backup: $archive"
  ok "config backup: $archive"
}

materialise_ref() { # <ref> — sets PREVIEW_DIR in the main shell
  local ref="$1"
  git -C "$REPO" rev-parse --verify --quiet "refs/heads/$ref" >/dev/null \
    || die "ref '$ref' not found in $REPO — create the promotion branch first"
  PREVIEW_DIR="$(mktemp -d "${TMPDIR:-/tmp/opencode}/sync-preview.XXXXXX")"
  git -C "$REPO" archive "$ref" | tar -x -C "$PREVIEW_DIR" || die "cannot materialise ref '$ref' for preview"
}

apply_plan() {
  local i kind tgt src name
  for i in "${!PLAN_ACTION[@]}"; do
    kind="${PLAN_KIND[i]}"
    tgt="${PLAN_TGT[i]}"; src="${PLAN_SRC[i]}"
    case "$kind" in
      link)
        mkdir -p "$(dirname "$tgt")"
        if [[ -e "$tgt" || -L "$tgt" ]]; then backup_entry "${PLAN_ITEM[i]}" "$tgt"; fi
        ln -s "$src" "$tgt"
        ok "linked ${PLAN_ITEM[i]}" ;;
      unlink)
        rm -f "$tgt"
        ok "pruned ${PLAN_ITEM[i]}" ;;
      binlink)
        name="${PLAN_ITEM[i]##*/}"
        mkdir -p "$DATA_BIN" "$BIN_DIR"
        cp -p "$src" "$DATA_BIN/$name"
        chmod +x "$DATA_BIN/$name"
        if [[ -e "$tgt" || -L "$tgt" ]]; then backup_entry "${PLAN_ITEM[i]}" "$tgt"; fi
        ln -s "$DATA_BIN/$name" "$tgt"
        ok "linked ${PLAN_ITEM[i]}" ;;
    esac
  done
  return 0
}

refresh_clone() { # <ref>
  local ref="$1"
  mkdir -p "$XDG_DATA"
  if [[ ! -d "$CLONE/.git" ]]; then
    [[ -e "$CLONE" ]] && die "clone path exists but is not a git checkout: $CLONE"
    git clone -q --no-checkout "$REPO" "$CLONE" || die "cannot clone $REPO into $CLONE"
  fi
  git -C "$CLONE" fetch -q --no-tags origin "+refs/heads/$ref:refs/remotes/origin/$ref" \
    || die "cannot fetch ref '$ref' from $REPO"
  git -C "$CLONE" checkout -q -B "$ref" "origin/$ref" || die "cannot check out ref '$ref' in $CLONE"
  git -C "$CLONE" reset -q --hard "origin/$ref"
}

bun_install() {
  [[ -f "$CLONE/plugins/package.json" ]] || return 0
  if ! command -v bun >/dev/null 2>&1; then
    die "bun not found — required to install plugin dependencies in $CLONE/plugins"
  fi
  step "Plugin dependencies"
  ( cd "$CLONE/plugins" && bun install --frozen-lockfile ) \
    || die "bun install --frozen-lockfile failed in $CLONE/plugins"
  return 0
}

write_pointers() {
  printf '%s\n' "$CLONE" > "$CLONE_POINTER"
  mkdir -p "$GLOBAL_CFG"
  printf '%s\n' "$REPO" > "$GLOBAL_CFG/$REPO_POINTER"
}

# ── actions ──────────────────────────────────────────────────────────────────
plan_prune_cfg() {
  local top child a rel
  for top in "${TOP_LIST[@]}"; do
    [[ -d "$GLOBAL_CFG/$top" ]] || continue
    for child in "$GLOBAL_CFG/$top"/*; do
      [[ -L "$child" ]] || continue
      a="$(link_abs "$child" || true)"
      [[ "$a" == "$CLONE/"* ]] || continue
      rel="${a#"$CLONE"/}"
      [[ -e "$a" ]] && continue
      item_selected "$rel" || continue
      add_plan prune "$rel" "clone target gone" unlink "$child" ""
    done
  done
  return 0
}

plan_prune_bin() {
  local child a name
  [[ -d "$BIN_DIR" ]] || return 0
  for child in "$BIN_DIR"/*; do
    [[ -L "$child" ]] || continue
    a="$(link_abs "$child" || true)"
    [[ "$a" == "$DATA_BIN/"* ]] || continue
    [[ -e "$a" ]] && continue
    name="$(basename "$child")"
    item_selected "scripts/$name" || continue
    add_plan binprune "bin/$name" "data-bin copy gone" unlink "$child" ""
  done
  return 0
}

plan_config() { # <base>
  local base="$1" src rel srcpath tgt a act detail
  while IFS='|' read -r src rel; do
    [[ -n "$src" ]] || continue
    if ! item_selected "$src"; then
      add_plan skip "$rel" "tag filter" "" "" ""
      continue
    fi
    srcpath="$base/$src"
    if [[ ! -e "$srcpath" ]]; then
      add_plan skip "$rel" "no source in checkout" "" "" ""
      continue
    fi
    tgt="$GLOBAL_CFG/$rel"
    if [[ -L "$tgt" ]]; then
      a="$(link_abs "$tgt" || true)"
      if [[ "$a" == "$CLONE/$src" ]]; then
        add_plan keep "$rel" "already linked" "" "" ""
        continue
      fi
      if [[ "$a" == "$CLONE/"* ]]; then detail="managed link points elsewhere: $a"
      else detail="private symlink: $a"; fi
      act=replace
    elif [[ -e "$tgt" ]]; then
      if [[ "$(tree_sha "$tgt")" == "$(tree_sha "$srcpath")" ]]; then
        act=replace; detail="identical real entry"
      else
        act=collision; detail="real entry differs"
      fi
    else
      act=create; detail="-> $srcpath"
    fi
    if [[ "$act" == "collision" && $FORCE -eq 0 ]]; then
      add_plan collision "$rel" "$detail" "" "" ""
      COLLISIONS+=("$rel")
      continue
    fi
    if [[ "$act" == "collision" && $FORCE -eq 1 ]]; then detail="$detail (forced)"; fi
    add_plan "$act" "$rel" "$detail" link "$tgt" "$srcpath"
  done < <(enumerate_items "$base")
  return 0
}

plan_bins() { # <base>
  local base="$1" src name srcpath tgt a act detail
  [[ -d "$base/scripts" ]] || return 0
  while IFS= read -r src; do
    [[ -n "$src" ]] || continue
    name="${src#scripts/}"
    srcpath="$base/$src"
    [[ -e "$srcpath" ]] || continue
    if ! item_selected "$src"; then
      add_plan skip "bin/$name" "tag filter" "" "" ""
      continue
    fi
    tgt="$BIN_DIR/$name"
    if [[ -L "$tgt" ]]; then
      a="$(link_abs "$tgt" || true)"
      if [[ "$a" == "$DATA_BIN/$name" ]]; then
        add_plan keep "bin/$name" "already linked" "" "" ""
        continue
      fi
      if [[ "$a" == "$DATA_BIN/"* ]]; then detail="managed link points elsewhere: $a"
      else detail="private symlink: $a"; fi
      act=replace
    elif [[ -e "$tgt" ]]; then
      if [[ "$(tree_sha "$tgt")" == "$(tree_sha "$srcpath")" ]]; then
        act=replace; detail="identical real binary"
      else
        act=collision; detail="real binary differs"
      fi
    else
      act=create; detail="-> $DATA_BIN/$name"
    fi
    if [[ "$act" == "collision" && $FORCE -eq 0 ]]; then
      add_plan collision "bin/$name" "$detail" "" "" ""
      COLLISIONS+=("bin/$name")
      continue
    fi
    if [[ "$act" == "collision" && $FORCE -eq 1 ]]; then detail="$detail (forced)"; fi
    add_plan "$act" "bin/$name" "$detail" binlink "$tgt" "$srcpath"
  done < <(enumerate_bin "$base")
  return 0
}

action_deploy() { # <ref>
  local ref="$1" base
  step "Deploy → $GLOBAL_CFG"
  if [[ $DRY -eq 1 ]]; then
    info "dry run — plan only — no config, bin, or pointer writes"
    materialise_ref "$ref"
    base="$PREVIEW_DIR"
  else
    refresh_clone "$ref"
    bun_install
    base="$CLONE"
  fi

  plan_config "$base"
  plan_prune_cfg
  plan_bins "$base"
  plan_prune_bin
  print_plan

  if [[ ${#COLLISIONS[@]} -gt 0 ]]; then
    die "collision at ${#COLLISIONS[@]} entry/entries: ${COLLISIONS[*]} — move them aside or pass --force"
  fi
  if [[ $DRY -eq 1 ]]; then
    info "dry run complete — plan only — no config, bin, or pointer writes"
    return 0
  fi
  ensure_tar_backup
  apply_plan
  write_pointers
  step "Done"
  info "clone: $CLONE"
  info "config: $GLOBAL_CFG"
  info "bin: $BIN_DIR"
  return 0
}

action_list() {
  local top child a rel name m p total_m=0 total_p=0
  info "clone: $([[ -f "$CLONE_POINTER" ]] && cat "$CLONE_POINTER" || printf '%s' "$CLONE")"
  if [[ ${#TAGS_SEL[@]} -gt 0 ]]; then info "tag filter: ${TAGS_SEL[*]}"; fi
  step "Config → $GLOBAL_CFG"
  for top in "${TOP_LIST[@]}"; do
    [[ -d "$GLOBAL_CFG/$top" ]] || continue
    m=0; p=0
    printf '  %s\n' "$top"
    for child in "$GLOBAL_CFG/$top"/*; do
      [[ -e "$child" || -L "$child" ]] || continue
      if is_managed_link "$child"; then
        a="$(link_abs "$child")"
        rel="${a#"$CLONE"/}"
        item_selected "$rel" || continue
        printf '    M %-36s -> %s\n' "${child#"$GLOBAL_CFG/"}" "$a"
        m=$((m+1))
      else
        printf '    P %-36s\n' "${child#"$GLOBAL_CFG/"}"
        p=$((p+1))
      fi
    done
    info "$top: $m managed, $p private"
    total_m=$((total_m+m)); total_p=$((total_p+p))
  done
  info "config total: $total_m managed, $total_p private"
  step "Bin → $BIN_DIR"
  m=0; p=0
  [[ -d "$BIN_DIR" ]] || { info "no bin dir"; return 0; }
  for child in "$BIN_DIR"/*; do
    [[ -e "$child" || -L "$child" ]] || continue
    name="$(basename "$child")"
    if is_managed_bin_link "$child"; then
      item_selected "scripts/$name" || continue
      printf '    M %-36s -> %s\n' "bin/$name" "$(link_abs "$child")"
      m=$((m+1))
    else
      printf '    P %-36s\n' "bin/$name"
      p=$((p+1))
    fi
  done
  info "bin total: $m managed, $p private"
  return 0
}

action_diff() { # <ref>
  local ref="$1" ref_sha clone_sha="" line item changed_item changed=()
  step "Diff (ref: $ref)"
  ref_sha="$(git -C "$REPO" rev-parse --verify "refs/heads/$ref" 2>/dev/null || true)"
  [[ -n "$ref_sha" ]] || die "ref '$ref' not found in $REPO"
  info "ref   $ref @ $ref_sha"
  if [[ ! -d "$CLONE/.git" ]]; then
    info "clone not present — nothing deployed to compare"
    return 0
  fi
  clone_sha="$(git -C "$CLONE" rev-parse HEAD 2>/dev/null || true)"
  if [[ -z "$clone_sha" ]]; then
    info "clone has no HEAD"
    return 0
  fi
  info "clone $CLONE @ $clone_sha"
  git -C "$CLONE" fetch -q --no-tags origin "$ref" || die "cannot fetch '$ref' from $REPO"
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    item="$(printf '%s' "$line" | cut -d/ -f1-2)"
    case "${item%%/*}" in skills|agents|plugins|commands|instructions|lib|scripts) ;; *) continue ;; esac
    item_selected "$item" || continue
    for changed_item in "${changed[@]}"; do [[ "$changed_item" == "$item" ]] && continue 2; done
    changed+=("$item")
  done < <(git -C "$CLONE" diff --name-only "$clone_sha" FETCH_HEAD -- "${TOP_LIST[@]}" scripts 2>/dev/null || true)
  if [[ ${#changed[@]} -eq 0 ]]; then
    info "no changed items"
  else
    printf '  %s\n' "${changed[@]}"
  fi
  return 0
}

action_remove() {
  local top child a rel src name
  step "Remove → $GLOBAL_CFG"
  for top in "${TOP_LIST[@]}"; do
    [[ -d "$GLOBAL_CFG/$top" ]] || continue
    for child in "$GLOBAL_CFG/$top"/*; do
      [[ -L "$child" ]] || continue
      a="$(link_abs "$child" || true)"
      [[ "$a" == "$CLONE/"* ]] || continue
      src="${a#"$CLONE"/}"
      item_selected "$src" || continue
      rel="${child#"$GLOBAL_CFG/"}"
      if [[ $DRY -eq 1 ]]; then
        plan_row unlink "$rel" "managed symlink"
      else
        rm -f "$child"
        ok "unlinked $rel"
      fi
    done
  done
  step "Bin → $BIN_DIR"
  if [[ -d "$BIN_DIR" ]]; then
    for child in "$BIN_DIR"/*; do
      [[ -L "$child" ]] || continue
      a="$(link_abs "$child" || true)"
      [[ "$a" == "$DATA_BIN/"* ]] || continue
      name="$(basename "$child")"
      item_selected "scripts/$name" || continue
      if [[ $DRY -eq 1 ]]; then
        plan_row unlink "bin/$name" "managed bin symlink"
      else
        rm -f "$child"
        ok "unlinked bin/$name"
      fi
    done
  fi
  if [[ $DRY -eq 1 ]]; then
    plan_row unlink "${CLONE_POINTER#"$XDG_DATA"/}" "clone pointer"
  elif [[ -f "$CLONE_POINTER" ]]; then
    rm -f "$CLONE_POINTER"
    ok "removed clone pointer"
  fi
  if [[ $FORCE -eq 1 && $DRY -eq 0 && -f "$GLOBAL_CFG/$REPO_POINTER" ]]; then
    if [[ "$(cat "$GLOBAL_CFG/$REPO_POINTER")" == "$REPO" ]]; then
      rm -f "$GLOBAL_CFG/$REPO_POINTER"
      ok "removed repo pointer"
    fi
  fi
  return 0
}

# ── dispatch ─────────────────────────────────────────────────────────────────
load_tags_conf
if [[ ${#TAGS_SEL[@]} -gt 0 ]]; then
  validate_tag_selection
  warn_unused_patterns
  info "tag filter: ${TAGS_SEL[*]}"
fi

case "$COMMAND" in
  deploy) action_deploy "$REF" ;;
  list)   action_list ;;
  diff)   action_diff "$REF" ;;
  remove) action_remove ;;
esac
exit 0
