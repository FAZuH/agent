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
TMP_DIR=""

# Pinned versions of everything this script fetches: the skills CLI from npm,
# papercuts and the git checkouts by commit. Move a pin with the update-pins
# skill; it checks the remote and reports the diff before editing.
SKILLS_CLI_VERSION="1.7.0"
PAPERCUTS_REV="369b2aeb6f4d6414ddaf2df71d90c8a0419e06bf"
BGRUN_REV="2d2c81818a6afeb1091c993b06f630b7727737b1"
FFMPEG_SKILL_REV="df5d2736b171473742b86789e5179bdfb0976373"
REVERSE_SKILL_REV="cab634bd855fc287f6e420c1f36fd1a6b9245960"

usage() {
  cat <<EOF
Usage: ${0##*/} [-b]

Install the required OpenCode setup.
  -b  also install the bonus skills
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

# reverse-skill is a repository, not a skill package: its routing scripts read
# paths relative to the checkout, and upstream says to keep the whole root.
install_reverse_skill() {
  local target="$HOME/.local/share/reverse-skill"
  if [[ -d "$target/.git" ]]; then
    git -C "$target" fetch -q --depth 1 origin "$REVERSE_SKILL_REV"
    git -C "$target" checkout -q --detach FETCH_HEAD
  else
    [[ ! -e "$target" ]] || die "$target exists and is not a reverse-skill checkout"
    clone_pinned https://github.com/zhaoxuya520/reverse-skill "$REVERSE_SKILL_REV" "$target"
  fi
  bash "$target/skills/scripts/refresh-tool-index.sh"
  info "installed reverse-skill to $target"
}

if [[ ${1:-} == "-b" ]]; then
  BONUS=1
  shift
fi
case "${1:-}" in
  -h|--help) usage; exit 0 ;;
esac
if (($# != 0)); then
  usage >&2
  exit 2
fi

step "Checking prerequisites"
for command in git cargo npx rsync python3; do
  require_command "$command"
done
# Shipped skills shell out to these with no fallback: jq backs the ocv2 and
# forkflow scripts, gh backs every PR, issue, and release skill.
require_command jq "pacman -S jq"
require_command gh "pacman -S github-cli"
check_opencode
((BONUS == 0)) || require_command ffmpeg
npx --yes "skills@$SKILLS_CLI_VERSION" --help >/dev/null 2>&1 || die "npx skills is unavailable"
info "required commands found"

# Tools a skill calls only on some paths. Every one of them has a documented
# fallback or a gate, so a missing tool degrades that skill instead of the
# install: report it and keep going.
while IFS=: read -r tool hint; do
  [[ -n "$tool" ]] || continue
  command -v "$tool" >/dev/null 2>&1 || info "note: $tool missing — $hint"
done <<'PACKAGES'
opencode2:ships with the opencode installer, not with this script
mmdc:pacman -S mermaid-cli        # visualize, pdf-write
rsvg-convert:pacman -S librsvg    # visualize
pandoc:pacman -S pandoc-cli       # pdf-write
pdflatex:pacman -S texlive-latex-recommended
xelatex:pacman -S texlive-xetex
pdftotext:pacman -S poppler       # pdf-read, pdf-write
pdftoppm:pacman -S poppler
pdfinfo:pacman -S poppler
rga:pacman -S ripgrep-all         # pdf-read
uv:pacman -S uv                   # pdf-read
clamscan:pacman -S clamav         # malware-check, omarchy-plugin-install
bun:pacman -S bun-bin             # ocv2-pluginhealth
PACKAGES

step "Installing required skills"
install_skill Agents365-ai/365-skills --skill mermaid-skill
install_skill https://github.com/mattpocock/skills/tree/main/skills/engineering --skill '*'
install_skill https://github.com/mattpocock/skills/tree/main/skills/productivity --skill grill-me grilling handoff to-questionnaire wait-what writing-for-agents
install_skill AminBlg/SimpleEnglish --skill simple-english
install_skill FAZuH/bgrun --skill bgrun
install_skill DietrichGebert/ponytail --skill ponytail ponytail-review ponytail-audit \
  ponytail-debt ponytail-gain ponytail-help
cargo install --git https://github.com/FAZuH/papercuts --rev "$PAPERCUTS_REV"
cargo install --git https://github.com/FAZuH/bgrun --rev "$BGRUN_REV"

step "Installing repository packages"
ensure_agent_values
git -C "$ROOT" submodule update --init
cargo install --path "$ROOT/scripts"

step "Pushing OpenCode configuration"
"$ROOT/sync.sh" push -g

if ((BONUS == 1)); then
  step "Installing bonus skills"
  install_skill miqdadbadjuber/anti-slop
  install_ffmpeg_skill
  install_reverse_skill
fi

printf '\nInstallation complete. Restart OpenCode to load the configuration.\n'
