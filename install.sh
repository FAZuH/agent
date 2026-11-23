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

# Pinned versions of everything this script fetches: the skills and
# rea-agents npm packages by version, and the git checkouts by
# commit. Move a pin with the update-pins skill; it checks the remote and
# reports the diff before editing.
SKILLS_CLI_VERSION="1.7.0"
BGRUN_REV="2d2c81818a6afeb1091c993b06f630b7727737b1"
FFMPEG_SKILL_REV="df5d2736b171473742b86789e5179bdfb0976373"
REA_AGENTS_VERSION="6.4.0"

GLOBAL_CONFIG="$HOME/.config/opencode/opencode.json"
# The global config loads every instruction file through this glob, so adding a
# file to instructions/ needs no config edit. ~/ resolves from the home dir.
INSTRUCTIONS_GLOB='~/.config/opencode/instructions/*.md'
INSTRUCTIONS_HELPER="$ROOT/scripts/opencode-instructions.py"

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

# Point the global config at instructions/ so every .md there loads in every
# session, on any project. The rules have to load without something making the
# agent open a file first.
#
# The glob entry means a new instruction file needs no config change. The edit
# is textual (see scripts/opencode-instructions.py) because the config is
# hand-formatted and a json.dump round-trip would reflow every model entry.
ensure_instructions_config() { # [check]
  local rc=0

  if [[ ! -f "$GLOBAL_CONFIG" ]]; then
    info "note: $GLOBAL_CONFIG does not exist, so no instructions were wired"
    return 0
  fi

  if [[ "${1:-}" == check ]]; then
    python3 "$INSTRUCTIONS_HELPER" check "$GLOBAL_CONFIG" "$INSTRUCTIONS_GLOB" || rc=$?
    case "$rc" in
    0) info "$GLOBAL_CONFIG loads $INSTRUCTIONS_GLOB" ;;
    1) info "note: $GLOBAL_CONFIG does not load $INSTRUCTIONS_GLOB" ;;
    *) info "note: could not read $GLOBAL_CONFIG" ;;
    esac
    return 0
  fi

  python3 "$INSTRUCTIONS_HELPER" ensure "$GLOBAL_CONFIG" "$INSTRUCTIONS_GLOB" || {
    info "note: could not wire $GLOBAL_CONFIG to $INSTRUCTIONS_GLOB"
    return 0
  }
  info "$GLOBAL_CONFIG loads every file in $INSTRUCTIONS_GLOB"
}

# Preload terse and antislop-copywriting as instructions: a link in
# instructions/ loads the skill body with the config, and it points at the
# deployed skill, so a skill update lands with no second step.
SKILL_INSTRUCTION_LINKS=(
  "terse=$HOME/.config/opencode/skills/terse/SKILL.md"
  "antislop-copywriting=$HOME/.agents/skills/antislop-copywriting/SKILL.md"
)
ensure_skill_instructions() { # [check]
  local pair name src dir tgt
  dir="$HOME/.config/opencode/instructions"

  for pair in "${SKILL_INSTRUCTION_LINKS[@]}"; do
    name="${pair%%=*}"
    src="${pair#*=}"
    tgt="$dir/$name.md"

    if [[ ! -f "$src" ]]; then
      info "note: $name is not deployed, so no instruction link"
      continue
    fi

    if [[ "${1:-}" == check ]]; then
      if [[ -L "$tgt" && "$(readlink -f "$tgt")" == "$(readlink -f "$src")" ]]; then
        printf '  [ok]      %-36s %s\n' "instructions/$name.md" "$src"
      else
        printf '  [MISSING] %-36s %s\n' "instructions/$name.md" "link to $src"
      fi
      continue
    fi

    mkdir -p "$dir"
    if [[ -e "$tgt" && ! -L "$tgt" ]]; then
      info "note: $tgt is a real file, left alone"
      continue
    fi
    ln -sfn "$src" "$tgt"
    info "linked $tgt -> $src"
  done
}

# mermaid-cli v12 dropped -w/--width for --size, and pdf-build passes --size,
# so v11 dies on the first diagram. Soft tier: a
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

