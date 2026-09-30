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
Usage: ${0##*/} [-b] [-c]

Install the required OpenCode setup.
  -b           also install the bonus skills
  -c, --check  print every required command, optional package, and installed
               artifact as [ok] or [missing], then exit. Installs nothing.
               Exits 1 if a required item is missing.
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

# Every check in one place, so `--check` and the install can never disagree.
# Format: name:package hint:skill that uses it. Blank hint = ships with the OS
# or the base install.
required_packages() {
  cat <<'PACKAGES'
opencode::the harness every skill runs in
git::the install itself
cargo::papercuts, bgrun, octask
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
bun:pacman -S bun-bin:ocv2-pluginhealth
PACKAGES
}

# What the install puts on disk. A path here is anything whose absence means a
# broken or partial setup, so check them all.
installed_items() {
  cat <<ITEMS
octask:scheduled-task
papercuts:the papercuts CLI
bgrun:the bgrun skill and CLI
skills:$HOME/.config/opencode/skills
agents:$HOME/.config/opencode/agents
plugins:$HOME/.config/opencode/plugins
commands:$HOME/.config/opencode/commands
values:$ROOT/.agent-values
reverse-skill:$HOME/.local/share/reverse-skill
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

  printf '\nInstalled by this script\n'
  while IFS=: read -r name path; do
    [[ -n "$name" ]] || continue
    if [[ "$path" == /* ]]; then
      if [[ -e "$path" ]]; then
        printf '  [ok]      %-16s %s\n' "$name" "$path"
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
