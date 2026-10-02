---
name: pr-creator
description: >
  Create a pull request that follows the repository's own template. Use
  whenever the user asks to create, open, draft, or submit a PR, says "make a
  PR for this", or wants work-in-progress changes turned into a pull request,
  even if they do not name the skill. Not for reviewing existing PRs or
  resolving merge conflicts.
license: MIT
metadata:
  author: FAZuH (adapted from google-gemini/gemini-cli pr-creator)
  version: "1.0.0"
  category: git-workflow
---

# Pull Request Creator

> **Load the @following-procedures skill first.** It defines how you run this
> numbered procedure: point-and-call narration, live deviation logging, and a
> fixed post-run report.

## Workflow

### 1. Branch Management (CRITICAL safety)

Never open a PR from the default branch: it reads as a direct push and skips review. Work on a dedicated, descriptively named branch.

Detect the default branch first, never hardcode `main`:

```bash
# Primary: ask GitHub directly, authoritative for PR base and merge behavior
gh repo view --json defaultBranchRef --jq .defaultBranchRef.name
# Fallback A: resolve the remote's HEAD ref, e.g. "refs/remotes/origin/main"
git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null
# Fallback B: the remote's advertised HEAD
git remote show origin 2>/dev/null | grep "HEAD branch"
```

Strip `refs/remotes/origin/` for the branch name. `gh` beats a local `symbolic-ref` (stale cache; refresh with `git remote set-head origin -a`). No remote: try `main`, then `master`.

Then check where you are:

```bash
git branch --show-current
```

On the default branch, cut a new branch before anything else:

```bash
git checkout -b <new-branch-name>
```

Name it for the work, e.g. `feat/user-auth`, `fix/crash-on-parse`.

### 2. Commit Changes

```bash
git status
```

Uncommitted work: stage and commit it in [Conventional Commits](https://www.conventionalcommits.org/) format (e.g. `feat(ui): add new button`). NEVER commit to the default branch.

### 3. Locate Template

- `.github/pull_request_template.md`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `.github/PULL_REQUEST_TEMPLATE/` (e.g. `bug_fix.md`, `feature.md`). Several templates: ask the user or pick from context.

**GATE template-pick (normal → pick the most appropriate template from context and note the choice in the PR):** several templates means the user picks. Never guess silently.

No template in the repo: fall back to the bundled `reference/pr-template.md`.

### 4. Read Template

Read the chosen template. The description follows its structure.

### 5. Draft Description

- **Headings**: keep them all.
- **Checklists**: `[x]` only what is genuinely done, `[ ]` the rest. Never check a box for undone work.
- **Content**: clear, concise summaries per section.
- **Related issues**: link them (e.g. `Fixes #123`).
- **Auto-close**: `Closes #N`, one per line, only for issues the PR genuinely resolves (`Closes`, not `Fixes`; never merely-related or tracking issues).

Non-applicable sections: follow the template's own guidance. The bundled template says omit, never "N/A".

### 6. Preflight Checks

Run the repo's own checks (build, lint, tests). Discover, don't assume:

- `package.json` scripts (`lint`, `test`, `typecheck`, `build`, `check`, …)
- `justfile` / `Makefile` targets
- `Cargo.toml` (`cargo test`, `cargo clippy`, `cargo fmt --check`)
- `pyproject.toml` / `uv.lock` (e.g. `uv run pytest`, `ruff check`)
- CI workflows (`.github/workflows/`) for the canonical commands

No checks defined: note it in the PR and proceed.

Then confirm the PR holds only this branch's work. A local base ahead of remote rides along silently:

```bash
git fetch origin
git log --oneline origin/<base>..HEAD   # every commit here lands in the PR
```

Foreign commits in that list: stop and ask. Push, rebase, or re-target is the user's call.

### 7. Push Branch

Verify the name first. Pushing the default branch is the one irreversible mistake here.

```bash
# Verify the current branch is NOT the default branch
git branch --show-current
# Push non-interactively
git push -u origin HEAD
```

### 8. Create PR

`gh` CLI, description via temp file (never inline Markdown through the shell):

```bash
# 1. Write the drafted description to a FRESH temp file, never a fixed path
body=$(mktemp -t pr-body-XXXXXX.md)
# 2. Assert the file has content before handing it to a flag that replaces the body
test -s "$body" || { echo "PR body file is empty: $body" >&2; exit 1; }
# 3. Create the PR using the --body-file flag
gh pr create --title "type(scope): succinct description" --body-file "$body"
# 4. Remove the temporary file
rm "$body"
```

- **Never pass an unverified path to `--body-file`.** The flag replaces the body with the file's contents, so a missing or empty file silently wipes it. `mktemp` in the same command, `test -s` before the call, never `>>` onto a path that may not exist (it recreates the file as empty). Cross-session drafts go under `/tmp/opencode/`, not bare `/tmp/`. Same guard for `gh issue edit --body-file`.
- **Title**: [Conventional Commits](https://www.conventionalcommits.org/) if the repo uses it (match recent commits when in doubt).

## Dependency graph

- 1. branch management
- 2. commit changes
- 3. locate template -> 1
- 4. read template -> 3
- 5. draft description -> 4
- 6. preflight checks -> 2
- 7. push branch -> 1, 6
- 8. create PR -> 5, 7

## References

- `reference/pr-template.md`: bundled generic PR template, used only when the
  repository has no template of its own.
