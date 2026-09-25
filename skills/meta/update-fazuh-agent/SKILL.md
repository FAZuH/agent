---
name: update-fazuh-agent
description: Update this OpenCode setup to the latest state of the agent repository — pull the checkout, redeploy skills, agents, plugins, and commands to the global config, and verify the result. Use when the user says update the agent, pull the latest, sync my setup, refresh the config, upgrade the skills, asks whether the installed setup is current, or names the repo they want updated.
---

# Update fazuh agent

Bring the installed OpenCode setup in line with the agent repository. The
checkout path is not fixed: `sync.sh push` records it, and this skill reads it.

> **Load the @following-procedures skill first.** It defines how to run a
> numbered procedure. Follow the rules in the *Rules* section at the bottom.

## Find the repository

Every push to the global target writes the checkout path to
`~/.config/opencode/.agent-repo` (one line, the absolute path). Read it; never
hardcode a path and never guess one.

```bash
cat ~/.config/opencode/.agent-repo
```

If the file is missing, this setup predates it. Ask the user for the checkout
path, or run `./sync.sh push -g` from the checkout once to create it. Do not
fall back to a guessed directory.

## Steps

1. **Resolve the repository path** with the command above. If it is missing or
   is not a git repository, stop and report — every later step depends on it.

2. **Record the starting state**, so the report can show what moved:

   ```bash
   git -C "$repo" rev-parse --short HEAD
   git -C "$repo" status --porcelain
   git -C "$repo" rev-parse --abbrev-ref HEAD
   ```

3. **Stop on a dirty worktree.** Any output from `status --porcelain` means the
   user has work in progress. Report the files and stop. Do not stash, reset,
   clean, or check anything out.

4. **Pull, fast-forward only:**

   ```bash
   git -C "$repo" pull --ff-only
   ```

   A non-fast-forward, conflict, or authentication failure stops the run.
   Report it; never force, never retry with reset.

5. **Update submodules.** A pull can move the `plugins/ponytail/upstream`
   gitlink, and the plugin will not load against the old commit:

   ```bash
   git -C "$repo" submodule update --init
   ```

6. **Read what the pull changed** between the starting and ending commits:

   ```bash
   git -C "$repo" log --oneline <before>..<after>
   ```

   Note the paths that need different handling: `install.sh` and `uninstall.sh`
   (version pins moved upstream with the pull), `scripts/` (Rust workspace, needs
   checks), `plugins/ponytail` (needs a cold restart after push).

7. **Run the repository checks** when the pull touched `scripts/`, `plugins/`,
   or the Rust workspace: `./dev.sh all` from the checkout. Fix nothing here —
   report a red run and let the user decide.

8. **Redeploy the configuration** — the step that makes the update real:

   ```bash
   cd "$repo" && ./sync.sh push -g
   ```

   This copies the repository items into the global OpenCode config, refreshes
   `~/.local/bin`, and rewrites the repo path pointer. Preview first with
   `./sync.sh push -g --dry-run` when anything surprising shows up.

9. **Verify the result:** `./sync.sh diff -g` must report every item in sync. A
   target file that still differs was edited in place after the push; sync keeps
   it and says so — report the path instead of overwriting it.

10. **Reinstall only when the pull really needs it.** `./install.sh` refreshes
    the external skills and cargo packages, and `./install.sh -b` adds the bonus
    ones. Skip it for a routine pull: the config push in step 8 is the normal
    case. Run it when the pull changed `install.sh` itself, when a new external
    or bonus item was added, or when the user asks. Moving a pin forward on
    purpose is the `update-pins` skill's job, not this one.

11. **Report**: the commits pulled, what was pushed, which checks ran, what
    still needs a restart, and what was skipped with the reason.

## Restart rule

OpenCode v2 hot-reloads most components. A changed `plugins/ponytail` needs a
cold restart, because the nested `require()` calls inside its submodule are not
cache-busted. A plugin that does not appear at all is the other restart case.

## Rules

- The repository path comes from `~/.config/opencode/.agent-repo`. Never
  hardcode it, never infer it from the current working directory.
- Never discard work: no `reset --hard`, no `clean`, no `stash`, no checkout of
  tracked files. A dirty worktree stops the run.
- Never force a pull and never resolve a divergence on your own.
- Never run the full installer without asking first. It reinstalls unpinned
  external skills at whatever upstream `HEAD` is that day.
- Never commit or push from this skill. Stop at the working tree.
- Stop and report on any failing check, a missing pointer file, or a target that
  refuses to sync. A partial update with a clear report beats a silent fix.
- Follow the repository's own rules for anything you touch beyond deploying:
  `agent-map` for layout, `skill-doctor` when a skill link or name moved.

## Dependency graph

- step1
- step2 -> step1
- step3 -> step2
- step4 -> step3
- step5 -> step4
- step6 -> step4, step5
- step7 -> step6
- step8 -> step5
- step9 -> step8
- step10 -> step8
- step11 -> step6, step7, step9
