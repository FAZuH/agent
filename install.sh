#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# rustup keeps cargo outside the default PATH, and a non-login shell — ssh, a
# systemd timer, CI — never sources the profile that adds it. A self-installed
# OpenCode sits in the same spot, so look there too before giving up on both.
if [[ -d "$HOME/.cargo/bin" ]]; then
  export PATH="$HOME/.cargo/bin:$PATH"
fi
if ! command -v opencode >/dev/null 2>&1 && [[ -x "$HOME/.opencode/bin/opencode" ]]; then
  export PATH="$HOME/.opencode/bin:$PATH"
fi

BONUS=0
CHECK=0
DIGEST_MAIL=0
DIGEST_PHONE=0
TMP_DIR=""

# Pinned versions of everything this script fetches: the skills and rea-agents
# npm packages by version, and the git checkouts by commit. Move a
# pin with the update-pins skill; it checks the remote and reports the diff
# before editing.
SKILLS_CLI_VERSION="1.7.0"
BGRUN_REV="2d2c81818a6afeb1091c993b06f630b7727737b1"
FFMPEG_SKILL_REV="df5d2736b171473742b86789e5179bdfb0976373"
REA_AGENTS_VERSION="6.4.0"
# jegrep v0.1.3. A tag object dereferences to the commit cargo actually builds.
JEGREP_REV="c84f4561c081c9bcef494384d69c6e55012ca0da"

GLOBAL_AGENTS_MD="$HOME/.config/opencode/AGENTS.md"
GLOBAL_INSTRUCTION_SKILL="skills/shared/global-instruction/SKILL.md"
GI_START="<!-- global-instruction:start -->"
GI_END="<!-- global-instruction:end -->"

