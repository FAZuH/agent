---
name: update-fazuh-agent
description: >-
  Update this OpenCode setup from the agent repo: pull the checkout, deploy
  reviewed work from the deploy branch, verify. Triggers: update the agent,
  sync my setup, refresh the config, is it current.
---

# Update fazuh agent

> **Load the @following-procedures skill first.** It defines how to run a
> numbered procedure. Follow the rules in the *Rules* section at the bottom.

## Find the repository

The checkout path is not fixed: deploy writes it to
`~/.config/opencode/.agent-repo` (one line, absolute path). Read it; never
hardcode a path, never guess. This pointer names the editable checkout, not the
deployed clone.

```bash
cat ~/.config/opencode/.agent-repo
```

If the file is missing, this setup predates it. Ask the user for the checkout
path, or run `./sync.sh deploy` from the checkout once to create it. Never
fall back to a guessed directory.

## Steps

1. **Resolve the repository path** with the command above. Missing or
   not a git repository: stop and report. Every later step depends on it.

2. **Record the starting state**, so the report shows what moved:

   ```bash
   git -C "$repo" rev-parse --short HEAD
   git -C "$repo" status --porcelain
   git -C "$repo" rev-parse --abbrev-ref HEAD
   ```

3. **Stop on a dirty worktree.** Any `status --porcelain` output means
   work in progress. Report the files and stop. No stash, reset,
   clean, or checkout.

4. **Pull, fast-forward only:**

   ```bash
   git -C "$repo" pull --ff-only
   ```

   A non-fast-forward, conflict, or authentication failure stops the run.
   Report it; never force, never retry with reset.

5. **Update submodules** (if any):

   ```bash
   git -C "$repo" submodule update --init
   ```

6. **Read what the pull changed** between the starting and ending commits:

   ```bash
   git -C "$repo" log --oneline <before>..<after>
   ```

   Note the paths that need different handling: `install.sh` and `uninstall.sh`
   (version pins moved upstream with the pull), `scripts/` (Rust workspace, needs
   checks).

7. **Run the read-only test check** when the pull touched `scripts/`,
   `plugins/`, or the Rust workspace: `./dev.sh test` from the checkout. `all`
   also formats and auto-fixes. Fix nothing here; report a red run and let the
   user decide.

8. **Promote the reviewed work**, the step that makes the update real. The
   deploy tool fetches the local `deploy` branch from this checkout; `main` is
   not the promotion source. If the pulled commits are not on `deploy`, stop and
   ask the user to put them there. Do not commit, merge, or cherry-pick from
   this skill. Then run:

   ```bash
   cd "$repo" && ./sync.sh deploy
   ```

   The tool updates the clone at
   `${XDG_DATA_HOME:-$HOME/.local/share}/fazuh-agent/config`, then reconciles
   the config symlinks and the `~/.local/bin` symlinks. It keeps the
   `.agent-repo` pointer aimed at this checkout. Preview with
   `./sync.sh deploy -n`. The preview plans from the promoted `deploy` ref and
   exits non-zero on a collision.

9. **Verify the result:** `./sync.sh diff` must report every item in sync. A
   managed item that differs was edited outside the promoted branch. Report
   the path instead of overwriting it.

10. **Reinstall only when the pull really needs it.** `./install.sh` refreshes
    the external skills and cargo packages, `./install.sh -b` adds the bonus
    ones. Skip it for a routine pull: the step-8 deploy is the normal case.
    Run it when the pull changed `install.sh` itself, when a new external
    or bonus item was added, or when the user asks. Moving a pin forward
    is the `update-pins` skill's job, not this one.

11. **Report**: commits pulled, what was deployed, checks run, what
    still needs a restart, what was skipped and why.

## Restart rule

OpenCode v2 hot-reloads most components. Deploy never restarts the service. A
plugin that does not appear at all is the restart case. Plugin `setup()` re-runs
on edit, but old closures keep firing until restart. A newly added instruction
link enters a running server's glob snapshot only after the config changes next.

## Rules

- The repository path comes from `~/.config/opencode/.agent-repo`. Never
  hardcode it, never infer it from the current working directory.
- Never discard work: no `reset --hard`, no `clean`, no `stash`, no checkout of
  tracked files. A dirty worktree stops the run.
- Never force a pull and never resolve a divergence on your own.
- Never run the full installer without asking first. It reinstalls unpinned
  external skills at whatever upstream `HEAD` is that day.
- Never commit or push from this skill. The user commits reviewed work to
  `deploy`; this skill only pulls, deploys, and verifies.
- Stop and report on any failing check, missing pointer file, or item that
  stops deploy on drift. A partial update with a clear report beats a silent fix.
- Follow the repository's own rules for anything you touch beyond deploying:
  the source layout is `skills/<category>/<name>/`, `agents/<role>/<name>.md`,
  `plugins/<name>/`, `commands/<name>.md`; `skill-doctor` when a skill link or
  name moved.

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
