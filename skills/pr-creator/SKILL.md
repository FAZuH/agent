---
name: pr-creator
description: >
  Creates high-quality pull requests (PRs) that follow the repository's own
  templates and standards. Handles the whole flow: branch safety, committing
  changes, finding/reading the PR template (falling back to a bundled generic
  template when the repo has none), running the repo's standard checks, pushing,
  and opening the PR with the gh CLI.
  Use this skill whenever the user asks to create a PR, open a pull request,
  draft a PR, submit a PR, "make a PR for this", or prepares a branch plus
  description plus PR — even if they don't name the skill. Also triggers when
  the user has work-in-progress changes and wants them turned into a pull
  request. Not for reviewing existing PRs or resolving merge conflicts.
license: MIT
metadata:
  author: FAZuH (adapted from google-gemini/gemini-cli pr-creator)
  version: "1.0.0"
  category: git-workflow
---

# Pull Request Creator

This skill guides the creation of high-quality pull requests that follow the
repository's own templates and standards.

## Workflow

Follow these steps in order to create a pull request:

### 1. Branch Management (CRITICAL safety)

Never create a PR from the repository's **default branch** — PRs that come from
`main`/`master` are indistinguishable from direct pushes and skip review. Work
on a dedicated, descriptively named branch instead.

Detect the default branch first (do not hardcode `main` — repos vary):

```bash
# Primary: resolve the remote's HEAD ref, e.g. "refs/remotes/origin/main"
git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null
# Fallback A: the remote's advertised HEAD
git remote show origin 2>/dev/null | grep "HEAD branch"
# Fallback B: ask GitHub directly
gh repo view --json defaultBranchRef --jq .defaultBranchRef.name
```

Strip `refs/remotes/origin/` from the `symbolic-ref` output to get the branch
name. If there is no remote configured, fall back to checking for the common
defaults (`main`, then `master`).

Then check the current branch:

```bash
git branch --show-current
```

If the current branch is the default branch, create and switch to a new
descriptive branch before doing anything else:

```bash
git checkout -b <new-branch-name>
```

Choose a name that describes the work, e.g. `feat/user-auth`, `fix/crash-on-parse`.

### 2. Commit Changes

Verify all intended changes are committed before creating the PR:

```bash
git status
```

If there are uncommitted changes, stage and commit them with a descriptive
message in [Conventional Commits](https://www.conventionalcommits.org/) format
(e.g. `feat(ui): add new button`, `fix(core): resolve crash`). NEVER commit
directly to the default branch.

### 3. Locate Template

Look for a pull request template in the repository:

- `.github/pull_request_template.md`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `.github/PULL_REQUEST_TEMPLATE/` (a directory of templates, e.g. `bug_fix.md`,
  `feature.md`) — if multiple exist, ask the user which to use or select the
  most appropriate one based on the context.

If **no template exists** in the repo, use the bundled generic template at
`reference/pr-template.md` as the fallback so the PR still has structure.

### 4. Read Template

Read the content of the chosen template file. The description you draft must
follow its structure.

### 5. Draft Description

Create a PR description that strictly follows the template's structure:

- **Headings**: Keep all headings from the template.
- **Checklists**: Review each item. Mark `[x]` if genuinely completed. Leave
  items unchecked (`[ ]`) if not applicable — never check boxes for work you
  haven't done.
- **Content**: Fill each section with clear, concise summaries of your changes.
- **Related Issues**: Link any issues fixed or related to this PR (e.g.
  `Fixes #123`).
- **Auto-close issues**: If the PR resolves any issue (the branch, commits, or
  the user references an issue this work addresses), add a `Closes #<number>`
  line so that issue auto-closes when the PR merges. Include every issue the PR
  resolves, one per line (`Closes #12`, `Closes #34`). Use `Closes` (not
  `Fixes`) so the issue is closed automatically on merge. Only add issues the
  PR genuinely resolves — do not list merely-related or tracking issues you
  don't want auto-closed.

Follow the template's own guidance for sections that don't apply: the bundled
`reference/pr-template.md` instructs omitting non-applicable sections entirely
(never writing "N/A" filler), so drop them rather than leaving empty headings.

### 6. Preflight Checks

Before creating the PR, run the repository's *own* standard checks — build,
lint, and tests. Don't assume a specific command; discover what the repo
defines:

- `package.json` scripts (`lint`, `test`, `typecheck`, `build`, `check`, …)
- `justfile` / `Makefile` targets
- `Cargo.toml` (`cargo test`, `cargo clippy`, `cargo fmt --check`)
- `pyproject.toml` / `uv.lock` (e.g. `uv run pytest`, `ruff check`)
- CI workflow files (`.github/workflows/`) for the canonical commands

Run the checks the repo itself uses. If the repo defines no such checks, note
that in the PR and proceed — don't invent a check the project doesn't have.

### 7. Push Branch

Push the current branch to the remote. Double-check the branch name first —
pushing the default branch is the one irreversible mistake here.

```bash
# Verify the current branch is NOT the default branch
git branch --show-current
# Push non-interactively
git push -u origin HEAD
```

### 8. Create PR

Use the `gh` CLI to create the PR. Write the description to a temporary file
first to avoid shell-escaping issues with multi-line Markdown:

```bash
# 1. Write the drafted description to a temporary file
# 2. Create the PR using the --body-file flag
gh pr create --title "type(scope): succinct description" --body-file <temp_file_path>
# 3. Remove the temporary file
rm <temp_file_path>
```

- **Title**: Use the [Conventional Commits](https://www.conventionalcommits.org/)
  format if the repository uses it (match the style of recent commits when in
  doubt).

## Principles

- **Safety First**: NEVER push to the default branch. This is the highest
  priority — check before every push.
- **Compliance**: Never ignore the PR template. It exists for a reason; if the
  repo lacks one, use `reference/pr-template.md` so the PR still reads well.
- **Completeness**: Fill out all relevant sections.
- **Accuracy**: Don't check boxes for tasks you haven't done.

## References

- `reference/pr-template.md` — bundled generic PR template, used only when the
  repository has no template of its own.