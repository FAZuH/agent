---
name: offload
description: >-
  Offload builds, checks, or agent batches to a remote machine over ssh when
  local work would OOM or saturate this machine. Covers environment probe,
  one-time bootstrap, working-tree sync (push/pull), detached remote check runs
  via tmux, remote agent batch launches, and result retrieval. Use when the user
  asks to build/test/compile on a remote host, run checks remotely, offload
  heavy work, or spawn an agent session on another machine.
---

# offload

Delegate builds, checks, or agent runs to a remote host over ssh. The local
tree is the single writer for commits; the remote never commits.

> **Load @following-procedures skill first.** It owns procedure narration,
> deviation logging, and the post-run report.
>
> **Load @gate skill when you reach the `GATE` tag.** It owns gate classes and
> the ask protocol. (Vocabulary: the @gate skill.)

## 0. Resolve context (every run)

```sh
LOCAL_ROOT="$(git rev-parse --show-toplevel)"
PROJECT="$(basename "$LOCAL_ROOT")"
BRANCH="$(git branch --show-current)"
```

Memory file `$LOCAL_ROOT/.opencode/offload.md`: read it first when it exists.
It carries `remote_host`, `remote_root`, `excludes`, the check command (§1).
Never assume remote paths from the local layout: the first run confirms
`remote_host` and `remote_root` with the user (suggestion
`<remote-base>/$PROJECT`), later runs read them from memory and skip
discovery unless the memory is stale or the user forces re-detection.

Memory template:

```markdown
# offload memory: <project>

- remote_host: <ssh host>
- local_root: <abs path>
- remote_root: <abs path on remote_host>
- check_source: <AGENTS.md | dev.sh | Cargo.toml | package.json | ...>
- check_override: <only when remote genuinely differs; else empty>
- excludes:
  - .git
  - target
  - node_modules/
  - .scratch/
  - <per-repo additions>
- toolchain_notes: <whatever parity the repo needs>
- last_verified: <YYYY-MM-DD>
```

## Dependency graph

- resolve -> bootstrap
- push -> resolve
- remote-checks -> push
- remote-batch -> push
- pullback -> remote-checks
- pullback -> remote-batch

## 1. First run: bootstrap + memory

1. **Probe** (read-only, confirms the host is usable):
   ```sh
   ssh -o BatchMode=yes <remote-host> 'nproc; free -h | head -2; command -v cargo node python3; command -v opencode2 || command -v opencode'
   ```
   Done when the host answers over BatchMode ssh with the needed toolchain
   present, or its absence in `toolchain_notes`.
2. **Init remote tree**: create `remote_root`, clone or seed it, then set
   `safe.directory` and a git identity there when a fresh clone needs one.
   Done when `git -C <remote_root> status` works over ssh.
3. **Decide excludes**: universal base (`.git` and `target` with NO trailing
   slash, `node_modules/`, `.scratch/`), plus per-repo entries from
   `git status --ignored`, `.gitignore`, `du -sh */` for large dirs, `AGENTS.md`
   hints. Write the final list to memory. Done when every ignored or heavy
   dir has an explicit keep-or-exclude decision.
4. **Decide the check command** (live-linked by default):
   - `check_source`, in this order: `AGENTS.md` → `dev.sh` / `Makefile` /
     `justfile` → `Cargo.toml` / `package.json` / `pyproject.toml`. Every run
     re-reads the source, so local convention changes auto-apply remotely.
   - `check_override` ONLY when remote genuinely differs (extra feature flags,
     memory limits); empty is normal.
   - The check command must match CI exactly: in a cargo workspace use
     `cargo test --workspace`: bare `cargo test` skips crate members and
     false-greens a red run (both test and clippy).
   Done when a fresh agent could derive the exact remote command from
   `check_source` + `check_override` alone.
5. **Write memory + gitignore**: write `.opencode/offload.md`, ensure it is
   ignored: if `.gitignore` does not cover `.opencode/`, append
   `.opencode/offload.md`. Done when `git check-ignore .opencode/offload.md`
   succeeds and the file exists.

## 2. Sync push (local tree → remote, carries UNCOMMITTED changes)

```sh
rsync -a --delete <excludes-from-memory> "$LOCAL_ROOT/" <remote-host>:"$REMOTE_ROOT/"
```

Add `--no-o --no-g` when the remote ssh user differs from the local uid
(plain `-a` maps the uid through and the remote can reject the repo as
dubiously owned). Done when the remote tree matches local modulo excludes.

## Flaky links

Home LAN behind tailscale, laptop on wifi: long single-shot commands stall.

- ssh keepalives in `~/.ssh/config` for that host: `ServerAliveInterval 15` +
  `ServerAliveCountMax 4` (kill dead connections early), `ConnectTimeout 10`
  (fail fast on probes).