# Every check in one place, so `--check` and the install can never disagree.
# Format: name:package hint:skill that uses it. Blank hint = ships with the OS
# or the base install.
required_packages() {
  cat <<'PACKAGES'
opencode::the harness every skill runs in
git::the install itself
cargo::bgrun, octask
npx::the skills CLI
rsync::install.sh digest deploy
python3::install.sh, skill-doctor
zele:npm i -g zele:the fazuh-email skill and mail search
jq:pacman -S jq:the ocv2 scripts
gh:pacman -S github-cli:every PR, issue, and release skill
PACKAGES
}

# Tools a skill calls only on some paths. Each has a documented fallback or a
# gate, so a missing one degrades that skill instead of the install.
optional_packages() {
  cat <<'PACKAGES'
ffmpeg:pacman -S ffmpeg:the ffmpeg-skill
opencode2::the OpenCode v2 API skills
mmdc:pacman -S mermaid-cli:pdf-write
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
PACKAGES
}

CLONE_PATH_FILE="$(realpath -m "${XDG_DATA_HOME:-$HOME/.local/share}/fazuh-agent/.clone-path")"

# Managed entries are symlinks into the deployed clone; real entries are
# machine-private. Both count as installed when their target resolves.
deployed_present() { # <path>
  local clone target
  if [[ -e "$1" && ! -L "$1" ]]; then
    return 0
  fi
  [[ -f "$CLONE_PATH_FILE" ]] || return 1
  IFS= read -r clone < "$CLONE_PATH_FILE" || return 1
  [[ -n "$clone" && -d "$clone" ]] || return 1
  [[ -L "$1" ]] || return 1
  target="$(readlink -f -- "$1" 2>/dev/null)" || return 1
  [[ "$target" == "$clone"/* && -e "$target" ]]
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
instructions:$HOME/.config/opencode/instructions
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
  ensure_instructions_config check
  ensure_skill_instructions check

  printf '\nInstalled by this script\n'
  while IFS=: read -r name path; do
    [[ -n "$name" ]] || continue
    if [[ "$path" == /* ]]; then
      if deployed_present "$path"; then
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
# Explicit names, never --skill '*': the wildcard follows upstream HEAD, so a
# new upstream skill lands unlisted and unremovable. Add a name here, in
# uninstall.sh EXTERNAL_SKILLS, and in the README together. `pr` is excluded on
# purpose: this repo's pr-creator owns PR bodies.
install_skill https://github.com/mattpocock/skills/tree/main/skills/engineering \
  --skill ask-matt code-review codebase-design diagnosing-bugs domain-modeling \
  grill-with-docs implement improve-codebase-architecture prototype research \
  resolving-merge-conflicts setup-matt-pocock-skills tdd to-spec to-tickets \
  triage wayfinder wizard
install_skill https://github.com/mattpocock/skills/tree/main/skills/productivity \
  --skill grill-me grilling handoff teach to-questionnaire wait-what writing-for-agents
install_skill AminBlg/SimpleEnglish --skill simple-english
install_skill FAZuH/bgrun --skill bgrun
install_skill vercel/board --skill board
# Not bonus: the install links @antislop-copywriting into the instructions, so a
# default install that omits it leaves that link dangling.
install_skill miqdadbadjuber/anti-slop --skill antislop antislop-code antislop-copywriting antislop-layoutmobile
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
  DIGEST_MODEL="${DIGEST_MODEL:-commandcode/deepseek/deepseek-v4.1-flash}"
  if ((DIGEST_MAIL)); then
    "$HOME/.cargo/bin/mail-digest" setup --model "$DIGEST_MODEL" \
      --workdir "$HOME/.config/fazuh-agent/digest/mail-digest"
  fi
  if ((DIGEST_PHONE)); then
    "$HOME/.cargo/bin/phone-digest" setup --model "$DIGEST_MODEL" \
      --workdir "$HOME/.config/fazuh-agent/digest/phone-digest"
  fi
fi

step "Deploying OpenCode configuration"
"$ROOT/sync.sh" deploy
ensure_instructions_config
ensure_skill_instructions

if ((BONUS == 1)); then
  step "Installing bonus skills"
  install_ffmpeg_skill
  install_rea
  install_skill cloudflare/security-audit-skill --skill security-audit
fi

printf '\nInstallation complete. Deploy does not restart OpenCode.\n'
