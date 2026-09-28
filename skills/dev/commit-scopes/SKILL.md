---
name: commit-scopes
description: >-
  Create or update docs/dev/commit-scopes.md, the closed vocabulary for
  Conventional Commit scopes. Use when the user asks to create commit scopes,
  define scopes, set up commit-scopes.md, scaffold commit conventions, or
  mentions commit-scopes.
---

# commit-scopes

Create `docs/dev/commit-scopes.md`: a closed vocabulary of scopes for
`type(scope): subject`. Every commit picks a scope from this table or takes no
scope. Do not invent one on the fly.

## 1. Inspect the codebase

Map the repo to physical locations before proposing anything:

```bash
git ls-files | cut -d/ -f1 | sort -u   # top-level dirs and files, ignores generated dirs
cat Cargo.toml 2>/dev/null | grep -E "members|name"
```

Group by **top-level component**, not by file:

- One binary / crate / workspace member → one scope
- One top-level domain module (`src/schedule/`, `src/slcm/`) → one scope
- Cross-cutting concerns (CI, deploy, config) are types, not scopes: see rule 3

## 2. Draft scopes

Propose 3–8 scopes. Each row must name a **real directory or crate**, not a
topic.

### Rules (non-negotiable)

1. **Singular, never plural.** `plugin` not `plugins`, `skill` not `skills`,
   `component` → `comp`. Check every scope ends without `s` unless the
   singular itself ends in `s` (e.g. `status`).

2. **Cover a real slice.** A scope must own a top-level directory, crate, or
   domain module: roughly ≥10% of the codebase or a distinct deployable unit.
   Reject single-file / single-concern scopes. Common offender: `changelog`
   (one file → use `docs:` or no scope), `license`, `deps`, `readme`,
   `contributing`. If only one file lives there, it is not a scope, so use no
   scope.

3. **Never collide with a type.** These are types, not scopes:
   `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`,
   `chore`, `revert`. A CI workflow change is `ci: update release workflow`,
   never `feat(ci):` or `fix(ci):`. Same for `docs:`, `build:`, `test:`,
   `chore:`. If the change is *about* CI, the type already says it.

4. **Abbreviate long names, 7–8 chars max.** Prefer the abbreviation already
   used in the codebase; otherwise shorten predictably:

   | Long name        | Use    |
   |------------------|--------|
   | `authentication` | `auth` |
   | `components`     | `comp` |
   | `infrastructure` | `infra`|
   | `configuration`  | `config` (6, ok as-is) |
   | `service`        | `svc` if needed |

   Keep it lowercase, alphanumeric + hyphen only. No underscores, no caps.

Additional conventions:

- One scope per commit. A change spanning two scopes becomes two commits; only
  fall back to no scope when splitting is impossible.
- Pick the scope by WHAT changed, not why.
- Omit the scope when no single scope owns the change (`feat: restructure repo`,
  `docs: add changelog guide`).

## 3. Write the file

Location: `docs/dev/commit-scopes.md` (preferred). If `docs/dev/` does not
exist and the repo uses `docs/commit-scopes.md` (e.g. `faz-lab`), use that
path instead. Create `docs/dev/` if neither exists.

Use this template: adapt the table, keep the rules and examples.

```md
# Commit scopes

Closed vocabulary. Every commit picks a scope from this table, or takes no
scope. Do not invent one on your own.

**GATE new-scope (always → never skipped; propose name + definition + example
subject and wait for explicit approval):** committing with a scope outside
this closed vocabulary is a convention change, so the gate fires in every run
mode, including auto. When nothing fits, propose the new scope to the user
with a one-line definition and **wait for explicit approval** before
committing with it. (Vocabulary: the @gate skill.)

Format: `type(scope): summary` or `type: summary`.

## Scopes

| Scope | Covers |
|-------|--------|
| `agent` | `agents/**` |
| `skill` | `skills/**` |
| `plugin` | `plugins/**` |
| `script` | `sync.sh`, `targets.conf` |

No scope = repo-wide: README, `docs/`, `.github/`, `dev.sh`, and any change
that genuinely spans several components.

## Rules

- Types: `feat`, `fix`, `refactor`, `docs`, `chore`.
- Pick the scope by WHAT changed, not by why.
- One logical change per commit. A change spanning two scopes becomes two
  commits; only fall back to no scope when splitting is impossible.
- New scopes require user approval first: propose name + definition + example
  subject, then wait. Never commit with an unapproved scope.
- Old commit subjects are never rewritten to match this list. The vocabulary
  applies from its introduction onward.

## Examples

\`\`\`
feat(skill): add issue-closeout skill
fix(plugin): mermaid-doctor timeout guard ignores render:false
docs(script): document project-level sync targets
feat: restructure repo into skill/agent/plugin/command
docs: add commit scopes reference
\`\`\`
```

Tailor the table to the repo you inspected. Each `Covers` cell must point to
real paths. Keep the vocabulary small, 3–8 rows. If you are tempted to add
more, the extra ones are probably too narrow.

## 4. Verify

Before finishing, check:

- [ ] Every scope is singular (no trailing `s` unless the word itself ends in `s`).
- [ ] Every scope maps to a real top-level dir/crate/module (not a single file).
- [ ] No scope equals a conventional type (`ci`, `build`, `docs`, `feat`, `fix`, `chore`, `test`, `perf`, `style`, `refactor`, `revert`).
- [ ] Every scope is ≤8 chars (abbreviated if needed).
- [ ] Table has 3–8 rows; `changelog`/`license`/`deps` do not appear.
- [ ] File lives at `docs/dev/commit-scopes.md` (or `docs/commit-scopes.md` if that is the repo's convention).
- [ ] No scope is silently invented later: the file says new scopes need user approval.
