---
name: omarchy-plugin-install
description: Install an Omarchy shell plugin end-to-end — clone-first malware audit delegated to the malware-check subagent, omarchy plugin add, bar placement, hotkey/script setup, keybind file edit, old-tool removal, dotfiles sync. Use when the user asks to install, add, or set up an Omarchy plugin from a repo URL.
---

# omarchy-plugin-install

Full procedure for installing an Omarchy plugin from a third-party repo URL.
Run phases in order; phase 1 gates everything (anything but CLEAN stops the run).

Requires [Omarchy](https://omarchy.org) (Hyprland + the `omarchy` CLI).

Machine-specific paths (your Hyprland keybind file, your dotfiles repo and how
it tracks files) are stated in `AGENTS.md`. Read it before phases 4-6 and use
those values instead of any example path below.

## Phase 1 — Malware audit (DELEGATE — never audit in the main session)

**Spawn the `malware-check` subagent. Do not perform this audit yourself.**
The main session runs with full permissions; the audit belongs in the
subagent's default-ask sandbox, and the only thing the main session consumes
is the verdict file it writes.

If you find yourself running your own `git clone`, `grep`, `read`, or
`clamscan` to check a plugin's source, stop — that is the exact mistake this
phase exists to prevent, and it does not count as the audit. Hand the repo
URL to the subagent instead.

One `subagent` call per plugin (agent: `malware-check`, parallel calls when
installing several), passing:

- repo URL and plugin name,
- what the plugin claims to do, so shipped code can be judged against
  documented behavior,
- expected clone/verdict paths: it clones into `/tmp/malware-check/<name>`,
  audits, and writes the verdict to `/tmp/malware-check/<name>.md`.

Its sandbox is default-ask: read-only scans run silently, while the clone and
anything outside the allowlist prompt for approval — approve the audit's own
prompts as they come.

Expect coverage of: `https?://` hits (only the plugin's documented API hosts),
`eval\(|atob|base64|fromCharCode` (nothing in shipped code),
`bashrc|systemd|systemctl|cron|pkexec|sudo` (nothing — no persistence/priv-esc),
full read of any bundled install/lookup scripts (must match documented behavior),
`clamscan -r` (Infected files: 0).

Read the verdict file when it returns (CLEAN + what was checked, or INFECTED
with `file:line` pointers). Non-CLEAN → stop, show findings, install nothing.

## Phase 2 — Install

```bash
omarchy plugin add <url> --enable --yes   # --yes is mandatory non-interactive
omarchy plugin validate ~/.config/omarchy/plugins/<plugin-id>
```

Never touch `/usr/share/omarchy/` (package-owned; updates overwrite it).

## Phase 3 — Bar placement

```bash
omarchy bar move <plugin-id> --section <left|center|right>
```

Verify in `~/.config/omarchy/shell.json` (hot-reloads on save, no restart needed).

## Phase 4 — Setup (scripts + keybinds)

- If the plugin has a panel "Install" button for a helper script, the equivalent is
  `cp <plugin>/scripts/<script> ~/.local/bin/ && chmod +x` — then prove it with
  `cmp <plugin>/scripts/<script> ~/.local/bin/<script>`.
- Keybinds go in your own Hyprland keybind file (`AGENTS.md` names it on this
  machine), never in the stock `bindings.lua`.
- Conflict-check first: `hyprctl binds -j | jq -r '.[] | select(.description | test("<keyword>"))'`.
- After editing: `hyprctl reload` must be followed by empty `hyprctl configerrors`.

## Phase 5 — Retire replaced tools

Removing an old tool means all three: delete the bind (phase 4), delete the live
script (`~/.local/bin/`, `~/.local/share/bin/`), and remove its twin in the
dotfiles repo.

## Phase 6 — Persist (dotfiles sync loop)

Copy the live files over their twins in the dotfiles repo — the keybind file,
`~/.config/omarchy/shell.json`, and any helper script under `~/.local/bin/`.
Commit one concern per commit using that repo's commit scopes, and push.
`shell.json` plugin entries: commit only once placement is settled.
