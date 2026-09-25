#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ -d "$HOME/.cargo/bin" ]]; then
  export PATH="$HOME/.cargo/bin:$PATH"
fi

DRY_RUN=0
REMOVE_EXTERNAL_PACKAGES=0
REMOVE_EXTERNAL_SKILLS=0

EXTERNAL_SKILLS=(
  mermaid-skill
  ask-matt code-review codebase-design diagnosing-bugs domain-modeling
  grill-with-docs implement improve-codebase-architecture prototype research
  resolving-merge-conflicts setup-matt-pocock-skills tdd to-spec to-tickets
  triage wayfinder wizard
  grill-me grilling handoff to-questionnaire wait-what writing-for-agents
  simple-english
  antislop antislop-code antislop-copywriting antislop-human antislop-layoutmobile antislop-ui
  ffmpeg-skill
)

usage() {
  cat <<EOF
Usage: ${0##*/} [--dry-run] [--external-packages] [--external-skills]

Remove this repository's installed files from the current user account.

Default:
  - Remove sync-managed skills, agents, plugins, commands, and scripts.
  - Uninstall the local Cargo package 'agent'.
  - Keep OpenCode, papercuts, external skills, OS packages, and this checkout.

Options:
  --dry-run              Show what would be removed without changing files.
  --external-packages    Also uninstall papercuts from this installer.
  --external-skills      Also remove the external skills installed by install.sh.
EOF
}

info() { printf '  %s\n' "$1"; }
die() { printf 'error: %s\n' "$1" >&2; exit 1; }

agent_installed() {
  local listing
  listing="$(cargo install --list 2>/dev/null || true)"
  grep -Eq '^agent v[^ ]+ ' <<<"$listing" && grep -Fq "($ROOT/scripts):" <<<"$listing"
}

papercuts_installed() {
  local listing
  listing="$(cargo install --list 2>/dev/null || true)"
  grep -Eq '^papercuts v[^ ]+ \(https://github\.com/FAZuH/papercuts[^)]*\):' <<<"$listing"
}

remove_sync_files() {
  if ((DRY_RUN)); then
    bash "$ROOT/sync.sh" remove -g -n
  else
    bash "$ROOT/sync.sh" remove -g -n >/dev/null
    bash "$ROOT/sync.sh" remove -g
  fi
}

remove_agent_package() {
  if ! command -v cargo >/dev/null 2>&1; then
    info 'cargo is unavailable; kept the local agent package'
    return
  fi
  if ! agent_installed; then
    info "local agent package is not installed from $ROOT/scripts; kept"
    return
  fi
  if ((DRY_RUN)); then
    info 'would uninstall local Cargo package agent (octask, phone-digest, mail-digest)'
  else
    cargo uninstall agent
  fi
}

remove_external_packages() {
  if ! command -v cargo >/dev/null 2>&1; then
    die 'cargo is required for --external-packages'
  fi
  if ! papercuts_installed; then
    info 'papercuts is not installed from FAZuH/papercuts; kept'
    return
  fi
  if ((DRY_RUN)); then
    info 'would uninstall Cargo package papercuts from FAZuH/papercuts'
  else
    cargo uninstall papercuts
  fi
}

remove_external_skills() {
  command -v npx >/dev/null 2>&1 || die 'npx is required for --external-skills'
  local skill
  for skill in "${EXTERNAL_SKILLS[@]}"; do
    if [[ ! -e "$HOME/.agents/skills/$skill" && ! -L "$HOME/.agents/skills/$skill" ]]; then
      continue
    fi
    if ((DRY_RUN)); then
      info "would remove external skill $skill"
    else
      npx --yes skills remove -g --agent opencode --yes "$skill"
    fi
  done
}

while (($#)); do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --external-packages) REMOVE_EXTERNAL_PACKAGES=1; shift ;;
    --external-skills) REMOVE_EXTERNAL_SKILLS=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown option: $1" ;;
  esac
done

[[ -f "$ROOT/sync.sh" ]] || die "missing $ROOT/sync.sh"
command -v python3 >/dev/null 2>&1 || die 'python3 is required'
if ((REMOVE_EXTERNAL_SKILLS)); then
  command -v npx >/dev/null 2>&1 || die 'npx is required for --external-skills'
fi
if ((REMOVE_EXTERNAL_PACKAGES)); then
  command -v cargo >/dev/null 2>&1 || die 'cargo is required for --external-packages'
fi

if ((DRY_RUN)); then
  info 'dry run: no files will be changed'
else
  info 'checking sync removal plan'
  bash "$ROOT/sync.sh" remove -g -n >/dev/null
fi

remove_sync_files
remove_agent_package
if ((REMOVE_EXTERNAL_PACKAGES)); then
  remove_external_packages
fi
if ((REMOVE_EXTERNAL_SKILLS)); then
  remove_external_skills
fi

printf '\nUninstall complete.\n'
