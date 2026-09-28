---
name: comment-discipline
description: Enforce a strict comment-writing standard when writing or editing any code, config file, or dotfile (Lua, shell, Rust, Python, tmux.conf, hypr conf, etc). Use this whenever you are about to write a comment, whenever the user asks you to add comments, and whenever you are editing a file that already has comments — even if the user's request has nothing to do with commenting. Prevents narration comments ("what" restatements), decision-log comments ("pinned", "fixed", "was slower"), graveyard comments about removed/dropped code, and change-history comments addressed to a future reader who won't see the conversation. Also use when the user says "de-slop", "clean up comments", "why are there so many comments", or asks you to review/audit an existing file's comments.
---

# Comment Discipline

Default to zero comments. A comment is a cost — another line to read, another thing that can go stale — and it is only worth that cost when the code cannot carry the information itself.

## The one test

Before writing any comment, ask: **if I delete this comment, does the reader lose something the code itself cannot tell them?**

- If no → don't write it.
- If yes → write the shortest possible comment that states only the missing piece, in present tense, as if the code had always been this way.

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
If you can't imagine someone needing the comment to understand the line, don't write it. This includes restating a function/variable name in prose ("loop through the users" above `for user in users`).

### 2. Decision-log / narration-of-the-edit comments
Comments that describe the act of editing, not the resulting code: "fixed," "pinned," "inverted-feel fix," "was slower," "restored," "removed."

```lua
-- ❌
natural_scroll = true, -- inverted-feel fix (direction only)
scroll_factor = 0.4, -- pinned: Omarchy out-of-box speed (HyDE's 0.2 was slower)
```

These are commit-message content, not code content. If the *value itself* needs justification going forward (e.g. "0.4, not the default 0.2 — 0.2 causes visible input lag on this trackpad"), that's a real why-comment and is allowed. But "pinned" / "HyDE's was slower" / "fix" tell the reader nothing they can act on six months from now — they only make sense with the diff open.

Test: strip out any word that only means something in the context of "compared to before" (pinned, fixed, restored, was X, now Y, no longer). What's left, if anything, might be a real comment.

### 3. Graveyard comments
References to code, tools, or configs that no longer exist.

```
-- ❌ Dropped (tool gone): hyper-clear blur/opacity, hyprlay, record.sh...
-- ❌ hl.unbind("SUPER + SHIFT + B") -- was: browser (still on SUPER+F)
```
If it's gone, it's gone. Git history is where "what used to be here" lives, not the file. Never write a comment whose subject is absent from the file it's in.

### 4. History / provenance headers
Multi-line banners recording when/why a file was ported, migrated, or touched, addressed to a future maintainer as if they're reading a PR description.

```
-- ❌ =====================================================
-- FAZuH ports from HyDE ~/.tmux.conf (2026-09-10). Omarchy's
-- prefixless splits removed; old prefix + split/resize binds
-- restored. `omarchy refresh tmux` clobbers this.
-- =====================================================
```
Exception: a one-line warning that a tool will silently overwrite the file IS a real constraint (someone needs to know before they debug why their edit vanished) — keep only that sentence, delete the rest:
```
-- ✅ `omarchy refresh tmux` overwrites this file — edits here won't survive a refresh.
```

### 5. Restating scope/inventory
Comments listing what a section does or doesn't cover, when the code itself is the only accurate source of that list (and will drift the moment it's edited without the comment being updated).

```
-- ❌ Scope: fazuh.conf delta only; stock HyDE defaults already covered
-- by Omarchy are left alone.
```

### 6. Section-divider banners with no content
`===...===` blocks whose only job is decoration or to announce "here is the next part," where a blank line or the code structure already does that.

### 7. Docstrings that restate the signature
```python
# ❌
def get_user(user_id: int) -> User:
    """Gets the user with the given user_id and returns a User."""
```
A docstring is allowed only for public API surface where callers can't see the implementation, and even then it should say something the signature doesn't: units, ownership of returned objects, error conditions, side effects, thread-safety — not a restatement of the name.

## What survives

- A constraint that isn't visible in the code (external tool behavior, silent-overwrite risk, ordering requirement)
- A deliberately non-obvious choice, stated in terms of *why the code is correct*, not *what changed*
- BDD-style `# given / # when / # then` in tests
- Linter/type-checker directives (`# noqa`, `// @ts-ignore`)
- Shebangs and license headers
- TODO only if it names a concrete blocking condition ("TODO: remove once upstream fixes #1234"), never a vague deferral ("TODO: clean this up later")

## Workflow

**When writing new code/config:** apply the one test to every comment before it's written. If in doubt, don't write it — deleting a comment silently costs nothing; the user will ask if they actually wanted an explanation.

**When asked to add comments:** still apply the test per-line. "Add comments to this" is not permission to narrate — write only what survives.

**When editing a file that already has comments (even for an unrelated change):** don't add new violations near your edit, but don't go rewrite unrelated existing comments unless asked — that's a separate cleanup pass, not incidental to the task.

**When asked to clean up / de-slop / audit an existing file's comments:** go comment-by-comment in file order:
1. Apply the one test.
2. If it fails, delete it outright — don't soften it into a shorter version of the same banned category.
3. If it passes but is longer than it needs to be, cut it to the single sentence that carries the why.
4. If deleting a comment would leave genuinely unclear code (the comment was compensating for bad naming or a non-obvious structure), don't just delete it — flag it back to the user as a naming/structure issue, since the fix is in the code, not the comment.
5. Report a one-line count at the end: kept / cut / flagged. Don't narrate each decision unless asked.

Never touch the code itself during a comment cleanup pass unless step 4 applies and the user agrees to the refactor.
