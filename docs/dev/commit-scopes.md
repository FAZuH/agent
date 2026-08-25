# Commit scopes

Closed vocabulary. Every commit picks a scope from this table, or takes no
scope. Do not invent one on your own: when nothing fits, propose the new
scope to the user with a one-line definition and **wait for explicit
approval** before committing with it.

Format: `type(scope): summary` or `type: summary`.

## Scopes

| Scope     | Covers                                              |
| --------- | --------------------------------------------------- |
| `agents`   | `agents/**`                                          |
| `skills`   | `skills/**`                                          |
| `plugins`  | `plugins/**` (mermaid tools live under `plugins/mermaid/`) |
| `commands` | `commands/**`                                        |
| `install`  | `install.sh`, `uninstall.sh`, `.agent-links.json`, `.gitignore` entries about them |
| `release`  | Version bumps and changelog materialization produced by the release workflow (`chore(release)`) |

No scope = repo-wide: README, `docs/`, `.github/`, `dev.sh`, and any change
that genuinely spans several components.

## Rules

- Types: `feat`, `fix`, `refactor`, `docs`, `chore`.
- Pick the scope by WHAT changed, not by why.
- One logical change per commit. A change spanning two scopes becomes two
  commits; only fall back to no scope when splitting is impossible.
- New scopes require user approval first: propose name + definition + example
  subject, then wait. Never commit with an unapproved scope.
- Old commit subjects are never rewritten to match this list — the vocabulary
  applies from its introduction onward.

## Examples

```
feat(skills): add issue-closeout skill
fix(plugins): mermaid-doctor timeout guard ignores render:false
docs(install): document project-level installs
feat(agents): teach review subagent the spec axis
feat: restructure repo into skills/agents/plugins/commands
docs: add commit scopes reference
```
