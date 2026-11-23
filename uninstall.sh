#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ -d "$HOME/.cargo/bin" ]]; then
  export PATH="$HOME/.cargo/bin:$PATH"
fi

DRY_RUN=0
REMOVE_EXTERNAL_PACKAGES=0
REMOVE_EXTERNAL_SKILLS=0
REMOVE_INSTRUCTIONS=0

EXTERNAL_SKILLS=(
  mermaid-skill
  ask-matt code-review codebase-design diagnosing-bugs domain-modeling
  grill-with-docs implement improve-codebase-architecture prototype research
  resolving-merge-conflicts setup-matt-pocock-skills tdd to-spec to-tickets
  triage wayfinder wizard
  grill-me grilling handoff teach to-questionnaire wait-what writing-for-agents
  simple-english
  hindsight-docs
  bgrun
  board
  antislop antislop-code antislop-copywriting antislop-human antislop-layoutmobile antislop-ui
  ffmpeg-skill
)

# Must match the pins in install.sh; a newer CLI cannot remove what it did not
# write. The update-pins skill moves both together.
SKILLS_CLI_VERSION="1.7.0"
REA_AGENTS_VERSION="6.4.0"

usage() {
  cat <<EOF
Usage: ${0##*/} [--dry-run] [--external-packages] [--external-skills]

Remove this repository's installed files from the current user account.

Default:
  - Remove sync-managed skills, agents, plugins, commands, and scripts.
  - Uninstall the local Cargo package 'agent'.
  - Keep OpenCode, bgrun, external skills, OS packages, and this
    checkout.

Options:
  --dry-run              Show what would be removed without changing files.
  --external-packages    Also uninstall bgrun from this installer.
  --external-skills      Also remove the external skills installed by install.sh,
                         including the REA registration and skill.
  --instructions         Also stop the global OpenCode config from loading
                         ~/.config/opencode/instructions/*.md. The default
                         keeps the config entry and the instruction files, so
                         a reinstall needs no re-wiring.
EOF
}

info() { printf '  %s\n' "$1"; }
die() { printf 'error: %s\n' "$1" >&2; exit 1; }

agent_installed() {
  local listing
  listing="$(cargo install --list 2>/dev/null || true)"
  grep -Eq '^agent v[^ ]+ ' <<<"$listing" && grep -Fq "($ROOT/scripts):" <<<"$listing"
}

remove_sync_files() {
  if ((DRY_RUN)); then
    bash "$ROOT/sync.sh" remove -n
  else
    bash "$ROOT/sync.sh" remove -n >/dev/null
    bash "$ROOT/sync.sh" remove
  fi
}

# Digest agent defs are deployed by install.sh, not sync.sh, so they need
# their own removal. Only digest/ goes; notes, secrets, and data stay.
remove_digest() {
  local dir="$HOME/.config/fazuh-agent/digest"
  if [[ ! -e "$dir" ]]; then
    return 0
  fi
  if ((DRY_RUN)); then
    info "would remove $dir"
  else
    rm -rf "$dir"
    info "removed $dir"
  fi
}

# The global OpenCode config loads instructions/ through this glob. install.sh
# is not sourceable (it installs as it reads), so the glob is repeated here;
# keep the two in step.
GLOBAL_CONFIG="$HOME/.config/opencode/opencode.json"
INSTRUCTIONS_GLOB='~/.config/opencode/instructions/*.md'

remove_instructions_config() {
  [[ -f "$GLOBAL_CONFIG" ]] || return 0

  if ((DRY_RUN)); then
    if python3 "$ROOT/scripts/opencode-instructions.py" check "$GLOBAL_CONFIG" "$INSTRUCTIONS_GLOB"; then
      info "would stop $GLOBAL_CONFIG loading $INSTRUCTIONS_GLOB"
    fi
    return 0
  fi

  if python3 "$ROOT/scripts/opencode-instructions.py" remove "$GLOBAL_CONFIG" "$INSTRUCTIONS_GLOB"; then
    info "stopped $GLOBAL_CONFIG loading $INSTRUCTIONS_GLOB"
  else
    info "could not edit $GLOBAL_CONFIG; it may still load $INSTRUCTIONS_GLOB"
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
  local name listing
  listing="$(cargo install --list 2>/dev/null || true)"
  for name in bgrun; do
    if ! grep -Eq "^$name v[^ ]+ \(https://github\.com/FAZuH/${name}[^)]*\):" <<<"$listing"; then
      info "$name is not installed from FAZuH/$name; kept"
      continue
    fi
    if ((DRY_RUN)); then
      info "would uninstall Cargo package $name from FAZuH/$name"
    else
      cargo uninstall "$name"
    fi
  done
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
      npx --yes "skills@$SKILLS_CLI_VERSION" remove -g --agent opencode --yes "$skill"
    fi
  done
  remove_rea
}

# REA wrote its MCP entry and skill through its own CLI, so reverse it with
# the same version. The registration lives in OpenCode's config, outside
# sync.sh's manifest.
remove_rea() {
  if ((DRY_RUN)); then
    info "would run rea uninstall (rea-agents $REA_AGENTS_VERSION)"
    return 0
  fi
  if ! npx --yes "rea-agents@$REA_AGENTS_VERSION" uninstall </dev/null; then
    info "rea uninstall failed; the REA registration and skill may remain"
    return 0
  fi
  info "removed the REA registration and skill"
}

while (($#)); do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --external-packages) REMOVE_EXTERNAL_PACKAGES=1; shift ;;
    --external-skills) REMOVE_EXTERNAL_SKILLS=1; shift ;;
    --instructions) REMOVE_INSTRUCTIONS=1; shift ;;
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
  bash "$ROOT/sync.sh" remove -n >/dev/null
fi

remove_sync_files
remove_digest
if ((REMOVE_INSTRUCTIONS)); then
  remove_instructions_config
else
  info "kept the global config's instructions entry; pass --instructions to remove it"
fi
remove_agent_package
if ((REMOVE_EXTERNAL_PACKAGES)); then
  remove_external_packages
fi
if ((REMOVE_EXTERNAL_SKILLS)); then
  remove_external_skills
fi

printf '\nUninstall complete.\n'
