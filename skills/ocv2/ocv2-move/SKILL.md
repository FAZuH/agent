---
name: ocv2-move
description: Move an OpenCode V2 session to a different project directory without restarting or losing context. Use when the user says "move this session", "move the session to <dir>", "switch this session's project", or after a repo was renamed/moved on disk and the session still points at the old path.
---

# Move an OpenCode V2 session to another directory

OpenCode V2 sessions are pinned to a project directory. The server API can re-pin
the current session to a new directory; the agent's environment picks up the new
working directory on the next turn. No restart, no handoff document needed.

## Steps

1. **Resolve the session ID** — read it from the environment block (`Current
   conversation session ID`) or ask the user. It starts with `ses`.
2. **Resolve the target directory** — use the directory the user named; expand
   `~` to an absolute path. Verify it exists and is the intended project root
   (for example it contains `.git` or the project files) before moving.
3. **Call the move endpoint**:

   ```sh
   opencode2 api post /api/session/<sessionID>/move \
     --data '{"directory":"/absolute/path/to/project"}'
   ```

   Success is exit code 0 (HTTP 204, empty body). Do not pass curl-style flags;
   `opencode2 api` only accepts `-d` and `-H`.
4. **Verify** — run `opencode2 api get /api/project/current`. A `/` result is
   normal from a detached shell; the authoritative confirmation arrives as a
   system update that sets the new working directory for the session.
5. **Continue work in the new location** — use absolute paths under the new
   directory until the updated environment lands.

## Notes

- Only the session moves. Files on disk are untouched; if the user also moved
  the repo themselves, nothing needs copying.
- Child/subagent sessions are not moved by this call. Spawn fresh subagents for
  follow-up work; they inherit the new project.
- If the old directory no longer exists, shell calls with a default working
  directory may fail until the environment updates — always set an explicit
  working directory during that window.