usage() {
  cat <<EOF
Usage: ${0##*/} [-b] [-c] [--digest|--mail-digest|--phone-digest]

Install the required OpenCode setup. Digest agents are opt-in.
  -b             also install the bonus skills
  -c, --check    print every required command, optional package, and installed
                 artifact as [ok] or [missing], then exit. Installs nothing.
                 Exits 1 if a required item is missing.
  --mail-digest  deploy the mail digest agent and its schedule
  --phone-digest deploy the phone digest agent and its schedule
  --digest       both digests (same as --mail-digest --phone-digest)
EOF
}

info() { printf '  %s\n' "$1"; }
step() { printf '\n==> %s\n' "$1"; }
die() { printf 'error: %s\n' "$1" >&2; exit 1; }

require_command() { # <command> [hint]
  command -v "$1" >/dev/null 2>&1 || die "missing $1${2:+ — install it with: $2}"
}

check_opencode() {
  local version
  version="$(opencode --version 2>&1)" || die "could not run opencode --version"
  [[ "$version" =~ (^|[[:space:]])v?2(\.|$) ]] || die "OpenCode v2 is required (found: $version)"
  info "opencode $version"
}

# Print the global-instruction skill's body: everything after the YAML
# frontmatter, without its surrounding blank lines. The frontmatter is
# skill-loader metadata, not instructions, and `---` inside AGENTS.md would
# read as a horizontal rule at worst.
skill_body() { # <path>
  awk '
    NR==1 && $0=="---" {fm=1; next}
    fm && $0=="---" {fm=0; body=1; next}
    body {print}
  ' "$1" | sed '/./,$!d' | tac | sed '/./,$!d' | tac
}

# Embed the common rules straight into the host AGENTS.md, at the bottom, once.
# A pointer to the skill cannot do this: the rules are only read when something
# makes the agent load it, and "NEVER SKIP" has to not depend on that.
#
# The block is delimited by markers and rewritten from the skill every run, so
# editing the skill updates AGENTS.md on the next install instead of leaving a
# stale copy to drift. `check` reports drift without writing; --check installs
# nothing.
ensure_global_instruction_ref() { # [check]
  local skill="$ROOT/$GLOBAL_INSTRUCTION_SKILL"
  local body
  local drifted=0

  if [[ ! -f "$GLOBAL_AGENTS_MD" ]]; then
    info "note: $GLOBAL_AGENTS_MD does not exist, so no rules were embedded"
    return 0
  fi
  if [[ ! -f "$skill" ]]; then
    info "note: $skill is missing, so no rules were embedded"
    return 0
  fi
  body="$(skill_body "$skill")"
  if [[ -z "$body" ]]; then
    info "note: $skill has no body after its frontmatter"
    return 0
  fi

  # Drop any existing block, then re-append one at the bottom, so editing the
  # skill updates AGENTS.md on the next install instead of leaving a stale copy
  # to drift. This also migrates a file written by the older two-copy installer:
  # both its blocks are removed here and only the bottom one comes back.
  #
  # One line is held back so the blank line before a block is dropped with it.
  # Printing them makes the file grow by a blank line per run, so the comparison
  # below never matches and every install rewrites. Holding a line does not
  # collapse runs of blank lines, so untouched parts of the file come out
  # byte-identical.
  # A blank line is the empty string in awk, so "is there a held line" needs its
  # own flag: testing `held != ""` would drop every blank line in the file.
  awk -v s="$GI_START" -v e="$GI_END" '
    function flush() { if (has) { print held; has = 0 } }
    NR == 1 { held = $0; has = 1; next }
    $0 == s { if (held ~ /^[[:space:]]*$/) has = 0; inblock = 1; next }
    $0 == e { inblock = 0; next }
    inblock { next }
    { flush(); held = $0; has = 1 }
    END { flush() }
  ' "$GLOBAL_AGENTS_MD" >"$GLOBAL_AGENTS_MD.tmp" || return 1

  {
    cat "$GLOBAL_AGENTS_MD.tmp"
    printf '\n%s\n\n%s\n%s\n' "$GI_START" "$body" "$GI_END"
  } >"$GLOBAL_AGENTS_MD.tmp2" || return 1

  if [[ "${1:-}" == check ]]; then
    if cmp -s "$GLOBAL_AGENTS_MD.tmp2" "$GLOBAL_AGENTS_MD"; then
      info "global AGENTS.md embeds the current $GLOBAL_INSTRUCTION_SKILL"
    else
      info "note: $GLOBAL_AGENTS_MD is stale or missing the embedded rules"
    fi
    rm -f "$GLOBAL_AGENTS_MD.tmp" "$GLOBAL_AGENTS_MD.tmp2"
    return 0
  fi

  if cmp -s "$GLOBAL_AGENTS_MD.tmp2" "$GLOBAL_AGENTS_MD"; then
    drifted=0
  else
    mv "$GLOBAL_AGENTS_MD.tmp2" "$GLOBAL_AGENTS_MD" && drifted=1
  fi
  rm -f "$GLOBAL_AGENTS_MD.tmp" "$GLOBAL_AGENTS_MD.tmp2"

  if ((drifted)); then
    info "embedded the $GLOBAL_INSTRUCTION_SKILL rules at the bottom of $GLOBAL_AGENTS_MD"
  else
    info "global AGENTS.md already embeds the current rules"
  fi
  return 0
}

# mermaid-cli v12 dropped -w/--width for --size, and both pdf-build and the
# mermaid plugin pass --size, so v11 dies on the first diagram. Soft tier: a
# note, like a missing mmdc, because a skill degrades rather than breaking.
check_mmdc() {
  local version
  command -v mmdc >/dev/null 2>&1 || return 0
  version="$(mmdc -V 2>&1)" || version=""
  case "$version" in
  12.*) ;;
  *) info "note: mmdc ${version:-unknown} — v12 is required, it replaced -w/--width with --size" ;;
  esac
}

cleanup() {
  if [[ -n "$TMP_DIR" ]]; then
    rm -rf -- "$TMP_DIR"
  fi
}
trap cleanup EXIT

install_skill() {
  local repo="$1"
  shift
  npx --yes "skills@$SKILLS_CLI_VERSION" add "$repo" --global --agent opencode --yes "$@"
}

# Fetch one pinned commit into a fresh directory: a shallow clone of a branch
# would drift off the pin on every run.
clone_pinned() { # <url> <rev> <dir>
  git init -q "$3"
  git -C "$3" remote add origin "$1"
  git -C "$3" fetch -q --depth 1 origin "$2"
  git -C "$3" checkout -q --detach FETCH_HEAD
}

