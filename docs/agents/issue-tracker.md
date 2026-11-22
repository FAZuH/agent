# Issue tracker: GitHub

Issues and published specs live in GitHub Issues for `FAZuH/agent`.
Use the `gh` CLI from this repository.

This configuration overrides older local-tracker instructions in the
`session` skill. `.scratch/` holds working records, not tracker issues.

## Target

Before the first issue creation in a session, run:
`gh repo view --json nameWithOwner,url`

The target must be `FAZuH/agent`.
If it differs, stop and confirm the target.
Never publish into the upstream skills repository.

## Operations

- Create: `gh issue create --title "..." --body-file -`.
  Supply multiline content through a heredoc.
- Read: `gh issue view <number> --json number,title,body,labels,comments`.
- List: `gh issue list --state open --json number,title,body,labels,comments`.
  Add label and state filters as needed.
- Comment: `gh issue comment <number> --body "..."`.
- Add a label: `gh issue edit <number> --add-label "..."`.
- Remove a label: `gh issue edit <number> --remove-label "..."`.
- Close: post the outcome with `gh issue comment`.
  Fetch the body with `gh issue view <number> --json body`.
  Convert unchecked acceptance criteria with `sed 's/^- \[ \]/- [x]/'`.
  Write the updated body with `gh issue edit <number> --body-file -`
  using a quoted heredoc.
  Re-fetch the body. Verify every criterion is `- [x]` and nothing else changed.
  Then run `gh issue close <number>`.

Do not rely on `gh issue close --comment` for an already-closed issue.
It can discard the comment.

## Relationships

Create a child with `gh issue create --parent <parent> ...`.
Link an existing child with
`gh issue edit <parent> --add-sub-issue <child>`.

Create dependencies with
`gh issue create --blocked-by <blocker>,<blocker> ...`.
Add an existing dependency with
`gh issue edit <child> --add-blocked-by <blocker>`.

If relationships are unavailable, put `Part of #<parent>` and
`Blocked by: #<n>, #<n>` at the top of the child body.
Also list children in the parent's task list.
An issue is unblocked only when every blocker is closed.

## Pull requests as a triage surface

PRs as a request surface: no.

## Skill instructions

“Publish to the issue tracker” means create a GitHub issue.
“Fetch the relevant ticket” means read its GitHub issue.
