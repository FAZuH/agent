---
name: update-pins
description: Move the pinned versions in install.sh and uninstall.sh forward. Use when the user asks to update, bump, refresh, or check the pinned versions, wants to know what is outdated, says the pins are stale, or asks to run the installer's updates. Checks each remote first and reports the diff before any pin moves.
---

# Update pins

`install.sh` pins what it fetches: the `skills` CLI by npm version, papercuts,
bgrun, ffmpeg-skill, and reverse-skill by commit. This skill moves a pin to a
new upstream version. It never moves one silently.

## The pins

| Pin | File | Upstream | How to check the remote |
|-----|------|----------|-------------------------|
| `SKILLS_CLI_VERSION` | `install.sh`, `uninstall.sh` | npm `skills` | `npm view skills version` |
| `PAPERCUTS_REV` | `install.sh` | `github.com/FAZuH/papercuts` | `git ls-remote https://github.com/FAZuH/papercuts HEAD` |
| `BGRUN_REV` | `install.sh` | `github.com/FAZuH/bgrun` | `git ls-remote https://github.com/FAZuH/bgrun HEAD` |
| `FFMPEG_SKILL_REV` | `install.sh` | `github.com/kajisho5/ffmpeg-skill` | `git ls-remote https://github.com/kajisho5/ffmpeg-skill HEAD` |
| `REVERSE_SKILL_REV` | `install.sh` | `github.com/zhaoxuya520/reverse-skill` | `git ls-remote https://github.com/zhaoxuya520/reverse-skill HEAD` |

The `plugins/ponytail/upstream` submodule needs no pin here: git records its
commit in the parent repository, so `git submodule update --init` is already
deterministic. Move it with
`git submodule update --remote plugins/ponytail/upstream` and commit the
gitlink.

`SKILLS_CLI_VERSION` is set in **two** files. Move both in one edit, or
`uninstall.sh` keeps removing with a version that never wrote the files.

## Not pinned

The five `install_skill` repos (mattpocock/skills, Agents365-ai/365-skills,
AminBlg/SimpleEnglish, FAZuH/bgrun, miqdadbadjuber/anti-slop) install through
the `skills` CLI, which has no ref flag and always takes upstream HEAD. They
move on their own; do not add a pin without switching them off the CLI.

## Procedure

1. **Read the current pins** out of `install.sh` and `uninstall.sh`. Do not
   assume they match the table above.

2. **Ask each remote what it has now.** Run the check command from the table
   for every pin, in one batch. Never guess a version, and never take a
   version from a cached `npx` run or an old lockfile.

3. **Report before moving anything.** One row per pin: name, pinned value,
   remote value, and a verdict (`current` or `behind`). Then, for each pin
   that is behind, what actually changed between the two commits — not the
   commit count, the substance:

   ```bash
   git log --oneline <pinned-sha>..<remote-sha>
   ```

   For a git pin, also read the upstream changelog or release notes when the
   repo has them. For the npm pin, `npm view skills@<new> dist-tags time` shows
   the publish date and what else rode along.

4. **GATE pin-approval (normal → the user confirms each pin before it moves).**
   Wait for a yes per pin. A bump that only moves CI or docs commits is
   still a bump, and the user may want to skip it — that is their call, not a
   reason to move it silently.

5. **Move the pin** with the edit tool, one value per edit. Keep the pin
   block at the top of `install.sh` and the comment above it intact.

6. **Verify the new pin resolves** before reporting success. A pin that does
   not exist upstream fails at install time, not now:

   ```bash
   git ls-remote https://github.com/<owner>/<repo> | grep <new-sha>   # or:
   git fetch --depth 1 https://github.com/<owner>/<repo> <new-sha>   # bare SHA fetch
   ```

   A bare SHA that no ref advertises can still be fetched, so a `git ls-remote`
   miss is not proof the pin is bad. Confirm with a fetch into a temp
   directory.

7. **Run the repository checks**: `bash -n install.sh uninstall.sh` and
   `shellcheck -S warning install.sh uninstall.sh`.

8. **Tell the user what a reinstall would do.** A moved pin only takes effect
   on the next `./install.sh` run (or `./install.sh -b` for the bonus pins).
   Never run the installer to "apply" an update unless asked — it also
   reinstalls the unpinned CLI skills at whatever upstream HEAD is that day,
   and pushes the whole config.

## Rules

- Report first, move second. A pin that moves without a diff is a bug.
- One upstream, one pin. Never bundle two repos into one commit.
- Never move a pin to satisfy a failing test. Fix the code or report the
  breakage.
- Never re-pin to a tag or a branch name where a commit is used now; the
  point of the pin is that it does not move by itself.
- Keep the two `SKILLS_CLI_VERSION` values identical.
- If a remote is unreachable, say so and leave that pin alone. A stale pin is
  recoverable; a pin that points nowhere is not.
