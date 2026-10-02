---
name: ocv2-move
description: Move an OpenCode V2 session to a different project directory without restarting or losing context. Use when the user says "move this session", "move the session to <dir>", "switch this session's project", or after a repo was renamed/moved on disk and the session still points at the old path.
---

# Move an OpenCode V2 session to another directory

Sessions pin to a project directory. The server API re-pins the current session;
the environment picks it up next turn. No restart, no handoff document.

## Steps

1. **Resolve the session ID**: read it from the environment block (`Current
   conversation session ID`) or ask the user. It starts with `ses`.
2. **Resolve the target directory**: use the user-named directory; expand
   `~` to absolute. Verify it exists and is the intended root
   (for example it contains `.git` or the project files) before moving.
3. **Call the move endpoint**: prefer `scripts/oc-move.sh <sessionID>
   <directory>`: it resolves `~`/relatives, checks the directory exists,
   calls the endpoint, and reports `/api/project/current`. The raw call:

   ```sh
   opencode2 api post /api/session/<sessionID>/move \
     --data '{"directory":"/absolute/path/to/project"}'
   ```

   Success is exit code 0 (HTTP 204, empty body). `opencode2 api` accepts only
   `-d` and `-H`.
4. **Verify**: run `opencode2 api get /api/project/current`. `/` from a detached shell is normal; authoritative confirmation arrives as a system update setting the new working directory.
5. **Continue in the new location**: use absolute paths under the new
   directory until the updated environment lands.

## Notes

- Only the session moves. Disk files are untouched; a user-moved repo needs no copying.
- Child sessions stay behind. Spawn fresh subagents for follow-up; they inherit the new project.
- Old directory gone: shell calls with a default working
  directory may fail until the environment updates, so set an explicit
  working directory during that window.