- Probe before big work: `ssh -o BatchMode=yes <host> 'true'`. A 10s timeout
  on the probe means the link is down, not the host.
- Seed large trees with `git bundle` (single resumable file) or
  `rsync --partial` (resumes an interrupted transfer). Never one long
  transfer that restarts from zero on drop.
- Keep long work detached in tmux on the remote (step 3), so an ssh drop kills
  a connection, not the check.

## 3. Remote checks only (no agent)

```sh
ssh <remote-host> 'tmux new-session -d -s <name> "cd $REMOTE_ROOT && { <check-command>; } > <log> 2>&1"'
# poll: tail the log; done when `tmux has-session -t <name>` fails
```

Done when the log shows the full check output and the tmux session is gone.

## 4. Launch a remote agent batch

Mission brief to `/tmp/batch-task.md`, copied to the remote, then run
detached:

```sh
printf '#!/usr/bin/env bash\ncd "$REMOTE_ROOT"\nexec opencode run --auto --standalone "$(cat <remote-brief>)"\n' > /tmp/run-batch.sh
scp /tmp/run-batch.sh <remote-host>:<remote-script>
ssh <remote-host> 'chmod +x <remote-script>; tmux kill-session -t <name> 2>/dev/null || true; tmux new-session -d -s <name> "<remote-script> 2>&1 | tee <log> >/dev/null"'
```

- `--standalone` runs a PRIVATE server: fast and isolated, but its sessions do
  NOT appear in any console/TUI elsewhere. Use it for unattended batches
  monitored via log/tmux.
- WITHOUT `--standalone` the run goes through the remote user's background
  service and appears in that user's console/TUI. Only when that service is
  healthy.
- Sessions are PER-USER: a batch run as one remote user is never visible in
  another user's console.
- No `gh` CLI on the remote: embed ticket text in the brief.
- Monitor: `tmux attach -t <name>` (Ctrl-b d to detach) or `tail -f` the log.
  Done when the session is gone and the log tail holds the final report.

## 5. Pull-back (remote edits → local; remote never commits)

Default: never rsync over a live working tree. Stage in a disposable detached
worktree, inspect, adopt:

```sh
# 1. stage at the branch tip (avoids branch-checkout clash)
git -C "$LOCAL_ROOT" worktree add --detach /tmp/opencode/pullback-<branch> <branch>
# 2. overlay remote tree onto staging (same excludes as push, minus --delete unless intended)
rsync -a --no-o --no-g --exclude='.git' <other-excludes-from-memory> \
  <remote-host>:"$REMOTE_ROOT/" /tmp/opencode/pullback-<branch>/
# 3. inspect: git -C /tmp/opencode/pullback-<branch> status/diff vs the branch
# 4. adopt the reviewed diff onto the real tree, then: git worktree remove /tmp/opencode/pullback-<branch>
```

**GATE in-place-pullback (always → stage in a detached worktree instead):**
rsync straight onto the live tree is allowed ONLY after the user explicitly
approves it for that specific sync, e.g. after verifying zero local divergence
since the push. State what will be overwritten before asking.

Single-writer discipline: while a remote batch owns the branch, edit nothing
locally. Commits are ALWAYS made locally after review, never on the remote.
Done when the reviewed remote diff is applied locally and the staging worktree
is removed.

## Rules

- Only sync/check/batch through `.opencode/offload.md` memory: never invent
  host paths per run.
- Exclude `.git` with NO trailing slash: a worktree checkout carries `.git` as
  a FILE (gitdir pointer) and `--exclude='.git/'` matches directories only, so
  the pointer file overwrites the remote repo's real `.git` directory and kills
  the clone. Repair: fresh clone, swap in its `.git`, point the branch at the
  right ref (`git update-ref`), `git read-tree HEAD` (NEVER `--hard`: it
  destroys WIP), then status shows the expected WIP entries.
- Exclude `target` with NO trailing slash either: a build wrapper that makes
  `target/` a symlink (mbx points it at `~/.cache/mbx/targets/v1/<hash>`)
  slips past `--exclude='target/'`, lands on the remote as a broken symlink,
  and the first cargo build dies with `failed to create directory: Not a
  directory (os error 20)`.
- Cold builds are slow (empty remote target dir); later runs are incremental.
- `cargo -j N` must go **before** `--`. After it, the jobs flag reaches rustc
  and the build dies with `unstable-options`; `cargo test -- -j 2` is not a
  parallel test run.
- Credentials and config the remote run needs must already exist there. If new
  absolute paths appear in local config, mirror those targets too.
- Headless `opencode run` failures with `UnexpectedStatus` mean the
  background service path was used without a healthy service: prefer
  `--standalone`.
- Keep toolchain parity: when the local toolchain bumps, update the remote and
  refresh `toolchain_notes` + `last_verified`.
