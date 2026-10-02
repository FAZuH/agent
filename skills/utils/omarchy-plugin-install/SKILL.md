---
name: omarchy-plugin-install
description: Install an Omarchy shell plugin end-to-end from a repo URL, starting with a malware audit delegated to the malware-check subagent, then omarchy plugin add, bar placement, hotkey and script setup, keybind file edit, old-tool removal, and dotfiles sync. Use when the user asks to install, add, or set up an Omarchy plugin.
---

# omarchy-plugin-install

Install an Omarchy plugin end to end from a third-party repo URL. Phases run
in order; phase 1 gates all (non-CLEAN stops the run).

Requires [Omarchy](https://omarchy.org) (Hyprland + the `omarchy` CLI).

Machine-specific paths (your Hyprland keybind file, your dotfiles repo and how
it tracks files) are stated in `AGENTS.md`. Read it before phases 4-6 and use
those values instead of any example path below.

## Phase 1: Malware audit (DELEGATE, never audit in the main session)

**Spawn the `malware-check` subagent. Do not perform this audit yourself.**
The main session runs with full permissions; the audit belongs in the
subagent's default-ask sandbox, and the only thing the main session consumes
is the verdict file it writes. Your own `git clone`, `grep`, `read`, or
`clamscan` does not count as the audit: that is the exact mistake this phase
prevents. Hand the repo URL to the subagent instead.

One `subagent` call per plugin (agent: `malware-check`, parallel calls when
installing several), passing:

- repo URL and plugin name,
- what the plugin claims to do, so shipped code can be judged against
  documented behavior,
- expected clone/verdict paths: it clones into `/tmp/malware-check/<name>`,
  audits, and writes the verdict to `/tmp/malware-check/<name>.md`.

Default-ask sandbox: read-only scans run silent; the clone and anything
outside the allowlist prompts. Approve the audit's prompts as they come.

Expect coverage of: `https?://` hits (only the plugin's documented API hosts),
`eval\(|atob|base64|fromCharCode` (nothing in shipped code),
`bashrc|systemd|systemctl|cron|pkexec|sudo` (nothing, no persistence or
privilege escalation), full read of any bundled install/lookup scripts (must
match documented behavior), `clamscan -r` (Infected files: 0).

Read the verdict file when it returns (CLEAN + what was checked, or INFECTED
with `file:line` pointers). Non-CLEAN → stop, show findings, install nothing.

## Phase 2: Install

```bash
omarchy plugin add <url> --enable --yes   # --yes is mandatory non-interactive
omarchy plugin validate ~/.config/omarchy/plugins/<plugin-id>
```

Never touch `/usr/share/omarchy/` (package-owned; updates overwrite it).

`--enable` is best-effort: `omarchy plugin add <url> --enable --yes` can print
`omarchy-shell is not responding` and leave the plugin **disabled**. Check with
`omarchy plugin list`; if it is off, `omarchy plugin enable <plugin-id>` works
and hot-reloads. The add path's in-process reload races; a `not responding`
print is not the shell being down.

## Quickshell plugin gotchas

- `IdleMonitor` and the other idle types come from
  `import Quickshell.Wayland`: a bare `import Quickshell` fails service load
  with `IdleMonitor is not a type`, and the only symptom in widget IPC is
  `service unavailable`.
- A JS/QML parse error in one plugin takes the **whole shell** down, not just
  that plugin. Restore the file immediately after probing.
- Hot-reload registers a new widget but leaves the previous generation's
  `IpcHandler` bound to the target: the widget logs `Handler was registered
  but will not be used` and new IPC methods fail with `Function not found`
  until a full `omarchy-restart-shell`.
- `omarchy-shell shell summon <id>` reports `no live bar widget` for a
  third-party plugin widget that is visibly on the bar and whose own open/close
  IPC works. `Bar.findPanelWidget` does not match plugin widget slots, so
  hotkey-style summon routing is broken for plugins: bind the widget's own
  IPC instead.

## Phase 3: Bar placement

```bash
omarchy bar move <plugin-id> --section <left|center|right>
```

Verify in `~/.config/omarchy/shell.json` (hot-reloads on save, no restart needed).

## Phase 4: Setup (scripts + keybinds)

- If the plugin has a panel "Install" button for a helper script, the equivalent is
  `cp <plugin>/scripts/<script> ~/.local/bin/ && chmod +x`, then prove it with
  `cmp <plugin>/scripts/<script> ~/.local/bin/<script>`.
- Keybinds go in your own Hyprland keybind file (`AGENTS.md` names it on this
  machine), never in the stock `bindings.lua`.
- Conflict-check first: `hyprctl binds -j | jq -r '.[] | select(.description | test("<keyword>"))'`.
- After editing: `hyprctl reload` must be followed by empty `hyprctl configerrors`.

## Phase 5: Retire replaced tools

Removing an old tool means all three: delete the bind (phase 4), delete the live
script (`~/.local/bin/`, `~/.local/share/bin/`), and remove its twin in the
dotfiles repo.

## Phase 6: Persist (dotfiles sync loop)

Copy live files over their dotfiles twins: the keybind file,
`~/.config/omarchy/shell.json`, helper scripts under `~/.local/bin/`.
One concern per commit with that repo's scopes, then push.
`shell.json` entries: commit only once placement is settled.
