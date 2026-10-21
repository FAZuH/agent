#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ -d "$HOME/.cargo/bin" ]]; then
  export PATH="$HOME/.cargo/bin:$PATH"
fi

DRY_RUN=0
REMOVE_EXTERNAL_PACKAGES=0
REMOVE_EXTERNAL_SKILLS=0
REMOVE_EMBEDDED_RULES=0

EXTERNAL_SKILLS=(
  mermaid-skill
  ask-matt code-review codebase-design diagnosing-bugs domain-modeling
  grill-with-docs implement improve-codebase-architecture prototype research
  resolving-merge-conflicts setup-matt-pocock-skills tdd to-spec to-tickets
  triage wayfinder wizard
  grill-me grilling handoff to-questionnaire wait-what writing-for-agents
  simple-english
  hindsight-docs
  bgrun
  antislop antislop-code antislop-copywriting antislop-human antislop-layoutmobile antislop-ui
  ffmpeg-skill
)

# Must match the pins in install.sh; a newer CLI cannot remove what it did not
# write. The update-pins skill moves both together.
SKILLS_CLI_VERSION="1.7.0"
REA_AGENTS_VERSION="6.4.0"
CHAT_ROOM_VERSION="0.2.2"

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
  --embedded-rules       Also remove the rules this installer embedded in
                         ~/.config/opencode/AGENTS.md; the default keeps them.
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
    bash "$ROOT/sync.sh" remove -g -n
  else
    bash "$ROOT/sync.sh" remove -g -n >/dev/null
    bash "$ROOT/sync.sh" remove -g
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

# The installer embeds the global-instruction rules in the host AGENTS.md
# between these markers. install.sh is not sourceable (it installs as it reads),
# so the markers and the strip are repeated here; keep the two in step.
GLOBAL_AGENTS_MD="$HOME/.config/opencode/AGENTS.md"
GI_START='<!-- global-instruction:start -->'
GI_END='<!-- global-instruction:end -->'

remove_global_instruction_ref() {
  if [[ ! -f "$GLOBAL_AGENTS_MD" ]]; then
    return 0
  fi
  if ! grep -qF "$GI_START" "$GLOBAL_AGENTS_MD"; then
    return 0
  fi
  if ((DRY_RUN)); then
    info "would remove the embedded rules from $GLOBAL_AGENTS_MD"
    return 0
  fi
  # Same hold-one-line rule as install.sh: drop the blank line with the block, or
  # the file keeps a trailing one after every uninstall.
  local tmp="$GLOBAL_AGENTS_MD.untmp"
  awk -v s="$GI_START" -v e="$GI_END" '
    function flush() { if (has) { print held; has = 0 } }
    NR == 1 { held = $0; has = 1; next }
    $0 == s { if (held ~ /^[[:space:]]*$/) has = 0; inblock = 1; next }
    $0 == e { inblock = 0; next }
    inblock { next }
    { flush(); held = $0; has = 1 }
    END { flush() }
  ' "$GLOBAL_AGENTS_MD" >"$tmp" && mv "$tmp" "$GLOBAL_AGENTS_MD" || {
    rm -f "$tmp"
    info "could not rewrite $GLOBAL_AGENTS_MD; the embedded rules were kept"
    return 0
  }
  info "removed the embedded rules from $GLOBAL_AGENTS_MD"
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

# The chat-room plugin is written into OpenCode's own config, outside the
# sync.sh manifest, so it needs its own removal. Both spellings go: the pinned
# one this installer wrote, and an unversioned one an earlier run left behind.
remove_chat_room() {
  if ((DRY_RUN)); then
    info "would remove the chat-room plugin (@alexsun-top/opencode-chat-room@$CHAT_ROOM_VERSION)"
    return 0
  fi
  local spec
  for spec in "@alexsun-top/opencode-chat-room@$CHAT_ROOM_VERSION" "@alexsun-top/opencode-chat-room"; do
    if ! opencode plugin remove "$spec" >/dev/null 2>&1; then
      info "could not remove $spec; it may remain configured"
    fi
  done
  info "removed the chat-room plugin"
}

while (($#)); do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --external-packages) REMOVE_EXTERNAL_PACKAGES=1; shift ;;
    --external-skills) REMOVE_EXTERNAL_SKILLS=1; shift ;;
    --embedded-rules) REMOVE_EMBEDDED_RULES=1; shift ;;
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
remove_digest
if ((REMOVE_EMBEDDED_RULES)); then
  remove_global_instruction_ref
fi
remove_agent_package
remove_chat_room
if ((REMOVE_EXTERNAL_PACKAGES)); then
  remove_external_packages
fi
if ((REMOVE_EXTERNAL_SKILLS)); then
  remove_external_skills
fi

printf '\nUninstall complete.\n'
