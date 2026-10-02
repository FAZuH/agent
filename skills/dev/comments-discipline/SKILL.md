---
name: comments-discipline
description: >-
  Decide whether a comment earns its line, and delete the ones that do not:
  narration ("what" restatements), decision-log comments ("pinned", "fixed",
  "was slower"), graveyard references to removed code, change-history
  banners, and section-divider decoration. Use whenever you are about to
  write a comment, whenever you edit a file that already has comments (even
  for an unrelated change), and whenever the user asks to add, clean up, or
  audit comments ("de-slop", "why are there so many comments").
---

# Comment Discipline

Default to zero comments. A comment costs a line to read and a thing that can go stale. Pay it only when the code cannot carry the information.

## The one test

Before writing any comment, ask: **if I delete this comment, does the reader lose something the code itself cannot tell them?**

- If no → don't write it.
- If yes → shortest comment stating only the missing piece, present tense, as if the code had always been this way.

"Missing piece" means one of:
- **A non-obvious constraint** ("must run before X initializes network")
- **A deliberate deviation from the obvious approach** ("not memoized: input changes every call, cache would always miss")
- **A gotcha that will bite someone** ("index is 1-based here, unlike the rest of the file")
- **A workaround for something external and undocumented** ("upstream API returns 200 on failure, check body.error instead")

Everything else is banned. No exceptions for "it helps context," "it explains my reasoning," or "it's just one line."

## Banned categories (with the failure caught, verbatim style)

### 1. Narration ("what" comments)
Restates what the next line already says.

```lua
-- ❌
scroll_factor = 0.4, -- sets the scroll factor to 0.4
```
If no one needs the comment to understand the line, don't write it. Includes prose restatements of names ("loop through the users" above `for user in users`).

### 2. Decision-log / narration-of-the-edit comments
Comments describing the edit, not the result: "fixed," "pinned," "inverted-feel fix," "was slower," "restored," "removed."

```lua
-- ❌
natural_scroll = true, -- inverted-feel fix (direction only)
scroll_factor = 0.4, -- pinned: Omarchy out-of-box speed (HyDE's 0.2 was slower)
```

Commit-message content, not code content. A value needing forward justification (e.g. "0.4, not the default 0.2: 0.2 causes visible input lag on this trackpad") is a real why-comment. "Pinned" / "HyDE's was slower" / "fix" act on nothing six months out; they need the diff open.

Test: strip words meaning only "compared to before" (pinned, fixed, restored, was X, now Y, no longer). The remainder, if any, might be real.

### 3. Graveyard comments
References to code, tools, or configs that no longer exist.

```
-- ❌ Dropped (tool gone): hyper-clear blur/opacity, hyprlay, record.sh...
-- ❌ hl.unbind("SUPER + SHIFT + B") -- was: browser (still on SUPER+F)
```
Gone is gone. "What used to be here" lives in git history, not the file. Never comment on something absent from the file.

### 4. History / provenance headers
Multi-line banners recording when/why a file was ported or touched, written as PR description to a future maintainer.

```
-- ❌ =====================================================
-- FAZuH ports from HyDE ~/.tmux.conf (2026-09-10). Omarchy's
-- prefixless splits removed; old prefix + split/resize binds
-- restored. `omarchy refresh tmux` clobbers this.
-- =====================================================
```
Exception: a one-line silent-overwrite warning IS a real constraint. Keep that sentence, delete the rest:
```
-- ✅ `omarchy refresh tmux` overwrites this file: edits here won't survive a refresh.
```

### 5. Restating scope/inventory
Comments inventorying a section when the code is the only accurate source (drifts on the next edit without the comment).

```
-- ❌ Scope: fazuh.conf delta only; stock HyDE defaults already covered
-- by Omarchy are left alone.
```

### 6. Section-divider banners with no content
Decoration-only `===...===` blocks where a blank line or the structure already separates.

### 7. Docstrings that restate the signature
```python
# ❌
def get_user(user_id: int) -> User:
    """Gets the user with the given user_id and returns a User."""
```
Docstrings only for public API where callers cannot see the implementation, and only for what the signature lacks: units, ownership, errors, side effects, thread-safety. Never a name restatement.

## What survives

- A constraint invisible in the code (external behavior, silent-overwrite risk, ordering)
- A deliberately non-obvious choice, stated as *why the code is correct*, not *what changed*
- BDD-style `# given / # when / # then` in tests
- Linter/type-checker directives (`# noqa`, `// @ts-ignore`)
- Shebangs and license headers
- TODO only if it names a concrete blocking condition ("TODO: remove once upstream fixes #1234"), never a vague deferral ("TODO: clean this up later")

## Workflow

**When writing new code/config:** test every comment before writing it. In doubt, leave it out. A deleted comment costs nothing; the user asks if they wanted the explanation.

**When asked to add comments:** still test per line. "Add comments" never means narrate. Write only what survives.

**When editing a file that already has comments (even for an unrelated change):** add no new violations, but leave unrelated comments alone. That is a separate pass, not incidental work.

**When asked to clean up / de-slop / audit comments:** go comment-by-comment in file order:
1. Apply the one test.
2. Fail: delete outright. Never soften a banned category into a shorter version of itself.
3. Pass but wordy: cut to the one sentence carrying the why.
4. Deleting would leave genuinely unclear code (comment compensating for bad naming or structure): flag back as a code issue. Fix the code, not the comment.
5. Report kept / cut / flagged counts in one line. No per-decision narration unless asked.

Never touch code in a comment cleanup pass unless step 4 applies and the user agrees.