ensure_agent_values() {
  local values="$ROOT/.agent-values"
  if [[ -e "$values" && ! -f "$values" ]]; then
    die "$values exists but is not a regular file"
  fi
  if [[ -f "$values" ]]; then
    info "using existing .agent-values"
    return
  fi
  [[ -f "$ROOT/.agent-values.example" ]] || die "missing .agent-values.example"
  {
    sed '/^USER_HOME=/d' "$ROOT/.agent-values.example"
    printf 'USER_HOME=%s\n' "$HOME"
  } > "$values"
  info "created .agent-values"
}

# digest/<name>/... mirrors to ~/.config/fazuh-agent/digest/<name>/... with
# {{USER_HOME}} substituted. Only the named digests are deployed; dest dirs
# with no repo source are removed.
deploy_digest() { # <digest-name>...
  local src="$ROOT/digest" dest="$HOME/.config/fazuh-agent/digest" name target f
  (($#)) || return 0
  [[ -d "$src" ]] || return 0
  mkdir -p "$dest"
  for name in "$@"; do
    [[ -d "$src/$name" ]] || continue
    target="$dest/$name"
    mkdir -p "$target"
    rsync -a --delete "$src/$name/" "$target/"
    while IFS= read -r -d '' f; do
      grep -q '{{USER_HOME}}' "$f" 2>/dev/null || continue
      sed -i "s|{{USER_HOME}}|$HOME|g" "$f"
    done < <(find "$target" -type f -print0)
  done
  for target in "$dest"/*/; do
    [[ -d "$target" ]] || continue
    [[ -d "$src/$(basename "$target")" ]] || rm -rf "$target"
  done
  info "deployed digest agents ($*) to $dest"
}

install_ffmpeg_skill() {
  local source target path
  TMP_DIR="$(mktemp -d)"
  clone_pinned https://github.com/kajisho5/ffmpeg-skill "$FFMPEG_SKILL_REV" "$TMP_DIR/ffmpeg-skill"
  source="$TMP_DIR/ffmpeg-skill"
  target="$HOME/.agents/skills/ffmpeg-skill"

  for path in SKILL.md scripts references docs package.json; do
    [[ -e "$source/$path" ]] || die "ffmpeg-skill is missing $path"
  done

  mkdir -p "$target"
  cp "$source/SKILL.md" "$target/SKILL.md"
  cp "$source/package.json" "$target/package.json"
  for path in scripts references docs; do
    mkdir -p "$target/$path"
    cp -R "$source/$path/." "$target/$path/"
  done
  python3 "$target/scripts/_contract.py" doctor
  info "installed ffmpeg-skill"
}

# REA registers itself through its own CLI: setup writes a local MCP server
# entry into OpenCode's config and installs the matching skill. The registration
# pins to the package-runner version, so uninstall reverses the same one.
install_rea() {
  npx --yes "rea-agents@$REA_AGENTS_VERSION" setup --client opencode --yes
  info "registered REA with OpenCode (rea-agents $REA_AGENTS_VERSION)"
}

# jegrep is the semantic-grep binary the jev plugin shells out to. It reads
# OPENROUTER_API_KEY or TYPESAFE_API_KEY, neither of which this machine has; the
# plugin's loopback shim injects the provider key instead, so a missing
# install only costs use case 3.
install_jegrep() {
  if command -v jegrep >/dev/null 2>&1; then
    info "jegrep already installed"
    return
  fi
  cargo install --git https://github.com/can1357/jegrep --rev "$JEGREP_REV" --locked
  info "installed jegrep (use it with JEGREP_ENDPOINT_URL pointed at the jev shim)"
}

# Every check in one place, so `--check` and the install can never disagree.
# Format: name:package hint:skill that uses it. Blank hint = ships with the OS
# or the base install.
required_packages() {
  cat <<'PACKAGES'
opencode::the harness every skill runs in
git::the install itself
cargo::bgrun, octask
npx::the skills CLI
rsync::sync.sh
python3::install.sh, skill-doctor
jq:pacman -S jq:the ocv2 and forkflow scripts
gh:pacman -S github-cli:every PR, issue, and release skill
PACKAGES
}

# Tools a skill calls only on some paths. Each has a documented fallback or a
# gate, so a missing one degrades that skill instead of the install.
optional_packages() {
  cat <<'PACKAGES'
ffmpeg:pacman -S ffmpeg:the ffmpeg-skill
opencode2::the OpenCode v2 API skills
mmdc:pacman -S mermaid-cli:visualize, pdf-write
rsvg-convert:pacman -S librsvg:visualize
pandoc:pacman -S pandoc-cli:pdf-write
pdflatex:pacman -S texlive-latex-recommended:pdf-write
xelatex:pacman -S texlive-xetex:pdf-write
pdftotext:pacman -S poppler:pdf-read, pdf-write
pdftoppm:pacman -S poppler:pdf-read, pdf-write
pdfinfo:pacman -S poppler:pdf-write
rga:pacman -S ripgrep-all:pdf-read
uv:pacman -S uv:pdf-read
clamscan:pacman -S clamav:malware-check, omarchy-plugin-install
bun:pacman -S bun-bin:opencode-guideline, the jev plugin
jegrep::the jev plugin's semantic grep
PACKAGES
}

# What the install puts on disk. A path here is anything whose absence means a
# broken or partial setup, so check them all.
installed_items() {
  cat <<ITEMS
octask:scheduled-task
bgrun:the bgrun skill and CLI
skills:$HOME/.config/opencode/skills
agents:$HOME/.config/opencode/agents
plugins:$HOME/.config/opencode/plugins
commands:$HOME/.config/opencode/commands
digest-mail:$HOME/.config/fazuh-agent/digest/mail-digest/.opencode/agents/mail-digest.md
digest-phone:$HOME/.config/fazuh-agent/digest/phone-digest/.opencode/agents/phone-digest.md
values:$ROOT/.agent-values
rea:$HOME/.agents/skills/reverse-engineer-anything
ITEMS
}

# Print the checklist. Nothing is installed and nothing is written.
checklist() {
  local name package skill path version missing=0
  step "Checklist"

  printf '\nRequired\n'
  while IFS=: read -r name package skill; do
    [[ -n "$name" ]] || continue
    if [[ "$name" == opencode ]]; then
      if version="$(opencode --version 2>&1)" && [[ "$version" =~ (^|[[:space:]])v?2(\.|$) ]]; then
        printf '  [ok]      %-16s %s\n' "$name" "$version"
      else
        printf '  [MISSING] %-16s %s\n' "$name" "OpenCode v2 is required"
        missing=1
      fi
      continue
    fi
    if command -v "$name" >/dev/null 2>&1; then
      printf '  [ok]      %-16s %s\n' "$name" "$skill"
    else
      printf '  [MISSING] %-16s %s\n' "$name" "${package:-not found} — $skill"
      missing=1
    fi
  done < <(required_packages)

  printf '\nOptional — each skill above still runs without its tool\n'
  while IFS=: read -r name package skill; do
    [[ -n "$name" ]] || continue
    if command -v "$name" >/dev/null 2>&1; then
      printf '  [ok]      %-16s %s\n' "$name" "$skill"
    else
      printf '  [missing] %-16s %s\n' "$name" "${package:-not on PATH} — $skill"
    fi
  done < <(optional_packages)

  check_mmdc

  printf '\nHost configuration\n'
  ensure_global_instruction_ref check

  printf '\nInstalled by this script\n'
  while IFS=: read -r name path; do
    [[ -n "$name" ]] || continue
    if [[ "$path" == /* ]]; then
      if [[ -e "$path" ]]; then
        printf '  [ok]      %-16s %s\n' "$name" "$path"
      elif [[ "$name" == digest-* ]]; then
        printf '  [off]     %-16s %s — enable with --%s-digest\n' \
          "$name" "$path" "${name#digest-}"
      else
        printf '  [MISSING] %-16s %s\n' "$name" "$path"
        missing=1
      fi
    elif command -v "$name" >/dev/null 2>&1; then
      printf '  [ok]      %-16s %-28s %s\n' "$name" "$(command -v "$name")" "$path"
    else
      printf '  [MISSING] %-16s %-28s %s\n' "$name" "-" "$path"
      missing=1
    fi
  done < <(installed_items)

  if ((missing == 0)); then
    printf '\nAll required items are present.\n'
  else
    printf '\nRun ./install.sh to install what is missing.\n'
  fi
  return "$missing"
}

while (($#)); do
  case "$1" in
    -b) BONUS=1 ;;
    -c|--check) CHECK=1 ;;
    --mail-digest) DIGEST_MAIL=1 ;;
    --phone-digest) DIGEST_PHONE=1 ;;
    --digest) DIGEST_MAIL=1; DIGEST_PHONE=1 ;;
    -h|--help) usage; exit 0 ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
  shift
done

if ((CHECK == 1)); then
  checklist
  exit $?
fi

step "Checking prerequisites"
while IFS=: read -r tool package skill; do
  [[ -n "$tool" && "$tool" != opencode ]] || continue
  command -v "$tool" >/dev/null 2>&1 || die "missing $tool${package:+ — install it with: $package}"
done < <(required_packages)
check_opencode
npx_err="$(mktemp)" || die "could not create a temp file"
if ! npx --yes "skills@$SKILLS_CLI_VERSION" --help >/dev/null 2>"$npx_err"; then
  die "npx skills@$SKILLS_CLI_VERSION is unavailable: $(head -c 200 "$npx_err" | tr '\n' ' ')"
fi
rm -f "$npx_err"
info "required commands found"

while IFS=: read -r tool package skill; do
  [[ -n "$tool" ]] || continue
  command -v "$tool" >/dev/null 2>&1 || info "note: $tool missing — $package"
done < <(optional_packages)
check_mmdc

step "Installing required skills"
install_skill Agents365-ai/365-skills --skill mermaid-skill
install_skill https://github.com/mattpocock/skills/tree/main/skills/engineering --skill '*'
install_skill https://github.com/mattpocock/skills/tree/main/skills/productivity --skill '*'
install_skill AminBlg/SimpleEnglish --skill simple-english
install_skill FAZuH/bgrun --skill bgrun
# Not bonus: global-instruction makes @antislop a mandatory load
# every session, and a default install that omits it leaves that dangling.
install_skill miqdadbadjuber/anti-slop
# The hindsight repo carries a full docs site; its clone blows past the skills
# CLI's 300s default on a slow link and aborts the whole run, so raise the cap.
SKILLS_CLONE_TIMEOUT_MS=900000 install_skill https://github.com/vectorize-io/hindsight --skill hindsight-docs
cargo install --git https://github.com/FAZuH/bgrun --rev "$BGRUN_REV"

step "Installing repository packages"
ensure_agent_values
git -C "$ROOT" submodule update --init
cargo install --path "$ROOT/scripts"

# Digests are opt-in: --mail-digest, --phone-digest, or --digest for both.
if ((DIGEST_MAIL || DIGEST_PHONE)); then
  step "Deploying digest agents and schedules"
  DIGESTS=()
  if ((DIGEST_MAIL)); then DIGESTS+=("mail-digest"); fi
  if ((DIGEST_PHONE)); then DIGESTS+=("phone-digest"); fi
  deploy_digest "${DIGESTS[@]}"
  # Override the unattended model with DIGEST_MODEL=... ./install.sh
  DIGEST_MODEL="${DIGEST_MODEL:-opencode/mimo-v2.6-flash-free}"
  if ((DIGEST_MAIL)); then
    "$HOME/.cargo/bin/mail-digest" setup --model "$DIGEST_MODEL" \
      --workdir "$HOME/.config/fazuh-agent/digest/mail-digest"
  fi
  if ((DIGEST_PHONE)); then
    "$HOME/.cargo/bin/phone-digest" setup --model "$DIGEST_MODEL" \
      --workdir "$HOME/.config/fazuh-agent/digest/phone-digest"
  fi
fi

step "Pushing OpenCode configuration"
"$ROOT/sync.sh" push -g
ensure_global_instruction_ref

if ((BONUS == 1)); then
  step "Installing bonus skills"
  install_ffmpeg_skill
  install_rea
  install_jegrep
  install_skill adithya-s-k/manim_skill
  install_skill https://fframes.studio
  install_skill cloudflare/security-audit-skill --skill security-audit
  install_skill docker/skills
fi

printf '\nInstallation complete. Restart OpenCode to load the configuration.\n'
