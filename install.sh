#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BONUS=0
TMP_DIR=""

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

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "missing $1"
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
  npx --yes skills add "$repo" --global --agent opencode --yes "$@"
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
  git clone --depth 1 https://github.com/kajisho5/ffmpeg-skill "$TMP_DIR/ffmpeg-skill"
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
check_opencode
((BONUS == 0)) || require_command ffmpeg
npx --yes skills --help >/dev/null 2>&1 || die "npx skills is unavailable"
info "required commands found"

step "Installing required skills"
install_skill Agents365-ai/365-skills --skill mermaid-skill
install_skill https://github.com/mattpocock/skills/tree/main/skills/engineering --skill '*'
install_skill https://github.com/mattpocock/skills/tree/main/skills/productivity --skill grill-me grilling handoff to-questionnaire wait-what writing-for-agents
install_skill AminBlg/SimpleEnglish --skill simple-english
cargo install --git https://github.com/FAZuH/papercuts

step "Installing repository packages"
ensure_agent_values
git -C "$ROOT" submodule update --init
cargo install --path "$ROOT"

step "Pushing OpenCode configuration"
"$ROOT/sync.sh" push -g

if ((BONUS == 1)); then
  step "Installing bonus skills"
  install_skill miqdadbadjuber/anti-slop
  install_ffmpeg_skill
fi

printf '\nInstallation complete. Restart OpenCode to load the configuration.\n'
